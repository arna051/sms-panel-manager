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

export const ghasedakCredentialsSchema = z
  .object({ apiKey: z.string().min(1) })
  .strict();
export type GhasedakCredentials = z.infer<typeof ghasedakCredentialsSchema>;

const accountResponseSchema = z.object({
  IsSuccess: z.boolean(),
  StatusCode: z.number(),
});
const sendResponseSchema = z.object({
  IsSuccess: z.boolean(),
  StatusCode: z.number(),
  Data: z.object({ MessageId: z.union([z.string(), z.number()]) }).optional(),
});

export class GhasedakAdapter implements SmsProviderAdapter<
  GhasedakCredentials,
  string,
  readonly unknown[]
> {
  readonly id = "ghasedak";
  readonly credentialSchema = ghasedakCredentialsSchema;
  readonly capabilities = {
    credentialVerification: { mode: "account" },
    templates: {
      binding: "ordered",
      canList: false,
      canInspect: true,
      canCreate: false,
    },
    deliveryStatus: "poll",
    providerIdempotency: true,
  } as const;

  constructor(
    private readonly http: ProviderHttpClient = createProviderHttpClient({
      baseURL: "https://gateway.ghasedak.me",
    }),
  ) {}

  async verifyCredentials(
    credentials: GhasedakCredentials,
    context: ProviderCallContext,
  ) {
    try {
      const response = await this.http.request({
        method: "GET",
        url: "/rest/api/v1/WebService/GetAccountInformation",
        headers: { ApiKey: credentials.apiKey },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (response.status === 401 || response.status === 403) {
        return invalidVerification();
      }
      const parsed = accountResponseSchema.safeParse(response.data);
      if (!parsed.success) return unavailableVerification();
      if (!parsed.data.IsSuccess) {
        return invalidVerification();
      }
      return verified("account");
    } catch {
      return unavailableVerification();
    }
  }

  async sendTemplate(
    credentials: GhasedakCredentials,
    input: ProviderTemplateSendInput<string, readonly unknown[]>,
    context: ProviderCallContext,
  ): Promise<ProviderSubmissionResult> {
    if (input.parameters.length < 1 || input.parameters.length > 10) {
      return rejected("template_binding_invalid");
    }
    const body: Record<string, unknown> = {
      receptors: [toIranianLocalMobile(input.recipient)],
      templateName: input.template,
      ...(input.clientReferenceId === undefined
        ? {}
        : { clientReferenceId: input.clientReferenceId }),
    };
    input.parameters.forEach((value, index) => {
      body[`param${String(index + 1)}`] = String(value);
    });

    try {
      const response = await this.http.request({
        method: "POST",
        url: "/rest/api/v1/WebService/SendOtpWithParams",
        headers: {
          ApiKey: credentials.apiKey,
          "Content-Type": "application/json",
        },
        data: body,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      const parsed = sendResponseSchema.safeParse(response.data);
      if (!parsed.success) return unknownSubmission();
      if (!parsed.data.IsSuccess || parsed.data.Data === undefined) {
        return rejected(`ghasedak_${String(parsed.data.StatusCode)}`);
      }
      return {
        status: "accepted",
        providerMessageId: String(parsed.data.Data.MessageId),
      };
    } catch {
      return unknownSubmission();
    }
  }
}
