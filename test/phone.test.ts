import { describe, expect, it } from "vitest";

import { normalizeIranianMobile, toIranianLocalMobile } from "../src/index.js";

describe("Iranian mobile normalization", () => {
  it.each(["09123456789", "989123456789", "+989123456789", "00989123456789"])(
    "normalizes %s",
    (input) => {
      expect(normalizeIranianMobile(input)).toBe("+989123456789");
    },
  );

  it("converts canonical input to provider-local format", () => {
    expect(toIranianLocalMobile("+989123456789")).toBe("09123456789");
  });

  it.each(["", "9123456789", "0912345678", "02112345678", "+12025550123"])(
    "rejects invalid input %s",
    (input) => {
      expect(() => normalizeIranianMobile(input)).toThrow(
        "valid Iranian mobile number",
      );
    },
  );
});
