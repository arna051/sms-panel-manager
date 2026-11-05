import { randomBytes } from "node:crypto";

import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  SmsOrchestrator,
  type OperationSnapshot,
  type ProviderSubmissionResult,
  type SendOperationStore,
  type SmsProviderAdapter,
} from "../src/index.js";

class MemoryOperationStore implements SendOperationStore {
  readonly operations = new Map<
    string,
    OperationSnapshot & { fingerprint: string }
  >();
  beginCount = 0;

  async reserve(input: {
    scopeKey: string;
    actionKey: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }) {
    const key = `${input.scopeKey}:${input.actionKey}:${input.idempotencyKey}`;
    const existing = this.operations.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== input.requestFingerprint) {
        throw new Error("idempotency_conflict");
      }
      return { created: false, operation: existing };
    }
    const operation = {
      id: `operation-${this.operations.size + 1}`,
      state: "reserved" as const,
      fingerprint: input.requestFingerprint,
    };
    this.operations.set(key, operation);
    return { created: true, operation };
  }

  async beginAttempt(input: { operationId: string }) {
    this.beginCount += 1;
    for (const [key, operation] of this.operations) {
      if (operation.id === input.operationId) {
        this.operations.set(key, { ...operation, state: "processing" });
      }
    }
  }

  async completeAttempt(operationId: string, result: ProviderSubmissionResult) {
    for (const [key, operation] of this.operations) {
      if (operation.id !== operationId) continue;
      const completed: OperationSnapshot & { fingerprint: string } =
        result.status === "accepted"
          ? {
              ...operation,
              state: "submitted",
              providerMessageId: result.providerMessageId,
            }
          : result.status === "unknown"
            ? { ...operation, state: "unknown" }
            : { ...operation, state: "failed" };
      this.operations.set(key, completed);
      return completed;
    }
    throw new Error("operation not found");
  }
}

function testAdapter(
  sendTemplate: SmsProviderAdapter<Record<string, unknown>>["sendTemplate"],
) {
  return {
    id: "test",
    credentialSchema: z.record(z.string(), z.unknown()),
    capabilities: {
      credentialVerification: { mode: "account" },
      templates: {
        binding: "named",
        canList: false,
        canInspect: false,
        canCreate: false,
      },
      deliveryStatus: "unsupported",
      providerIdempotency: false,
    },
    async verifyCredentials() {
      return {
        status: "verified" as const,
        method: "account" as const,
        verifiedAt: new Date(),
      };
    },
    sendTemplate,
  } satisfies SmsProviderAdapter<Record<string, unknown>>;
}

describe("SMS orchestrator", () => {
  it("maps, submits, and deduplicates one logical send", async () => {
    const operations = new MemoryOperationStore();
    const sendTemplate = vi.fn().mockResolvedValue({
      status: "accepted",
      providerMessageId: "provider-1",
    });
    const orchestrator = new SmsOrchestrator({
      actionDefinitionVersion: "v1",
      fingerprintSecret: randomBytes(32),
      operations,
      configurations: {
        async resolve() {
          return {
            id: "configuration-1",
            version: 1,
            adapter: testAdapter(sendTemplate),
            credentials: { apiKey: "secret" },
            template: "posted",
            bindings: [
              {
                kind: "named",
                providerParameter: "tracking",
                sourceParameter: "trackingCode",
              },
            ],
          };
        },
      },
    });
    const command = {
      actionKey: "package_posted",
      recipient: "+989123456789" as const,
      parameters: { trackingCode: "T-1" },
      options: { idempotencyKey: "shipment-1" },
    };

    const first = await orchestrator.execute(command);
    const second = await orchestrator.execute(command);

    expect(first).toEqual({
      operationId: "operation-1",
      status: "submitted",
      providerMessageId: "provider-1",
    });
    expect(second).toEqual(first);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(operations.beginCount).toBe(1);
    expect(sendTemplate).toHaveBeenCalledWith(
      { apiKey: "secret" },
      {
        recipient: "+989123456789",
        template: "posted",
        parameters: { tracking: "T-1" },
        clientReferenceId: "shipment-1",
      },
      {},
    );
  });

  it("records an unexpected adapter throw as unknown without retrying", async () => {
    const operations = new MemoryOperationStore();
    const sendTemplate = vi.fn().mockRejectedValue(new Error("socket reset"));
    const orchestrator = new SmsOrchestrator({
      actionDefinitionVersion: "v1",
      fingerprintSecret: randomBytes(32),
      operations,
      configurations: {
        async resolve() {
          return {
            id: "configuration-1",
            version: 1,
            adapter: testAdapter(sendTemplate),
            credentials: {},
            template: "posted",
            bindings: [
              {
                kind: "named",
                providerParameter: "tracking",
                sourceParameter: "trackingCode",
              },
            ],
          };
        },
      },
    });

    await expect(
      orchestrator.execute({
        actionKey: "package_posted",
        recipient: "+989123456789",
        parameters: { trackingCode: "T-1" },
        options: { idempotencyKey: "shipment-1" },
      }),
    ).resolves.toMatchObject({ status: "unknown" });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it("includes provider configuration identity in idempotency", async () => {
    const operations = new MemoryOperationStore();
    let configurationId = "configuration-1";
    const orchestrator = new SmsOrchestrator({
      actionDefinitionVersion: "v1",
      fingerprintSecret: randomBytes(32),
      operations,
      configurations: {
        async resolve() {
          return {
            id: configurationId,
            version: 1,
            adapter: testAdapter(
              vi.fn().mockResolvedValue({
                status: "accepted",
                providerMessageId: "message-1",
              }),
            ),
            credentials: {},
            template: "posted",
            bindings: [
              {
                kind: "named",
                providerParameter: "tracking",
                sourceParameter: "trackingCode",
              },
            ],
          };
        },
      },
    });
    const command = {
      actionKey: "package_posted",
      recipient: "+989123456789" as const,
      parameters: { trackingCode: "T-1" },
      options: { idempotencyKey: "shipment-1" },
    };
    await orchestrator.execute(command);
    configurationId = "configuration-2";
    await expect(orchestrator.execute(command)).rejects.toThrow(
      "idempotency_conflict",
    );
  });

  it("rejects invalid idempotency key lengths before resolution", async () => {
    const resolve = vi.fn();
    const orchestrator = new SmsOrchestrator({
      actionDefinitionVersion: "v1",
      fingerprintSecret: randomBytes(32),
      operations: new MemoryOperationStore(),
      configurations: { resolve },
    });
    await expect(
      orchestrator.execute({
        actionKey: "auth",
        recipient: "+989123456789",
        parameters: { code: "1" },
        options: { idempotencyKey: "" },
      }),
    ).rejects.toThrow(/between 1 and 200/);
    expect(resolve).not.toHaveBeenCalled();
  });
});
