import { createConnection } from "mongoose";
import { describe, expect, it } from "vitest";

import { createSmsMongooseModels } from "../src/mongoose/index.js";

describe("Mongoose models", () => {
  it("uses a caller-supplied connection without opening it", () => {
    const connection = createConnection();
    const models = createSmsMongooseModels(connection);

    expect(connection.readyState).toBe(0);
    expect(models.ProviderConfiguration.collection.name).toBe(
      "sms_provider_configurations",
    );
    expect(models.SendOperation.schema.indexes()).toContainEqual([
      { scopeKey: 1, actionKey: 1, idempotencyKey: 1 },
      { unique: true },
    ]);
    expect(models.SendOperation.schema.indexes()).toContainEqual([
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ]);
  });

  it("reuses models on the same connection", () => {
    const connection = createConnection();
    const first = createSmsMongooseModels(connection);
    const second = createSmsMongooseModels(connection);
    expect(first.SendOperation).toBe(second.SendOperation);
  });

  it("isolates models created with different collection prefixes", () => {
    const connection = createConnection();
    const first = createSmsMongooseModels(connection, {
      collectionPrefix: "first",
    });
    const second = createSmsMongooseModels(connection, {
      collectionPrefix: "second",
    });
    expect(first.SendOperation).not.toBe(second.SendOperation);
    expect(first.SendOperation.collection.name).toBe("first_send_operations");
    expect(second.SendOperation.collection.name).toBe("second_send_operations");
  });
});
