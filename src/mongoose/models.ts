import { Schema, type Connection, type Model, type Types } from "mongoose";

import type { EncryptedCredentialEnvelope } from "../security/encryption.js";

export interface ProviderConfigurationRecord {
  scopeKey: string;
  adapterId: string;
  label: string;
  encryptedCredentials?: EncryptedCredentialEnvelope;
  credentialRevision: number;
  verification: {
    status: "unverified" | "verified" | "invalid" | "unavailable";
    method?: string;
    verifiedAt?: Date;
    safeErrorCode?: string;
  };
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActionConfigurationRecord {
  scopeKey: string;
  actionKey: string;
  providerConfigurationId: Types.ObjectId;
  templateReference: unknown;
  bindings: unknown[];
  validation: {
    level: "local" | "remote" | "deferred";
    remoteTemplateFingerprint?: string;
    validatedAt: Date;
    warnings: string[];
  };
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SendOperationState =
  "reserved" | "processing" | "submitted" | "delivered" | "failed" | "unknown";

export interface SendOperationRecord {
  scopeKey: string;
  actionKey: string;
  actionDefinitionVersion: string;
  configurationVersion: number;
  idempotencyKey: string;
  requestFingerprint: string;
  recipientFingerprint: string;
  state: SendOperationState;
  currentAttemptNumber: number;
  providerMessageId?: string;
  normalizedError?: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendAttemptRecord {
  operationId: Types.ObjectId;
  attemptNumber: number;
  providerConfigurationId: Types.ObjectId;
  adapterId: string;
  state:
    | "created"
    | "dispatching"
    | "accepted"
    | "delivered"
    | "rejected"
    | "pre_acceptance_failure"
    | "unknown";
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  providerMessageId?: string;
  normalizedError?: unknown;
  safeDiagnostics?: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsMongooseModels {
  ProviderConfiguration: Model<ProviderConfigurationRecord>;
  ActionConfiguration: Model<ActionConfigurationRecord>;
  SendOperation: Model<SendOperationRecord>;
  SendAttempt: Model<SendAttemptRecord>;
}

const encryptedCredentialSchema = new Schema<EncryptedCredentialEnvelope>(
  {
    algorithm: { type: String, required: true, enum: ["aes-256-gcm"] },
    keyId: { type: String, required: true },
    configurationId: { type: String, required: true },
    adapterId: { type: String, required: true },
    scopeKey: { type: String, required: true },
    credentialRevision: { type: Number, required: true },
    nonce: { type: String, required: true, select: false },
    ciphertext: { type: String, required: true, select: false },
    authTag: { type: String, required: true, select: false },
    schemaVersion: { type: Number, required: true },
  },
  { _id: false },
);

const providerConfigurationSchema = new Schema<ProviderConfigurationRecord>(
  {
    scopeKey: { type: String, required: true },
    adapterId: { type: String, required: true },
    label: { type: String, required: true },
    encryptedCredentials: { type: encryptedCredentialSchema, select: false },
    credentialRevision: { type: Number, required: true, default: 0 },
    verification: {
      status: {
        type: String,
        required: true,
        enum: ["unverified", "verified", "invalid", "unavailable"],
        default: "unverified",
      },
      method: String,
      verifiedAt: Date,
      safeErrorCode: String,
    },
    enabled: { type: Boolean, required: true, default: false },
    version: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, minimize: false },
);
providerConfigurationSchema.index({ scopeKey: 1, label: 1 }, { unique: true });
providerConfigurationSchema.index({ scopeKey: 1, adapterId: 1, enabled: 1 });

const actionConfigurationSchema = new Schema<ActionConfigurationRecord>(
  {
    scopeKey: { type: String, required: true },
    actionKey: { type: String, required: true },
    providerConfigurationId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    templateReference: { type: Schema.Types.Mixed, required: true },
    bindings: { type: [Schema.Types.Mixed], required: true, default: [] },
    validation: {
      level: {
        type: String,
        required: true,
        enum: ["local", "remote", "deferred"],
      },
      remoteTemplateFingerprint: String,
      validatedAt: { type: Date, required: true },
      warnings: { type: [String], required: true, default: [] },
    },
    enabled: { type: Boolean, required: true, default: false },
    version: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, minimize: false },
);
actionConfigurationSchema.index(
  { scopeKey: 1, actionKey: 1 },
  { unique: true },
);

const sendOperationSchema = new Schema<SendOperationRecord>(
  {
    scopeKey: { type: String, required: true },
    actionKey: { type: String, required: true },
    actionDefinitionVersion: { type: String, required: true },
    configurationVersion: { type: Number, required: true },
    idempotencyKey: { type: String, required: true },
    requestFingerprint: { type: String, required: true, select: false },
    recipientFingerprint: { type: String, required: true, select: false },
    state: {
      type: String,
      required: true,
      enum: [
        "reserved",
        "processing",
        "submitted",
        "delivered",
        "failed",
        "unknown",
      ],
      default: "reserved",
    },
    currentAttemptNumber: { type: Number, required: true, default: 0 },
    providerMessageId: String,
    normalizedError: Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
sendOperationSchema.index(
  { scopeKey: 1, actionKey: 1, idempotencyKey: 1 },
  { unique: true },
);
sendOperationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const sendAttemptSchema = new Schema<SendAttemptRecord>(
  {
    operationId: { type: Schema.Types.ObjectId, required: true },
    attemptNumber: { type: Number, required: true },
    providerConfigurationId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    adapterId: { type: String, required: true },
    state: {
      type: String,
      required: true,
      enum: [
        "created",
        "dispatching",
        "accepted",
        "delivered",
        "rejected",
        "pre_acceptance_failure",
        "unknown",
      ],
    },
    startedAt: { type: Date, required: true },
    completedAt: Date,
    durationMs: Number,
    providerMessageId: String,
    normalizedError: Schema.Types.Mixed,
    safeDiagnostics: Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
sendAttemptSchema.index({ operationId: 1, attemptNumber: 1 }, { unique: true });
sendAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function modelFor<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
  collection: string,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema, collection)
  );
}

export function createSmsMongooseModels(
  connection: Connection,
  options: { readonly collectionPrefix?: string } = {},
): SmsMongooseModels {
  const prefix = options.collectionPrefix ?? "sms";
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) {
    throw new TypeError("Collection prefix contains unsupported characters.");
  }
  const modelPrefix = prefix.replace(/[^a-zA-Z0-9]/g, "_");

  return {
    ProviderConfiguration: modelFor(
      connection,
      `${modelPrefix}_SmsProviderConfiguration`,
      providerConfigurationSchema,
      `${prefix}_provider_configurations`,
    ),
    ActionConfiguration: modelFor(
      connection,
      `${modelPrefix}_SmsActionConfiguration`,
      actionConfigurationSchema,
      `${prefix}_action_configurations`,
    ),
    SendOperation: modelFor(
      connection,
      `${modelPrefix}_SmsSendOperation`,
      sendOperationSchema,
      `${prefix}_send_operations`,
    ),
    SendAttempt: modelFor(
      connection,
      `${modelPrefix}_SmsSendAttempt`,
      sendAttemptSchema,
      `${prefix}_send_attempts`,
    ),
  };
}
