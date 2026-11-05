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

export const farazSmsCredentialsSchema = z
  .object({ apiKey: z.string().min(1), lineNumber: z.string().min(1) })
  .strict();
export type FarazSmsCredentials = z.infer<typeof farazSmsCredentialsSchema>;
export type FarazSmsParameters = Readonly<Record<string, unknown>>;

const responseSchema = z.object({
  status: z.string(),
  data: z.unknown().optional(),
  messages: z.union([z.string(), z.array(z.string())]).optional(),
});

export class FarazSmsAdapter implements SmsProviderAdapter<
  FarazSmsCredentials,
  string,
  FarazSmsParameters
> {
  readonly id = "farazsms";
  readonly credentialSchema = farazSmsCredentialsSchema;
  readonly capabilities = {
    credentialVerification: { mode: "credit" },
    templates: {
      binding: "named",
      canList: true,
      canInspect: true,
      canCreate: true,
    },
    deliveryStatus: "poll",
    providerIdempotency: false,
  } as const;

  constructor(
    private readonly http: ProviderHttpClient = createProviderHttpClient({
      baseURL: "https://api.iranpayamak.com",
    }),
  ) {}

  async verifyCredentials(
    credentials: FarazSmsCredentials,
    context: ProviderCallContext,
  ) {
    try {
      const response = await this.http.request({
        method: "GET",
        url: "/ws/v1/account/balance",
        headers: { "Api-Key": credentials.apiKey },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (response.status === 401 || response.status === 403) {
        return invalidVerification();
      }
      const parsed = responseSchema.safeParse(response.data);
      if (!parsed.success) return unavailableVerification();
      if (parsed.data.status !== "success") {
        return invalidVerification();
      }
      return verified("credit");
    } catch {
      return unavailableVerification();
    }
  }

  async sendTemplate(
    credentials: FarazSmsCredentials,
    input: ProviderTemplateSendInput<string, FarazSmsParameters>,
    context: ProviderCallContext,
  ): Promise<ProviderSubmissionResult> {
    try {
      const response = await this.http.request({
        method: "POST",
        url: "/ws/v1/sms/pattern",
        headers: {
          "Api-Key": credentials.apiKey,
          "Content-Type": "application/json",
        },
        data: {
          code: input.template,
          attributes: input.parameters,
          recipient: toIranianLocalMobile(input.recipient),
          line_number: credentials.lineNumber,
          number_format: "english",
        },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      const parsed = responseSchema.safeParse(response.data);
      if (!parsed.success) return unknownSubmission();
      if (parsed.data.status !== "success")
        return rejected("farazsms_rejected");
      if (
        typeof parsed.data.data !== "string" &&
        typeof parsed.data.data !== "number"
      ) {
        return unknownSubmission();
      }
      return {
        status: "accepted",
        providerMessageId: String(parsed.data.data),
      };
    } catch {
      return unknownSubmission();
    }
  }
}
