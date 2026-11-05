import { z } from "zod";

import type {
  ProviderCallContext,
  ProviderSubmissionResult,
  ProviderTemplateSendInput,
  SmsProviderAdapter,
} from "../core/provider.js";
import { toIranianLocalMobile } from "../core/phone.js";
import { createProviderHttpClient, type ProviderHttpClient } from "./http.js";
import {
  invalidVerification,
  rejected,
  unavailableVerification,
  unknownSubmission,
  verified,
} from "./shared.js";

export const kavenegarCredentialsSchema = z
  .object({ apiKey: z.string().min(1) })
  .strict();
export type KavenegarCredentials = z.infer<typeof kavenegarCredentialsSchema>;
export type KavenegarParameters = Partial<
  Record<"token" | "token2" | "token3" | "token10" | "token20", unknown>
>;

const responseSchema = z.object({
  return: z.object({ status: z.number(), message: z.string() }),
  entries: z.array(z.record(z.string(), z.unknown())).optional(),
});

export class KavenegarAdapter implements SmsProviderAdapter<
  KavenegarCredentials,
  string,
  KavenegarParameters
> {
  readonly id = "kavenegar";
  readonly credentialSchema = kavenegarCredentialsSchema;
  readonly capabilities = {
    credentialVerification: { mode: "account" },
    templates: {
      binding: "fixed-slots",
      slots: ["token", "token2", "token3", "token10", "token20"],
      canList: false,
      canInspect: false,
      canCreate: false,
    },
    deliveryStatus: "poll",
    providerIdempotency: false,
  } as const;

  constructor(
    private readonly http: ProviderHttpClient = createProviderHttpClient({
      baseURL: "https://api.kavenegar.com",
    }),
  ) {}

  private path(apiKey: string, operation: string): string {
    return `/v1/${encodeURIComponent(apiKey)}/${operation}.json`;
  }

  async verifyCredentials(
    credentials: KavenegarCredentials,
    context: ProviderCallContext,
  ) {
    try {
      const response = await this.http.request({
        method: "GET",
        url: this.path(credentials.apiKey, "account/info"),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (response.status === 401 || response.status === 403) {
        return invalidVerification();
      }
      const parsed = responseSchema.safeParse(response.data);
      if (!parsed.success) return unavailableVerification();
      if (parsed.data.return.status !== 200) {
        return invalidVerification();
      }
      return verified("account");
    } catch {
      return unavailableVerification();
    }
  }

  async sendTemplate(
    credentials: KavenegarCredentials,
    input: ProviderTemplateSendInput<string, KavenegarParameters>,
    context: ProviderCallContext,
  ): Promise<ProviderSubmissionResult> {
    if (input.parameters.token === undefined)
      return rejected("template_binding_invalid");
    try {
      const response = await this.http.request({
        method: "GET",
        url: this.path(credentials.apiKey, "verify/lookup"),
        params: {
          receptor: toIranianLocalMobile(input.recipient),
          template: input.template,
          ...Object.fromEntries(
            Object.entries(input.parameters).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      const parsed = responseSchema.safeParse(response.data);
      if (!parsed.success) return unknownSubmission();
      if (parsed.data.return.status !== 200) {
        return rejected(`kavenegar_${String(parsed.data.return.status)}`);
      }
      const messageId = parsed.data.entries?.[0]?.messageid;
      if (typeof messageId !== "string" && typeof messageId !== "number") {
        return unknownSubmission();
      }
      return { status: "accepted", providerMessageId: String(messageId) };
    } catch {
      return unknownSubmission();
    }
  }
}
