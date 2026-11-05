import { createHmac, timingSafeEqual } from "node:crypto";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Cannot fingerprint a non-finite number.");
    }
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Cannot fingerprint an invalid date.");
    }
    return { $date: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects can be fingerprinted.");
    }
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new TypeError("Unsafe object key cannot be fingerprinted.");
      }
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) {
        throw new TypeError("Undefined values cannot be fingerprinted.");
      }
      result[key] = canonicalize(item);
    }
    return result;
  }
  throw new TypeError(`Unsupported fingerprint value: ${typeof value}.`);
}

export function createPrivacyFingerprint(
  secret: Uint8Array,
  namespace: string,
  value: unknown,
): string {
  if (secret.byteLength < 32) {
    throw new TypeError("Fingerprint secret must contain at least 32 bytes.");
  }
  const canonical = JSON.stringify(canonicalize(value));
  return createHmac("sha256", secret)
    .update(namespace)
    .update("\0")
    .update(canonical)
    .digest("base64url");
}

export function fingerprintsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
