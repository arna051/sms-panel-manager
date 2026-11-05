import {
  createActionPayloadSchema,
  type InferActionPayload,
  type SmsActionMap,
} from "./actions.js";
import { normalizeIranianMobile } from "./phone.js";

export interface SmsSendOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

export interface SmsSendResult {
  readonly operationId: string;
  readonly status: "pending" | "submitted" | "delivered" | "failed" | "unknown";
  readonly providerMessageId?: string;
}

export interface SmsSendCommand {
  readonly actionKey: string;
  readonly recipient: `+98${string}`;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly options: SmsSendOptions;
}

export interface SmsSendExecutor {
  execute(command: SmsSendCommand): Promise<SmsSendResult>;
}

export interface SmsManager<TActions extends SmsActionMap> {
  send<TKey extends keyof TActions & string>(
    action: TKey,
    payload: InferActionPayload<TActions[TKey]>,
    options?: SmsSendOptions,
  ): Promise<SmsSendResult>;
}

export function createSmsManager<TActions extends SmsActionMap>(options: {
  readonly actions: TActions;
  readonly executor: SmsSendExecutor;
}): SmsManager<TActions> {
  return {
    async send(actionKey, payload, sendOptions = {}) {
      const action = options.actions[actionKey];
      if (action === undefined) {
        throw new TypeError(`Unknown SMS action "${actionKey}".`);
      }
      const validated = createActionPayloadSchema(action).parse(payload);
      const { recipient, ...parameters } = validated;

      return options.executor.execute({
        actionKey,
        recipient: normalizeIranianMobile(recipient as string),
        parameters,
        options: sendOptions,
      });
    },
  };
}
