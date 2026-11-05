import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createSmsManager,
  defineSmsActions,
  serializeSmsActions,
  sms,
  type InferActionPayload,
  type SmsSendExecutor,
} from "../src/index.js";

const actions = defineSmsActions({
  package_posted: {
    title: "ارسال مرسوله",
    params: {
      customerName: sms.string({ title: "نام مشتری", minLength: 1 }),
      trackingCode: sms.string({ title: "کد رهگیری" }),
      note: sms.string({ title: "یادداشت" }).optional(),
    },
  },
  payment_received: {
    title: "دریافت پرداخت",
    params: {
      amount: sms.number({ title: "مبلغ", min: 0 }),
    },
  },
});

describe("SMS actions", () => {
  it("preserves exact inferred payloads", () => {
    type Payload = InferActionPayload<(typeof actions)["package_posted"]>;

    const payload = {} as Payload;
    expectTypeOf(payload.recipient).toEqualTypeOf<string>();
    expectTypeOf(payload.customerName).toEqualTypeOf<string>();
    expectTypeOf(payload.trackingCode).toEqualTypeOf<string>();
    expectTypeOf(payload.note).toEqualTypeOf<string | undefined>();
  });

  it("validates and normalizes before executing", async () => {
    const execute = vi.fn<SmsSendExecutor["execute"]>().mockResolvedValue({
      operationId: "operation-1",
      status: "submitted",
    });
    const manager = createSmsManager({ actions, executor: { execute } });

    await manager.send("package_posted", {
      recipient: "09123456789",
      customerName: "علی",
      trackingCode: "TRACK-1",
    });

    expect(execute).toHaveBeenCalledWith({
      actionKey: "package_posted",
      recipient: "+989123456789",
      parameters: {
        customerName: "علی",
        trackingCode: "TRACK-1",
      },
      options: {},
    });
  });

  it("rejects missing and unknown runtime values", async () => {
    const manager = createSmsManager({
      actions,
      executor: { execute: vi.fn() },
    });

    await expect(
      manager.send("package_posted", {
        recipient: "09123456789",
        customerName: "",
        trackingCode: "TRACK-1",
      }),
    ).rejects.toThrow();

    await expect(
      manager.send("package_posted", {
        recipient: "09123456789",
        customerName: "Ali",
        trackingCode: "TRACK-1",
        // @ts-expect-error unknown runtime input is also rejected by TypeScript
        amount: 5,
      }),
    ).rejects.toThrow();
  });

  it("serializes safe administration metadata", () => {
    expect(serializeSmsActions(actions)).toEqual([
      {
        key: "package_posted",
        title: "ارسال مرسوله",
        parameters: [
          {
            key: "customerName",
            title: "نام مشتری",
            type: "string",
            required: true,
          },
          {
            key: "trackingCode",
            title: "کد رهگیری",
            type: "string",
            required: true,
          },
          {
            key: "note",
            title: "یادداشت",
            type: "string",
            required: false,
          },
        ],
      },
      {
        key: "payment_received",
        title: "دریافت پرداخت",
        parameters: [
          {
            key: "amount",
            title: "مبلغ",
            type: "number",
            required: true,
          },
        ],
      },
    ]);
  });

  it("rejects reserved parameter names", () => {
    expect(() =>
      defineSmsActions({
        invalid: {
          title: "Invalid",
          params: { recipient: sms.string({ title: "Recipient" }) },
        },
      }),
    ).toThrow(/reserved parameter/);
  });
});
