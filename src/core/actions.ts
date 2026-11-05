import { z } from "zod";

import type { ParameterDescriptor } from "./parameters.js";

export type SmsParameterMap = Readonly<Record<string, ParameterDescriptor>>;

export interface SmsActionDefinition<
  TParams extends SmsParameterMap = SmsParameterMap,
> {
  readonly title: string;
  readonly description?: string;
  readonly params: TParams;
}

export type SmsActionMap = Readonly<Record<string, SmsActionDefinition>>;

const RESERVED_PARAMETER_KEYS = new Set([
  "recipient",
  "idempotencyKey",
  "signal",
  "correlationId",
  "metadata",
]);

export function defineSmsActions<const TActions extends SmsActionMap>(
  actions: TActions,
): TActions {
  for (const [actionKey, action] of Object.entries(actions)) {
    if (!/^[a-z][a-z0-9_]*$/.test(actionKey)) {
      throw new TypeError(
        `Invalid SMS action key "${actionKey}". Use lower snake_case.`,
      );
    }

    for (const parameterKey of Object.keys(action.params)) {
      if (RESERVED_PARAMETER_KEYS.has(parameterKey)) {
        throw new TypeError(
          `SMS action "${actionKey}" uses reserved parameter "${parameterKey}".`,
        );
      }
    }
  }

  return actions;
}

type RequiredParameterKeys<TParams extends SmsParameterMap> = {
  [K in keyof TParams]-?: TParams[K]["isOptional"] extends true ? never : K;
}[keyof TParams];

type OptionalParameterKeys<TParams extends SmsParameterMap> = {
  [K in keyof TParams]-?: TParams[K]["isOptional"] extends true ? K : never;
}[keyof TParams];

type InferDescriptor<TDescriptor extends ParameterDescriptor> = z.output<
  TDescriptor["schema"]
>;

export type InferActionPayload<TAction extends SmsActionDefinition> = {
  recipient: string;
} & {
  [K in RequiredParameterKeys<TAction["params"]>]: InferDescriptor<
    TAction["params"][K]
  >;
} & {
  [K in OptionalParameterKeys<TAction["params"]>]?: InferDescriptor<
    TAction["params"][K]
  > extends infer TValue
    ? Exclude<TValue, undefined>
    : never;
};

export function createActionPayloadSchema(
  action: SmsActionDefinition,
): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodType> = {
    recipient: z.string().min(1),
  };

  for (const [key, parameter] of Object.entries(action.params)) {
    shape[key] = parameter.schema;
  }

  return z.object(shape).strict();
}

export interface SerializableActionMetadata {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly parameters: readonly {
    readonly key: string;
    readonly title: string;
    readonly description?: string;
    readonly type: ParameterDescriptor["type"];
    readonly required: boolean;
  }[];
}

export function serializeSmsActions(
  actions: SmsActionMap,
): readonly SerializableActionMetadata[] {
  return Object.entries(actions).map(([key, action]) => ({
    key,
    title: action.title,
    ...(action.description === undefined
      ? {}
      : { description: action.description }),
    parameters: Object.entries(action.params).map(
      ([parameterKey, parameter]) => ({
        key: parameterKey,
        title: parameter.metadata.title,
        ...(parameter.metadata.description === undefined
          ? {}
          : { description: parameter.metadata.description }),
        type: parameter.type,
        required: !parameter.isOptional,
      }),
    ),
  }));
}
