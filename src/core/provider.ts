import type { z } from "zod";

export type CredentialVerificationResult =
  | {
      readonly status: "verified";
      readonly method: "account" | "credit" | "profile" | "lines";
      readonly verifiedAt: Date;
    }
  | {
      readonly status: "invalid";
      readonly code: "invalid_credentials";
    }
  | {
      readonly status: "unavailable";
      readonly retryable: boolean;
    };

export type ProviderTemplateCapability =
  | {
      readonly binding: "named" | "ordered";
      readonly canList: boolean;
      readonly canInspect: boolean;
      readonly canCreate: boolean;
    }
  | {
      readonly binding: "fixed-slots";
      readonly slots: readonly string[];
      readonly canList: boolean;
      readonly canInspect: boolean;
      readonly canCreate: boolean;
    };

export interface ProviderCapabilities {
  readonly credentialVerification:
    | { readonly mode: "account" | "credit" | "profile" | "lines" }
    | { readonly mode: "unsupported" };
  readonly templates: ProviderTemplateCapability;
  readonly deliveryStatus:
    "poll" | "webhook" | "poll-and-webhook" | "unsupported";
  readonly providerIdempotency: boolean;
}

export interface ProviderCallContext {
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
}

export interface ProviderTemplateSendInput<
  TTemplateReference = unknown,
  TProviderParameters = unknown,
> {
  readonly recipient: `+98${string}`;
  readonly template: TTemplateReference;
  readonly parameters: TProviderParameters;
  readonly clientReferenceId?: string;
}

export type ProviderSubmissionResult =
  | {
      readonly status: "accepted";
      readonly providerMessageId: string;
      readonly acceptedAt?: Date;
    }
  | {
      readonly status: "rejected";
      readonly code: string;
      readonly retryable: false;
    }
  | {
      readonly status: "pre-acceptance-failure";
      readonly code: string;
      readonly retryable: boolean;
    }
  | {
      readonly status: "unknown";
      readonly code: "unknown_outcome";
    };

export interface SmsProviderAdapter<
  TCredentials,
  TTemplateReference = unknown,
  TProviderParameters = unknown,
> {
  readonly id: string;
  readonly credentialSchema: z.ZodType<TCredentials>;
  readonly capabilities: ProviderCapabilities;

  verifyCredentials(
    credentials: TCredentials,
    context: ProviderCallContext,
  ): Promise<CredentialVerificationResult>;

  sendTemplate(
    credentials: TCredentials,
    input: ProviderTemplateSendInput<TTemplateReference, TProviderParameters>,
    context: ProviderCallContext,
  ): Promise<ProviderSubmissionResult>;
}
