const IRAN_MOBILE_LOCAL = /^09\d{9}$/;

export class InvalidIranianMobileNumberError extends TypeError {
  readonly code = "invalid_recipient";

  constructor() {
    super("Recipient must be a valid Iranian mobile number.");
    this.name = "InvalidIranianMobileNumberError";
  }
}

export function normalizeIranianMobile(input: string): `+98${string}` {
  const normalized = input
    .trim()
    .replace(/^0098/, "0")
    .replace(/^\+98/, "0")
    .replace(/^98/, "0");

  if (!IRAN_MOBILE_LOCAL.test(normalized)) {
    throw new InvalidIranianMobileNumberError();
  }

  return `+98${normalized.slice(1)}`;
}

export function toIranianLocalMobile(input: string): `09${string}` {
  const canonical = normalizeIranianMobile(input);
  return `0${canonical.slice(3)}` as `09${string}`;
}
