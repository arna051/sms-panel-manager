import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createConnection, type Connection } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSmsMongooseModels,
  IdempotencyConflictError,
  MongooseIdempotencyStore,
  MongooseSendOperationStore,
  type SmsMongooseModels,
} from "../src/mongoose/index.js";

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not allocate a MongoDB test port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

const describeMongo = existsSync("/bin/mongod") ? describe : describe.skip;

describeMongo("Mongoose idempotency integration", () => {
  let process: ChildProcess | undefined;
  let directory: string | undefined;
  let connection: Connection | undefined;
  let models: SmsMongooseModels | undefined;

  beforeAll(async () => {
    const testDirectory = await mkdtemp(
      join(tmpdir(), "sms-panel-manager-mongo-"),
    );
    directory = testDirectory;
    const port = await availablePort();
    process = spawn("/bin/mongod", [
      "--dbpath",
      testDirectory,
      "--port",
      String(port),
      "--bind_ip",
      "127.0.0.1",
      "--quiet",
      "--nounixsocket",
    ]);
    connection = createConnection(
      `mongodb://127.0.0.1:${String(port)}/sms_panel_test`,
      {
        serverSelectionTimeoutMS: 10_000,
      },
    );
    await connection.asPromise();
    models = createSmsMongooseModels(connection, {
      collectionPrefix: "integration_sms",
    });
    await models.SendOperation.syncIndexes();
  }, 20_000);

  afterAll(async () => {
    if (connection !== undefined) await connection.close();
    if (process !== undefined) {
      process.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        process?.once("exit", () => {
          resolve();
        });
      });
    }
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
  });

  it("allows one concurrent reservation for one logical send", async () => {
    if (models === undefined)
      throw new Error("MongoDB test models are unavailable.");
    const store = new MongooseIdempotencyStore(models.SendOperation);
    const input = {
      scopeKey: "global",
      actionKey: "package_posted",
      actionDefinitionVersion: "v1",
      configurationVersion: 1,
      idempotencyKey: "shipment-123",
      requestFingerprint: "same-fingerprint",
      recipientFingerprint: "recipient-fingerprint",
      expiresAt: new Date(Date.now() + 60_000),
    } as const;

    const reservations = await Promise.all(
      Array.from({ length: 12 }, async () => store.reserve(input)),
    );

    expect(reservations.filter((item) => item.created)).toHaveLength(1);
    expect(await models.SendOperation.countDocuments()).toBe(1);
    expect(
      new Set(reservations.map((item) => String(item.operation._id))).size,
    ).toBe(1);
  });

  it("rejects reuse of a key with another request", async () => {
    if (models === undefined)
      throw new Error("MongoDB test models are unavailable.");
    const store = new MongooseIdempotencyStore(models.SendOperation);

    await expect(
      store.reserve({
        scopeKey: "global",
        actionKey: "package_posted",
        actionDefinitionVersion: "v1",
        configurationVersion: 1,
        idempotencyKey: "shipment-123",
        requestFingerprint: "different-fingerprint",
        recipientFingerprint: "recipient-fingerprint",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("persists the attempt and accepted operation transition", async () => {
    if (models === undefined)
      throw new Error("MongoDB test models are unavailable.");
    const provider = await models.ProviderConfiguration.create({
      scopeKey: "global",
      adapterId: "test",
      label: "Test provider",
      verification: { status: "verified" },
      enabled: true,
      version: 1,
    });
    const store = new MongooseSendOperationStore(models);
    const reserved = await store.reserve({
      scopeKey: "global",
      actionKey: "auth",
      actionDefinitionVersion: "v1",
      configurationVersion: 1,
      idempotencyKey: "login-1",
      requestFingerprint: "request-auth",
      recipientFingerprint: "recipient-auth",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await store.beginAttempt({
      operationId: reserved.operation.id,
      providerConfigurationId: String(provider._id),
      adapterId: "test",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const completed = await store.completeAttempt(reserved.operation.id, {
      status: "accepted",
      providerMessageId: "message-1",
    });

    expect(completed).toMatchObject({
      state: "submitted",
      providerMessageId: "message-1",
    });
    await expect(
      models.SendAttempt.findOne({ operationId: reserved.operation.id })
        .lean()
        .exec(),
    ).resolves.toMatchObject({
      state: "accepted",
      providerMessageId: "message-1",
      attemptNumber: 1,
    });
  });
});
