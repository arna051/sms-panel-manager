import { timingSafeEqual } from "node:crypto";

import type { Model } from "mongoose";

import type { SendOperationRecord } from "./models.js";

export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";

  constructor() {
    super("The idempotency key was already used with another request.");
    this.name = "IdempotencyConflictError";
  }
}

export interface ReserveOperationInput {
  readonly scopeKey: string;
  readonly actionKey: string;
  readonly actionDefinitionVersion: string;
  readonly configurationVersion: number;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly recipientFingerprint: string;
  readonly expiresAt: Date;
}

export interface ReservedOperation {
  readonly created: boolean;
  readonly operation: SendOperationRecord & { readonly _id: unknown };
}

function isDuplicateKeyError(error: unknown): error is { code: 11000 } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function fingerprintsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export class MongooseIdempotencyStore {
  constructor(private readonly model: Model<SendOperationRecord>) {}

  async reserve(input: ReserveOperationInput): Promise<ReservedOperation> {
    try {
      const created = await this.model.create({
        ...input,
        state: "reserved",
        currentAttemptNumber: 0,
      });
      return {
        created: true,
        operation: created.toObject(),
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      const existing = await this.model
        .findOne({
          scopeKey: input.scopeKey,
          actionKey: input.actionKey,
          idempotencyKey: input.idempotencyKey,
        })
        .select("+requestFingerprint +recipientFingerprint")
        .lean()
        .exec();

      if (existing === null) throw error;
      if (
        !fingerprintsEqual(
          existing.requestFingerprint,
          input.requestFingerprint,
        )
      ) {
        throw new IdempotencyConflictError();
      }

      return {
        created: false,
        operation: existing,
      };
    }
  }
}
