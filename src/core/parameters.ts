import { z } from "zod";

export type SmsParameterType =
  "string" | "number" | "integer" | "boolean" | "date" | "enum";

export interface ParameterMetadata {
  readonly title: string;
  readonly description?: string;
}

export interface ParameterDescriptor<
  TSchema extends z.ZodType = z.ZodType,
  TOptional extends boolean = boolean,
> {
  readonly type: SmsParameterType;
  readonly schema: TSchema;
  readonly metadata: ParameterMetadata;
  readonly isOptional: TOptional;
  optional(): ParameterDescriptor<z.ZodOptional<TSchema>, true>;
}

function descriptor<TSchema extends z.ZodType>(
  type: SmsParameterType,
  schema: TSchema,
  metadata: ParameterMetadata,
): ParameterDescriptor<TSchema, false> {
  return {
    type,
    schema,
    metadata,
    isOptional: false,
    optional() {
      return optionalDescriptor(type, schema.optional(), metadata);
    },
  };
}

function optionalDescriptor<TSchema extends z.ZodType>(
  type: SmsParameterType,
  schema: TSchema,
  metadata: ParameterMetadata,
): ParameterDescriptor<TSchema, true> {
  return {
    type,
    schema,
    metadata,
    isOptional: true,
    optional() {
      return optionalDescriptor(type, schema.optional(), metadata);
    },
  };
}

export interface StringParameterOptions extends ParameterMetadata {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

export interface NumberParameterOptions extends ParameterMetadata {
  readonly min?: number;
  readonly max?: number;
}

export interface DateParameterOptions extends ParameterMetadata {
  readonly min?: Date;
  readonly max?: Date;
}

function stringParameter(options: StringParameterOptions) {
  let schema = z.string();
  if (options.minLength !== undefined) schema = schema.min(options.minLength);
  if (options.maxLength !== undefined) schema = schema.max(options.maxLength);
  if (options.pattern !== undefined) schema = schema.regex(options.pattern);
  return descriptor("string", schema, options);
}

function numberParameter(options: NumberParameterOptions) {
  let schema = z.number();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);
  return descriptor("number", schema, options);
}

function integerParameter(options: NumberParameterOptions) {
  let schema = z.number().int();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);
  return descriptor("integer", schema, options);
}

function booleanParameter(options: ParameterMetadata) {
  return descriptor("boolean", z.boolean(), options);
}

function dateParameter(options: DateParameterOptions) {
  let schema = z.date();
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);
  return descriptor("date", schema, options);
}

function enumParameter<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
  options: ParameterMetadata,
) {
  return descriptor("enum", z.enum(values), options);
}

export const sms = {
  string: stringParameter,
  number: numberParameter,
  integer: integerParameter,
  boolean: booleanParameter,
  date: dateParameter,
  enum: enumParameter,
} as const;
