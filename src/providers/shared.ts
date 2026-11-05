import type {
  CredentialVerificationResult,
  ProviderSubmissionResult,
} from "../core/provider.js";

export function unavailableVerification(): CredentialVerificationResult {
  return { status: "unavailable", retryable: true };
}

export function invalidVerification(): CredentialVerificationResult {
  return { status: "invalid", code: "invalid_credentials" };
}

export function verified(
  method: "account" | "credit" | "profile" | "lines",
): CredentialVerificationResult {
  return { status: "verified", method, verifiedAt: new Date() };
}

export function unknownSubmission(): ProviderSubmissionResult {
  return { status: "unknown", code: "unknown_outcome" };
}

export function rejected(code: string): ProviderSubmissionResult {
  return { status: "rejected", code, retryable: false };
}
