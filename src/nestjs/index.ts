import {
  Controller,
  Get,
  Module,
  UseGuards,
  type CanActivate,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
  type Provider,
  type Type,
} from "@nestjs/common";

import {
  serializeSmsActions,
  type SerializableActionMetadata,
  type SmsActionMap,
} from "../core/actions.js";
import {
  createSmsManager,
  type SmsManager,
  type SmsSendExecutor,
} from "../core/manager.js";

declare const smsManagerTokenBrand: unique symbol;
export type SmsManagerToken<TActions extends SmsActionMap> = symbol & {
  readonly [smsManagerTokenBrand]: TActions;
};

export function createSmsManagerToken<TActions extends SmsActionMap>(
  actions: TActions,
): SmsManagerToken<TActions> {
  return Symbol(
    `sms-panel-manager:${Object.keys(actions).sort().join(",")}`,
  ) as SmsManagerToken<TActions>;
}

export interface SmsAdminModuleOptions {
  readonly enabled?: boolean;
  readonly guard?: Type<CanActivate>;
  readonly routePrefix?: string;
}

export interface SmsPanelModuleOptions<TActions extends SmsActionMap> {
  readonly actions: TActions;
  readonly token: SmsManagerToken<TActions>;
  readonly executor: SmsSendExecutor;
  readonly admin?: SmsAdminModuleOptions;
}

export interface SmsPanelRuntimeOptions {
  readonly executor: SmsSendExecutor;
}

export interface SmsPanelModuleAsyncOptions<
  TActions extends SmsActionMap,
  TDependencies extends unknown[] = [],
> extends Pick<ModuleMetadata, "imports"> {
  readonly actions: TActions;
  readonly token: SmsManagerToken<TActions>;
  readonly admin?: SmsAdminModuleOptions;
  readonly inject?: FactoryProvider["inject"];
  readonly useFactory: (
    ...dependencies: TDependencies
  ) => Promise<SmsPanelRuntimeOptions> | SmsPanelRuntimeOptions;
}

function adminControllers(
  actions: SmsActionMap,
  admin: SmsAdminModuleOptions | undefined,
): Type[] {
  if (admin?.enabled !== true) return [];
  if (admin.guard === undefined) {
    throw new TypeError(
      "NestJS SMS administration controllers require a host-supplied guard.",
    );
  }

  const routePrefix = admin.routePrefix ?? "admin/sms";
  const metadata = serializeSmsActions(actions);

  @Controller(routePrefix)
  @UseGuards(admin.guard)
  class SmsAdminController {
    @Get("actions")
    actions(): readonly SerializableActionMetadata[] {
      return metadata;
    }
  }

  return [SmsAdminController];
}

@Module({})
// Nest modules intentionally expose static registration methods.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class SmsPanelModule {
  static forRoot<TActions extends SmsActionMap>(
    options: SmsPanelModuleOptions<TActions>,
  ): DynamicModule {
    const provider: Provider = {
      provide: options.token,
      useValue: createSmsManager({
        actions: options.actions,
        executor: options.executor,
      }),
    };

    return {
      module: SmsPanelModule,
      providers: [provider],
      controllers: adminControllers(options.actions, options.admin),
      exports: [options.token],
    };
  }

  static forRootAsync<
    TActions extends SmsActionMap,
    TDependencies extends unknown[] = [],
  >(
    options: SmsPanelModuleAsyncOptions<TActions, TDependencies>,
  ): DynamicModule {
    const provider: Provider = {
      provide: options.token,
      inject: [...(options.inject ?? [])],
      useFactory: async (...dependencies: TDependencies) => {
        const runtime = await options.useFactory(...dependencies);
        return createSmsManager({
          actions: options.actions,
          executor: runtime.executor,
        });
      },
    };

    return {
      module: SmsPanelModule,
      ...(options.imports === undefined ? {} : { imports: options.imports }),
      providers: [provider],
      controllers: adminControllers(options.actions, options.admin),
      exports: [options.token],
    };
  }
}

export type InjectedSmsManager<TToken> =
  TToken extends SmsManagerToken<infer TActions> ? SmsManager<TActions> : never;
