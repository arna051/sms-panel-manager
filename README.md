# sms-panel-manager

Backend-only, strongly typed transactional SMS orchestration for Node.js 20+.

Actions live in version-controlled TypeScript, use the same definitions for runtime validation, and map semantic parameters to provider templates. The package includes secure Mongoose persistence and optional NestJS integration. It does not ship a frontend, authentication system, campaign engine, or complete OTP/session flow.

## Status

Version `0.1.0` is the initial development foundation release. Normal tests never contact an SMS provider.

| Adapter                | Binding model              | Safe credential check |
| ---------------------- | -------------------------- | --------------------- |
| Ghasedak               | Ordered `param1`–`param10` | Account information   |
| Kavenegar              | Fixed token slots          | Account information   |
| IPPanel Edge           | Named pattern parameters   | Token/profile check   |
| FarazSMS / IranPayamak | Named attributes           | Account balance       |

Delivery polling is declared as a capability but is not yet exposed as a manager operation. MeliPayamak, SMS.ir, and Asanak are deferred until their API generation or authoritative public contract is locked.

## Typed actions

```ts
import { createSmsManager, defineSmsActions, sms } from "sms-panel-manager";

const actions = defineSmsActions({
  package_posted: {
    title: "ارسال مرسوله",
    params: {
      customerName: sms.string({ title: "نام مشتری", minLength: 1 }),
      trackingCode: sms.string({ title: "کد رهگیری" }),
      note: sms.string({ title: "یادداشت" }).optional(),
    },
  },
});

const manager = createSmsManager({
  actions,
  executor: {
    async execute() {
      return { operationId: "example", status: "submitted" };
    },
  },
});

await manager.send(
  "package_posted",
  {
    recipient: "09123456789",
    customerName: "علی",
    trackingCode: "123456789",
  },
  { idempotencyKey: "shipment:123:posted:v1" },
);
```

The first argument determines the exact second-argument type. The same definition produces strict Zod validation and safe administration metadata. V1 parameters are string, number, integer, boolean, date, and enum.

## Sending behavior

`SmsOrchestrator` performs one provider attempt. It reserves the logical operation before dispatch, fingerprints the request and recipient with HMAC-SHA-256, applies named/ordered/fixed-slot bindings, and never automatically falls back. An unexpected adapter exception becomes `unknown`, because retrying an ambiguous submission could send a duplicate SMS.

Reusing an idempotency key with the same request returns its operation; using it with different data throws `idempotency_conflict`.

## Mongoose persistence

```ts
import mongoose from "mongoose";
import {
  createSmsMongooseModels,
  MongooseSendOperationStore,
} from "sms-panel-manager/mongoose";

const models = createSmsMongooseModels(mongoose.connection);
const operations = new MongooseSendOperationStore(models);
```

The caller owns the connection; no hidden global connection is opened. Models cover provider/action configuration, logical operations, and physical attempts. Unique indexes enforce action configuration and idempotency. Retention uses TTL indexes.

## Credential security

Credentials use AES-256-GCM with unique nonces and authenticated configuration, adapter, scope, revision, schema, and key IDs.

```ts
import { createEnvironmentKeyring } from "sms-panel-manager";

const keyring = createEnvironmentKeyring({
  activeKeyId: "2026-01",
  keys: { "2026-01": process.env.SMS_CONFIG_ENCRYPTION_KEY_BASE64! },
});
```

Keys must decode to 32 bytes. Retain historical key IDs while old ciphertext exists, then re-encrypt. Never store the master key in MongoDB. Credentials, message bodies, semantic values, and raw provider responses are not retained by default.

## Provider adapters

```ts
import { GhasedakAdapter } from "sms-panel-manager/providers";
```

Adapters use isolated Axios clients with HTTPS-only fixed base URLs, bounded timeouts, redirects disabled, abort signals, and Zod response parsing. Transport injection supports offline contract tests. Malformed success responses and transport exceptions become unknown outcomes rather than automatic retries.

## NestJS

```ts
import {
  createSmsManagerToken,
  SmsPanelModule,
  type InjectedSmsManager,
} from "sms-panel-manager/nestjs";

const SMS_MANAGER = createSmsManagerToken(actions);
type ApplicationSmsManager = InjectedSmsManager<typeof SMS_MANAGER>;

SmsPanelModule.forRoot({ actions, token: SMS_MANAGER, executor });
```

Administration controllers are absent by default. Enabling them without a host guard throws during registration:

```ts
SmsPanelModule.forRoot({
  actions,
  token: SMS_MANAGER,
  executor,
  admin: { enabled: true, guard: ApplicationAdminGuard },
});
```

The foundation currently exposes guarded `GET /admin/sms/actions` metadata only. The package never invents host roles.

## Development

```sh
npm install
npm run check
```

Checks include strict TypeScript, ESLint, Vitest, a real local MongoDB concurrency test, ESM/CommonJS builds, declarations, and installed-tarball consumer checks. MongoDB integration is skipped if `/bin/mongod` is unavailable.

No live SMS is sent in unit or CI tests. Live smoke tests require separate explicit authorization for provider, recipient, credentials, and cost.

## License

MIT
