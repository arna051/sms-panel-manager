import { randomUUID } from "node:crypto";

import { applyParameterBindings, type ParameterBinding } from "./bindings.js";
import type {
  SmsSendCommand,
  SmsSendExecutor,
  SmsSendResult,
} from "./manager.js";
import type {
  ProviderSubmissionResult,
  SmsProviderAdapter,
} from "./provider.js";
import { createPrivacyFingerprint } from "../security/fingerprint.js";

export interface ResolvedSendConfiguration {
  readonly id: string;
  readonly version: number;
  readonly adapter: SmsProviderAdapter<Record<string, unknown>>;
  readonly credentials: Record<string, unknown>;
  readonly template: unknown;
  readonly bindings: readonly ParameterBinding[];
}

export interface SendConfigurationResolver {
  resolve(
    scopeKey: string,
    actionKey: string,
  ): Promise<ResolvedSendConfiguration>;
}

export interface OperationSnapshot {
  readonly id: string;
  readonly state:
    | "reserved"
    | "processing"
    | "submitted"
    | "delivered"
    | "failed"
    | "unknown";
  readonly providerMessageId?: string;
}

export interface SendOperationStore {
  reserve(input: {
    readonly scopeKey: string;
    readonly actionKey: string;
    readonly actionDefinitionVersion: string;
    readonly configurationVersion: number;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly recipientFingerprint: string;
    readonly expiresAt: Date;
  }): Promise<{
    readonly created: boolean;
    readonly operation: OperationSnapshot;
  }>;

  beginAttempt(input: {
    readonly operationId: string;
    readonly providerConfigurationId: string;
    readonly adapterId: string;
    readonly expiresAt: Date;
  }): Promise<void>;

  completeAttempt(
    operationId: string,
    result: ProviderSubmissionResult,
  ): Promise<OperationSnapshot>;
}

function publicResult(operation: OperationSnapshot): SmsSendResult {
  const status =
    operation.state === "reserved" || operation.state === "processing"
      ? "pending"
      : operation.state;
  return {
    operationId: operation.id,
    status,
    ...(operation.providerMessageId === undefined
      ? {}
      : { providerMessageId: operation.providerMessageId }),
  };
}

export interface SmsOrchestratorOptions {
  readonly scopeKey?: string;
  readonly actionDefinitionVersion: string;
  readonly fingerprintSecret: Uint8Array;
  readonly operationRetentionMs?: number;
  readonly configurations: SendConfigurationResolver;
  readonly operations: SendOperationStore;
  readonly now?: () => Date;
}

export class SmsOrchestrator implements SmsSendExecutor {
  private readonly scopeKey: string;
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: SmsOrchestratorOptions) {
    this.scopeKey = options.scopeKey ?? "global";
    this.retentionMs =
      options.operationRetentionMs ?? 30 * 24 * 60 * 60 * 1_000;
    this.now = options.now ?? (() => new Date());
    if (this.retentionMs <= 0 || !Number.isSafeInteger(this.retentionMs)) {
      throw new TypeError(
        "Operation retention must be a positive integer of milliseconds.",
      );
    }
  }

  async execute(command: SmsSendCommand): Promise<SmsSendResult> {
    if (
      command.options.idempotencyKey !== undefined &&
      (command.options.idempotencyKey.length < 1 ||
        command.options.idempotencyKey.length > 200)
    ) {
      throw new TypeError(
        "Idempotency key must contain between 1 and 200 characters.",
      );
    }
    const configuration = await this.options.configurations.resolve(
      this.scopeKey,
      command.actionKey,
    );
    const providerParameters = applyParameterBindings(
      command.parameters,
      configuration.bindings,
    );
    const idempotencyKey = command.options.idempotencyKey ?? randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.retentionMs);
    const requestFingerprint = createPrivacyFingerprint(
      this.options.fingerprintSecret,
      "sms-send-request",
      {
        actionKey: command.actionKey,
        recipient: command.recipient,
        parameters: command.parameters,
        actionDefinitionVersion: this.options.actionDefinitionVersion,
        configurationId: configuration.id,
        configurationVersion: configuration.version,
      },
    );
    const recipientFingerprint = createPrivacyFingerprint(
      this.options.fingerprintSecret,
      "sms-recipient",
      command.recipient,
    );

    const reservation = await this.options.operations.reserve({
      scopeKey: this.scopeKey,
      actionKey: command.actionKey,
      actionDefinitionVersion: this.options.actionDefinitionVersion,
      configurationVersion: configuration.version,
      idempotencyKey,
      requestFingerprint,
      recipientFingerprint,
      expiresAt,
    });
    if (!reservation.created) return publicResult(reservation.operation);

    await this.options.operations.beginAttempt({
      operationId: reservation.operation.id,
      providerConfigurationId: configuration.id,
      adapterId: configuration.adapter.id,
      expiresAt,
    });

    let result: ProviderSubmissionResult;
    try {
      result = await configuration.adapter.sendTemplate(
        configuration.credentials,
        {
          recipient: command.recipient,
          template: configuration.template,
          parameters: providerParameters,
          ...(command.options.idempotencyKey === undefined
            ? {}
            : { clientReferenceId: command.options.idempotencyKey }),
        },
        {
          ...(command.options.signal === undefined
            ? {}
            : { signal: command.options.signal }),
          ...(command.options.correlationId === undefined
            ? {}
            : { correlationId: command.options.correlationId }),
        },
      );
    } catch {
      result = { status: "unknown", code: "unknown_outcome" };
    }

    return publicResult(
      await this.options.operations.completeAttempt(
        reservation.operation.id,
        result,
      ),
    );
  }
}
