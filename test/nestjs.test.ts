import "reflect-metadata";

import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { defineSmsActions, sms } from "../src/index.js";
import {
  createSmsManagerToken,
  SmsPanelModule,
  type InjectedSmsManager,
} from "../src/nestjs/index.js";

const actions = defineSmsActions({
  auth: {
    title: "ورود",
    params: { code: sms.string({ title: "کد" }) },
  },
});
const token = createSmsManagerToken(actions);

@Injectable()
class TestAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    expect(context).toBeDefined();
    return true;
  }
}

describe("NestJS integration", () => {
  it("preserves the application-specific manager type", () => {
    type Manager = InjectedSmsManager<typeof token>;
    expectTypeOf<Parameters<Manager["send"]>[0]>().toEqualTypeOf<"auth">();
  });

  it("registers a typed manager and no controllers by default", async () => {
    const execute = vi.fn().mockResolvedValue({
      operationId: "operation-1",
      status: "submitted",
    });
    const dynamicModule = SmsPanelModule.forRoot({
      actions,
      token,
      executor: { execute },
    });
    expect(dynamicModule.controllers).toEqual([]);

    const testingModule = await Test.createTestingModule({
      imports: [dynamicModule],
    }).compile();
    const manager = testingModule.get<InjectedSmsManager<typeof token>>(token);
    await manager.send("auth", { recipient: "09123456789", code: "1234" });
    expect(execute).toHaveBeenCalledOnce();
    await testingModule.close();
  });

  it("refuses to expose administration routes without a guard", () => {
    expect(() =>
      SmsPanelModule.forRoot({
        actions,
        token,
        executor: { execute: vi.fn() },
        admin: { enabled: true },
      }),
    ).toThrow(/host-supplied guard/);
  });

  it("applies the host guard to explicitly enabled controllers", () => {
    const dynamicModule = SmsPanelModule.forRoot({
      actions,
      token,
      executor: { execute: vi.fn() },
      admin: { enabled: true, guard: TestAdminGuard },
    });
    const controller = dynamicModule.controllers?.[0];
    expect(controller).toBeDefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, controller as object)).toEqual([
      TestAdminGuard,
    ]);
  });
});
