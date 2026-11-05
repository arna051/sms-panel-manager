import { z } from "zod";

import type {
  ProviderCallContext,
  ProviderSubmissionResult,
  ProviderTemplateSendInput,
  SmsProviderAdapter,
} from "../core/provider.js";
import { createProviderHttpClient, type ProviderHttpClient } from "./http.js";
import {
  invalidVerification,
  rejected,
  unavailableVerification,
  unknownSubmission,
  verified,
} from "./shared.js";

export const ipPanelCredentialsSchema = z
  .object({
    apiToken: z.string().min(1),
    fromNumber: z.string().regex(/^\+98\S+$/),
  })
  .strict();
export type IpPanelCredentials = z.infer<typeof ipPanelCredentialsSchema>;
export type IpPanelParameters = Readonly<Record<string, unknown>>;

const envelopeSchema = z.object({
  meta: z.object({
    status: z.boolean(),
    message_code: z.string(),
  }),
  data: z.unknown(),
});
const sendDataSchema = z.object({
  message_outbox_ids: z.array(z.union([z.string(), z.number()])).min(1),
});

export class IpPanelAdapter implements SmsProviderAdapter<
  IpPanelCredentials,
  string,
  IpPanelParameters
> {
  readonly id = "ippanel";
  readonly credentialSchema = ipPanelCredentialsSchema;
  readonly capabilities = {
    credentialVerification: { mode: "profile" },
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
      baseURL: "https://edge.ippanel.com",
    }),
  ) {}

  async verifyCredentials(
    credentials: IpPanelCredentials,
    context: ProviderCallContext,
  ) {
    try {
      const response = await this.http.request({
        method: "GET",
        url: "/v1/api/acl/auth/check_token",
        headers: { Authorization: credentials.apiToken },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      if (response.status === 401 || response.status === 403) {
        return invalidVerification();
      }
      const parsed = envelopeSchema.safeParse(response.data);
      if (!parsed.success) return unavailableVerification();
      if (!parsed.data.meta.status) {
        return invalidVerification();
      }
      return verified("profile");
    } catch {
      return unavailableVerification();
    }
  }

  async sendTemplate(
    credentials: IpPanelCredentials,
    input: ProviderTemplateSendInput<string, IpPanelParameters>,
    context: ProviderCallContext,
  ): Promise<ProviderSubmissionResult> {
    try {
      const response = await this.http.request({
        method: "POST",
        url: "/v1/api/send",
        headers: {
          Authorization: credentials.apiToken,
          "Content-Type": "application/json",
        },
        data: {
          sending_type: "pattern",
          from_number: credentials.fromNumber,
          code: input.template,
          recipients: [input.recipient],
          params: input.parameters,
        },
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
      const envelope = envelopeSchema.safeParse(response.data);
      if (!envelope.success) return unknownSubmission();
      if (!envelope.data.meta.status) {
        return rejected(`ippanel_${envelope.data.meta.message_code}`);
      }
      const data = sendDataSchema.safeParse(envelope.data.data);
      if (!data.success) return unknownSubmission();
      return {
        status: "accepted",
        providerMessageId: String(data.data.message_outbox_ids[0]),
      };
    } catch {
      return unknownSubmission();
    }
  }
}
