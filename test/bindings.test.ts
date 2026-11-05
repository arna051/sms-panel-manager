import { describe, expect, it } from "vitest";

import { applyParameterBindings } from "../src/index.js";

describe("parameter bindings", () => {
  it("maps named provider parameters", () => {
    expect(
      applyParameterBindings({ customerName: "Ali", trackingCode: "T-1" }, [
        {
          kind: "named",
          providerParameter: "name",
          sourceParameter: "customerName",
        },
        {
          kind: "named",
          providerParameter: "tracking",
          sourceParameter: "trackingCode",
        },
      ]),
    ).toEqual({ name: "Ali", tracking: "T-1" });
  });

  it("sorts and maps contiguous ordered parameters", () => {
    expect(
      applyParameterBindings({ first: "A", second: "B" }, [
        { kind: "ordered", position: 2, sourceParameter: "second" },
        { kind: "ordered", position: 1, sourceParameter: "first" },
      ]),
    ).toEqual(["A", "B"]);
  });

  it("omits absent optional named and trailing ordered parameters", () => {
    expect(
      applyParameterBindings({ required: "A" }, [
        {
          kind: "named",
          providerParameter: "required_token",
          sourceParameter: "required",
        },
        {
          kind: "named",
          providerParameter: "optional_token",
          sourceParameter: "optional",
        },
      ]),
    ).toEqual({ required_token: "A" });
    expect(
      applyParameterBindings({ required: "A" }, [
        { kind: "ordered", position: 1, sourceParameter: "required" },
        { kind: "ordered", position: 2, sourceParameter: "optional" },
      ]),
    ).toEqual(["A"]);
  });

  it.each([
    {
      parameters: { first: "A" },
      bindings: [
        { kind: "ordered", position: 2, sourceParameter: "first" } as const,
      ],
    },
    {
      parameters: { first: "A", second: "B" },
      bindings: [
        {
          kind: "named",
          providerParameter: "value",
          sourceParameter: "first",
        } as const,
      ],
    },
    {
      parameters: { first: "A" },
      bindings: [
        {
          kind: "named",
          providerParameter: "__proto__",
          sourceParameter: "first",
        } as const,
      ],
    },
  ])("rejects invalid binding sets", ({ parameters, bindings }) => {
    expect(() => applyParameterBindings(parameters, bindings)).toThrow();
  });
});
