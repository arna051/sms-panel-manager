import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createPrivacyFingerprint,
  createEnvironmentKeyring,
  createStaticKeyring,
  decryptCredentials,
  encryptCredentials,
} from "../src/index.js";

const context = {
  configurationId: "provider-1",
  adapterId: "ghasedak",
  scopeKey: "global",
  credentialRevision: 1,
  schemaVersion: 1,
} as const;

describe("credential encryption", () => {
  it("round-trips authenticated credentials", async () => {
    const keyring = createStaticKeyring({
      activeKeyId: "key-1",
      keys: { "key-1": randomBytes(32) },
    });
    const envelope = await encryptCredentials(
      { apiKey: "secret" },
      context,
      keyring,
    );

    await expect(
      decryptCredentials(envelope, context, keyring),
    ).resolves.toEqual({
      apiKey: "secret",
    });
    expect(JSON.stringify(envelope)).not.toContain("secret");
  });

  it("uses a unique nonce for every write", async () => {
    const keyring = createStaticKeyring({
      activeKeyId: "key-1",
      keys: { "key-1": randomBytes(32) },
    });
    const left = await encryptCredentials({ apiKey: "same" }, context, keyring);
    const right = await encryptCredentials(
      { apiKey: "same" },
      context,
      keyring,
    );

    expect(left.nonce).not.toBe(right.nonce);
    expect(left.ciphertext).not.toBe(right.ciphertext);
  });

  it("rejects tampering and associated-data changes", async () => {
    const keyring = createStaticKeyring({
      activeKeyId: "key-1",
      keys: { "key-1": randomBytes(32) },
    });
    const envelope = await encryptCredentials(
      { apiKey: "secret" },
      context,
      keyring,
    );

    await expect(
      decryptCredentials(
        { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` },
        context,
        keyring,
      ),
    ).rejects.toMatchObject({ code: "credential_encryption_failed" });

    await expect(
      decryptCredentials(
        envelope,
        { ...context, adapterId: "kavenegar" },
        keyring,
      ),
    ).rejects.toMatchObject({ code: "credential_encryption_failed" });
  });

  it("supports historical keys during rotation", async () => {
    const oldKey = randomBytes(32);
    const envelope = await encryptCredentials(
      { apiKey: "secret" },
      context,
      createStaticKeyring({ activeKeyId: "old", keys: { old: oldKey } }),
    );
    const rotatingKeyring = createStaticKeyring({
      activeKeyId: "new",
      keys: { old: oldKey, new: randomBytes(32) },
    });

    await expect(
      decryptCredentials(envelope, context, rotatingKeyring),
    ).resolves.toEqual({
      apiKey: "secret",
    });
  });

  it("loads base64-encoded environment keys explicitly", async () => {
    const key = randomBytes(32);
    const keyring = createEnvironmentKeyring({
      activeKeyId: "environment",
      keys: { environment: key.toString("base64") },
    });
    const envelope = await encryptCredentials(
      { apiKey: "secret" },
      context,
      keyring,
    );
    await expect(
      decryptCredentials(envelope, context, keyring),
    ).resolves.toEqual({
      apiKey: "secret",
    });
  });

  it("fails fast for missing or invalid active keys", () => {
    expect(() =>
      createStaticKeyring({ activeKeyId: "missing", keys: {} }),
    ).toThrow(/unavailable/);
    expect(() =>
      createStaticKeyring({
        activeKeyId: "short",
        keys: { short: randomBytes(16) },
      }),
    ).toThrow(/32 bytes/);
  });

  it("rejects malformed nonce and tag lengths before decryption", async () => {
    const keyring = createStaticKeyring({
      activeKeyId: "key-1",
      keys: { "key-1": randomBytes(32) },
    });
    const envelope = await encryptCredentials(
      { apiKey: "secret" },
      context,
      keyring,
    );
    await expect(
      decryptCredentials({ ...envelope, nonce: "AA==" }, context, keyring),
    ).rejects.toThrow(/nonce or tag length/);
  });
});

describe("privacy fingerprints", () => {
  it("is deterministic across object key order", () => {
    const secret = randomBytes(32);
    expect(createPrivacyFingerprint(secret, "request", { b: 2, a: 1 })).toBe(
      createPrivacyFingerprint(secret, "request", { a: 1, b: 2 }),
    );
  });

  it("separates fingerprint namespaces", () => {
    const secret = randomBytes(32);
    expect(
      createPrivacyFingerprint(secret, "recipient", "+989123456789"),
    ).not.toBe(createPrivacyFingerprint(secret, "request", "+989123456789"));
  });
});
