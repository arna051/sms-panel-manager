import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptionKeyring {
  readonly activeKeyId: string;
  getKey(
    keyId: string,
  ): Promise<Uint8Array | undefined> | Uint8Array | undefined;
}

export interface CredentialEncryptionContext {
  readonly configurationId: string;
  readonly adapterId: string;
  readonly scopeKey: string;
  readonly credentialRevision: number;
  readonly schemaVersion: number;
}

export interface EncryptedCredentialEnvelope {
  readonly algorithm: string;
  readonly keyId: string;
  readonly configurationId: string;
  readonly adapterId: string;
  readonly scopeKey: string;
  readonly credentialRevision: number;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
  readonly schemaVersion: number;
}

export class CredentialEncryptionError extends Error {
  readonly code = "credential_encryption_failed";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialEncryptionError";
  }
}

function associatedData(
  context: CredentialEncryptionContext,
  keyId: string,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: "sms-provider-credentials",
      configurationId: context.configurationId,
      adapterId: context.adapterId,
      scopeKey: context.scopeKey,
      credentialRevision: context.credentialRevision,
      schemaVersion: context.schemaVersion,
      keyId,
    }),
    "utf8",
  );
}

function validKey(key: Uint8Array | undefined, keyId: string): Buffer {
  if (key === undefined) {
    throw new CredentialEncryptionError(
      `Encryption key "${keyId}" is unavailable.`,
    );
  }
  if (key.byteLength !== KEY_LENGTH) {
    throw new CredentialEncryptionError(
      `Encryption key "${keyId}" must be exactly 32 bytes.`,
    );
  }
  return Buffer.from(key);
}

export async function encryptCredentials(
  credentials: Readonly<Record<string, unknown>>,
  context: CredentialEncryptionContext,
  keyring: EncryptionKeyring,
): Promise<EncryptedCredentialEnvelope> {
  const keyId = keyring.activeKeyId;
  const key = validKey(await keyring.getKey(keyId), keyId);
  const nonce = randomBytes(NONCE_LENGTH);

  try {
    const cipher = createCipheriv(ALGORITHM, key, nonce, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(associatedData(context, keyId));
    const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);

    return {
      algorithm: ALGORITHM,
      keyId,
      configurationId: context.configurationId,
      adapterId: context.adapterId,
      scopeKey: context.scopeKey,
      credentialRevision: context.credentialRevision,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      schemaVersion: context.schemaVersion,
    };
  } catch (cause) {
    throw new CredentialEncryptionError(
      "Could not encrypt provider credentials.",
      {
        cause,
      },
    );
  } finally {
    key.fill(0);
  }
}

export async function decryptCredentials<T extends Record<string, unknown>>(
  envelope: EncryptedCredentialEnvelope,
  context: CredentialEncryptionContext,
  keyring: EncryptionKeyring,
): Promise<T> {
  if (envelope.algorithm !== ALGORITHM) {
    throw new CredentialEncryptionError(
      "Unsupported credential encryption algorithm.",
    );
  }
  if (envelope.schemaVersion !== context.schemaVersion) {
    throw new CredentialEncryptionError("Credential schema version mismatch.");
  }
  if (
    envelope.configurationId !== context.configurationId ||
    envelope.adapterId !== context.adapterId ||
    envelope.scopeKey !== context.scopeKey ||
    envelope.credentialRevision !== context.credentialRevision
  ) {
    throw new CredentialEncryptionError(
      "Credential encryption context mismatch.",
    );
  }
  const nonce = Buffer.from(envelope.nonce, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  if (
    nonce.byteLength !== NONCE_LENGTH ||
    authTag.byteLength !== AUTH_TAG_LENGTH
  ) {
    throw new CredentialEncryptionError(
      "Credential envelope has invalid nonce or tag length.",
    );
  }

  const key = validKey(await keyring.getKey(envelope.keyId), envelope.keyId);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(associatedData(context, envelope.keyId));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (cause) {
    throw new CredentialEncryptionError(
      "Provider credentials could not be authenticated or decrypted.",
      { cause },
    );
  } finally {
    key.fill(0);
  }
}

export function createStaticKeyring(options: {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
}): EncryptionKeyring {
  if (!(options.activeKeyId in options.keys)) {
    throw new CredentialEncryptionError(
      `Active encryption key "${options.activeKeyId}" is unavailable.`,
    );
  }
  const keys = new Map(
    Object.entries(options.keys).map(([id, key]) => [id, validKey(key, id)]),
  );

  return {
    activeKeyId: options.activeKeyId,
    getKey(keyId) {
      const key = keys.get(keyId);
      return key === undefined ? undefined : Buffer.from(key);
    },
  };
}

export function createEnvironmentKeyring(options: {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly encoding?: "base64" | "hex";
}): EncryptionKeyring {
  const encoding = options.encoding ?? "base64";
  return createStaticKeyring({
    activeKeyId: options.activeKeyId,
    keys: Object.fromEntries(
      Object.entries(options.keys).map(([keyId, value]) => [
        keyId,
        Buffer.from(value, encoding),
      ]),
    ),
  });
}
