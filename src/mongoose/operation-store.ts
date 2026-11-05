import { Types } from "mongoose";

import type {
  OperationSnapshot,
  SendOperationStore,
} from "../core/orchestrator.js";
import type { ProviderSubmissionResult } from "../core/provider.js";
import {
  MongooseIdempotencyStore,
  type ReserveOperationInput,
} from "./idempotency.js";
import type { SmsMongooseModels } from "./models.js";

export class OperationStateConflictError extends Error {
  readonly code = "operation_state_conflict";

  constructor(message: string) {
    super(message);
    this.name = "OperationStateConflictError";
  }
}

function snapshot(record: {
  readonly _id: unknown;
  readonly state: OperationSnapshot["state"];
  readonly providerMessageId?: string | null;
}): OperationSnapshot {
  return {
    id: String(record._id),
    state: record.state,
    ...(record.providerMessageId === undefined ||
    record.providerMessageId === null
      ? {}
      : { providerMessageId: record.providerMessageId }),
  };
}

function completion(result: ProviderSubmissionResult): {
  operationState: OperationSnapshot["state"];
  attemptState: "accepted" | "rejected" | "pre_acceptance_failure" | "unknown";
  providerMessageId?: string;
  normalizedError?: { code: string };
} {
  switch (result.status) {
    case "accepted":
      return {
        operationState: "submitted",
        attemptState: "accepted",
        providerMessageId: result.providerMessageId,
      };
    case "rejected":
      return {
        operationState: "failed",
        attemptState: "rejected",
        normalizedError: { code: result.code },
      };
    case "pre-acceptance-failure":
      return {
        operationState: "failed",
        attemptState: "pre_acceptance_failure",
        normalizedError: { code: result.code },
      };
    case "unknown":
      return {
        operationState: "unknown",
        attemptState: "unknown",
        normalizedError: { code: result.code },
      };
  }
}

export class MongooseSendOperationStore implements SendOperationStore {
  private readonly idempotency: MongooseIdempotencyStore;

  constructor(private readonly models: SmsMongooseModels) {
    this.idempotency = new MongooseIdempotencyStore(models.SendOperation);
  }

  async reserve(input: ReserveOperationInput) {
    const result = await this.idempotency.reserve(input);
    return { created: result.created, operation: snapshot(result.operation) };
  }

  async beginAttempt(input: {
    readonly operationId: string;
    readonly providerConfigurationId: string;
    readonly adapterId: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    if (
      !Types.ObjectId.isValid(input.operationId) ||
      !Types.ObjectId.isValid(input.providerConfigurationId)
    ) {
      throw new OperationStateConflictError(
        "Invalid operation or provider identifier.",
      );
    }

    const operation = await this.models.SendOperation.findOneAndUpdate(
      { _id: input.operationId, state: "reserved", currentAttemptNumber: 0 },
      { $set: { state: "processing" }, $inc: { currentAttemptNumber: 1 } },
      { returnDocument: "after" },
    )
      .lean()
      .exec();
    if (operation === null) {
      throw new OperationStateConflictError(
        "Operation is not available for dispatch.",
      );
    }

    try {
      await this.models.SendAttempt.create({
        operationId: operation._id,
        attemptNumber: 1,
        providerConfigurationId: new Types.ObjectId(
          input.providerConfigurationId,
        ),
        adapterId: input.adapterId,
        state: "dispatching",
        startedAt: new Date(),
        expiresAt: input.expiresAt,
      });
    } catch (cause) {
      await this.models.SendOperation.updateOne(
        { _id: operation._id, state: "processing", currentAttemptNumber: 1 },
        { $set: { state: "reserved", currentAttemptNumber: 0 } },
      ).exec();
      throw cause;
    }
  }

  async completeAttempt(
    operationId: string,
    result: ProviderSubmissionResult,
  ): Promise<OperationSnapshot> {
    if (!Types.ObjectId.isValid(operationId)) {
      throw new OperationStateConflictError("Invalid operation identifier.");
    }
    const mapped = completion(result);
    const operation = await this.models.SendOperation.findOneAndUpdate(
      { _id: operationId, state: "processing", currentAttemptNumber: 1 },
      {
        $set: {
          state: mapped.operationState,
          ...(mapped.providerMessageId === undefined
            ? {}
            : { providerMessageId: mapped.providerMessageId }),
          ...(mapped.normalizedError === undefined
            ? {}
            : { normalizedError: mapped.normalizedError }),
        },
      },
      { returnDocument: "after" },
    )
      .lean()
      .exec();
    if (operation === null) {
      throw new OperationStateConflictError(
        "Logical operation could not be completed.",
      );
    }

    await this.models.SendAttempt.updateOne(
      { operationId, attemptNumber: 1, state: "dispatching" },
      {
        $set: {
          state: mapped.attemptState,
          completedAt: new Date(),
          ...(mapped.providerMessageId === undefined
            ? {}
            : { providerMessageId: mapped.providerMessageId }),
          ...(mapped.normalizedError === undefined
            ? {}
            : { normalizedError: mapped.normalizedError }),
        },
      },
    ).exec();
    return snapshot(operation);
  }
}
