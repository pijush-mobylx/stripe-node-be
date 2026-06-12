# Payment Gateway Architecture — Technical Design Document
**Document Type:** Low-Level Design — Multi-Provider Payment Gateway  
**Stack:** Node.js · NestJS · TypeORM · PostgreSQL  
**Author:** Pijush Mandal  
**Reviewers:** Anurag Abhishek Joshi  
**Status:** Phase 1 Complete (Stripe) · Phase 2 Deferred (CCAvenue)  
**Last Updated:** June 2026

---

## 1. Context

Mobylx previously supported a single payment provider (Stripe) integrated directly in business logic with no abstraction layer. As Mobylx expands across multiple markets, the platform requires:

- Multiple providers selected dynamically by currency (USD → Stripe; AED → CCAvenue, deferred)
- A reliable provisioning guarantee — user is always activated even if the server crashes mid-payment
- Idempotent webhook processing — provider retries never double-provision
- A reconciliation safety net — missed webhooks are healed automatically

**Phase 1 scope:** Stripe only. Subscription payments + one-time payments. Marketplace order payments declared at the interface level, implementation deferred.

---

## 2. What Was There Before

| Problem | Description |
|---|---|
| Single provider, hard-coded | Stripe SDK calls scattered across service files. No abstraction layer. |
| No payment lifecycle tracking | No intermediate `PaymentOrders` record — no retry path for failed payments. |
| No webhook reliability | Duplicate webhooks could double-provision. No idempotency. |
| Provisioning in callback | `createSubscription` called synchronously in the webhook handler — a crash left users charged but unprovisioned with no recovery path. |
| No audit trail | No structured record of state changes. Disputes required manual table tracing. |
| No reconciliation | Missed webhooks stayed unresolved until manual ops intervention. |

---

## 3. What the New Architecture Solves

| Problem (Before) | Solution (Now) |
|---|---|
| Single provider hard-coded | `IPaymentProvider` interface + `PaymentProviderFactory` — add providers without touching business logic |
| No payment lifecycle tracking | `Payment` entity with `PaymentStatus` state machine |
| Duplicate webhooks | `WebhookEvent` idempotency key — unique index on `(providerName, providerEventId)` |
| Provisioning in callback | `ProvisioningOutbox` — written atomically with `Payment { SUCCESS }` in one Postgres transaction |
| No audit trail | `AuditLog` entity — every state change recorded with actor, action, before/after status |
| No reconciliation | `ReconciliationScheduler` — runs every 10 minutes, heals stale `INITIATED` orders |

---

## 4. High-Level Flow

```
Frontend → POST /payment/initiate  [JWT Bearer required]
  └── PaymentService.initiatePayment()
        ├── planRepo.findOne(planId)          — load amount + currency server-side (tamper-proof)
        ├── PaymentProviderFactory
        │     ├── assertActive(providerName)  — DB config check, 60s TTL cache
        │     └── resolveProvider(currency)   — USD/EUR/GBP → Stripe
        ├── StripeProvider.createCheckoutSession()
        │     └── Stripe Checkout Session → { sessionId, url }
        ├── paymentRepo.save({ status: INITIATED, providerIntentId: sessionId })
        ├── auditRepo.save({ fromStatus: null, toStatus: INITIATED })
        └── return ProviderPayload { provider, action: 'REDIRECT', url, sessionId }

Frontend redirects user to Stripe Checkout → User pays → Stripe sends webhook

POST /webhook/stripe  [PUBLIC — signature-verified]
  └── WebhookHandlerFactory.processWebhook()
        ├── StripeProvider.verifyWebhook()    — HMAC-SHA256 before JSON parse
        ├── webhookRepo.save()                — unique insert (providerName, providerEventId)
        │     └── Conflict (duplicate) → return { received: true } immediately
        └── PaymentCallbackService.process()  — 6-step pipeline (see §5.3)

ProvisioningOutboxPoller  [every 30s, pg_advisory_lock(7001001)]
  └── PENDING jobs → dispatch by provisioningType
        ├── ACTIVATE_SUBSCRIPTION → handler stub (wired to real service in Phase 2)
        ├── SEND_RECEIPT          → ReceiptEmailListener stub
        └── GRANT_ENTITLEMENT     → EntitlementHandler stub
              Success → status = DONE, processedAt = now()
              Failure → retryCount++, lastError; FAILED when retryCount >= maxRetries

ReconciliationScheduler  [every 10min, pg_advisory_lock(7001002)]
  └── Payment WHERE status = INITIATED AND createdAt < now() - 30min  (batch 100)
        └── provider.getPaymentOrderStatus(providerIntentId)
              ├── complete/paid/succeeded → SUCCESS + outbox PENDING (atomic tx)
              ├── expired/canceled        → EXPIRED
              ├── failed                  → FAILED
              └── in-flight               → skip
```

---

## 5. Component Reference

### 5.1 Provider Layer

#### `IPaymentProvider` (interface) ✅
Every provider must implement this contract. Business logic calls the interface — never an SDK directly.

```typescript
interface IPaymentProvider {
  readonly providerName: string;

  // Legacy — PaymentIntent flow (existing subscriptions)
  createSession(dto: CreateSessionDto): Promise<SessionResult>;

  // New — Checkout Session flow (unified initiation)
  createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<ProviderPayload>;

  // Subscription lifecycle
  createSubscription(dto: CreateSubscriptionDto): Promise<SubscriptionResult>;
  cancelSubscription(providerSubId: string, atPeriodEnd?: boolean): Promise<CancelResult>;
  renewSubscription(providerSubId: string, newProviderPmId?: string): Promise<RenewalResult>;

  // Reconciliation
  getPaymentOrderStatus(providerOrderId: string): Promise<PaymentStatusResult>;

  // Webhook
  verifyWebhook(dto: WebhookVerifyDto): Promise<WebhookEvent>;

  // Refund (deferred)
  refundPayment(dto: RefundDto): Promise<RefundResult>;
}
```

**Normalised initiation response** — frontend switches on `action`, never on `provider`:

```typescript
interface ProviderPayload {
  provider:  string;               // 'stripe' | 'ccavenue'
  action:    'REDIRECT' | 'FORM_POST';
  url:       string;               // Stripe: checkout URL; CCAvenue: POST endpoint
  fields?:   Record<string, string>; // CCAvenue only: { encRequest, access_code }
  sessionId: string;               // Stripe: cs_...; CCAvenue: orderId
}
```

---

#### `StripeProvider` ✅
| Method | Implementation |
|---|---|
| `createSession` | Stripe PaymentIntent — used by legacy subscription flow |
| `createCheckoutSession` | Stripe Checkout Session → `{ action: 'REDIRECT', url, sessionId }` |
| `getPaymentOrderStatus` | Routes on `cs_` prefix → Checkout Session; falls back to PaymentIntent. Maps `complete→success`, `expired→expired`, `open→initiated` |
| `verifyWebhook` | `stripe.webhooks.constructEvent()` — HMAC-SHA256 against raw bytes before JSON parse |
| `cancelSubscription`, `renewSubscription`, `refundPayment` | Implemented |

---

#### `CCavenueProvider` — Deferred (Phase 2)
See [§12 — Deferred Work](#12-deferred---phase-2).

---

#### `PaymentProviderFactory` ✅
Routes by currency or explicit provider name. Checks `isActive` from `PaymentProviderConfig` at initiation — never at callback.

```typescript
// getProvider() and getProviderByPlanConfig() are async — isActive check is awaited
const provider = await this.providerFactory.getProvider('stripe');
```

**Currency routing:**

| Currency | Provider |
|---|---|
| USD, EUR, GBP | Stripe |
| AED | CCAvenue *(deferred — Phase 2)* |
| INR | Razorpay *(deferred — future)* |

**`isActive` TTL cache:** 60-second in-process Map. Cache miss → single `findOne` on `payment_provider_configs`. No DB row = provider allowed (opt-in model). Inactive → `503 ServiceUnavailableException`.

---

### 5.2 Data Layer — Entities

#### `Payment` entity ✅
Maps to `payments` table. Serves as the canonical `PaymentOrders` record.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | Internal order ID |
| `userId` | UUID FK | Owner |
| `planId` | UUID FK (nullable) | Plan purchased |
| `subscriptionId` | UUID FK (nullable) | Linked subscription |
| `providerName` | string | `stripe` |
| `providerIntentId` | string UNIQUE | Stripe session ID (`cs_...`) or PaymentIntent ID (`pi_...`) |
| `amount` | int | Minor units (cents) |
| `status` | enum | `PaymentStatus` — see below |
| `type` | enum | `ONE_TIME` / `SUBSCRIPTION` / `MARKETPLACE_ORDER` |
| `frozen` | boolean | Set when provider marks order non-retryable |
| `createdAt` | timestamptz | Indexed alongside `status` for reconciliation queries |

**`PaymentStatus` enum:**

| Value | Meaning |
|---|---|
| `initiated` | Order created, user sent to provider |
| `success` | Provider confirmed payment |
| `failed` | Provider rejected payment |
| `needs_review` | Unrecognised provider status — flagged for ops |
| `expired` | INITIATED older than 30 min and confirmed expired by provider |
| `refunded` | Refund issued (deferred flow) |

---

#### `ProvisioningOutbox` entity ✅
Atomic crash-safety for post-payment provisioning.

| Field | Type | Notes |
|---|---|---|
| `jobId` | UUID PK | = `Payment.id` — prevents duplicate jobs at DB level |
| `provisioningType` | enum | `ACTIVATE_SUBSCRIPTION` / `SEND_RECEIPT` / `GRANT_ENTITLEMENT` |
| `status` | enum | `PENDING` → `PROCESSING` → `DONE` \| `FAILED` |
| `retryCount` | int | Incremented on each failure |
| `maxRetries` | int | Default 5 |
| `lastError` | text | Last exception message |
| `processedAt` | timestamptz | Set on `DONE` |
| `payload` | jsonb | `{ userId, planId, paymentId, providerName }` |

Index on `status` — required by poller's `WHERE status = 'PENDING'` query.

**Atomic write guarantee:**
```typescript
await dataSource.transaction(async (manager) => {
  await manager.save(payment);                     // status → SUCCESS
  await manager.save(outboxJob);                   // status = PENDING
  await manager.save(auditLog);                    // immutable record
});
// WebhookEvent marked PROCESSED after tx commits — separate write
```

---

#### `PaymentProviderConfig` entity ✅

| Field | Type | Notes |
|---|---|---|
| `providerName` | string PK | `stripe` / `ccavenue` |
| `isActive` | boolean | Toggle without deployment |
| `supportedCurrencies` | string[] (jsonb) | e.g. `["usd","eur","gbp"]` |
| `displayName` | string (nullable) | Admin UI label |
| `metadata` | jsonb | Webhook URL, mode, etc. |

Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are **never** stored here — env / Secrets Manager only.

---

#### `WebhookEvent` entity ✅

| Field | Notes |
|---|---|
| `providerEventId` | Idempotency anchor |
| `providerName` | Composite unique key with `providerEventId` |
| `type` | Provider event type string |
| `rawPayload` | Full event object (jsonb) |
| `status` | `PENDING` / `PROCESSED` / `FAILED` / `IGNORED` |
| `retryCount`, `lastError`, `processedAt` | Retry tracking |

**Crash recovery:** `PENDING` or `FAILED` status on re-delivery → re-run pipeline. `PROCESSED` → stop immediately.

---

#### `AuditLog` ✅ · `Subscription` ✅ · `Plan` ✅ · `User` ✅

---

### 5.3 Service Layer

#### `PaymentCallbackService` ✅ — 6-Step Pipeline

All Stripe webhooks run through the same pipeline:

```
Step 1 — Idempotency guard
  record.status === PROCESSED → return (already done, crash recovery safe)

Step 2 — Event type validation
  Not in { checkout.session.completed, checkout.session.expired,
           payment_intent.succeeded, payment_intent.payment_failed }
  → mark WebhookEvent IGNORED, return

Step 3 — Load payment + tamper check
  Find Payment by providerIntentId
  payload.amount_total !== payment.amount → mark FAILED, throw 422

Step 4 — Terminal status guard
  Payment already SUCCESS / FAILED / EXPIRED → mark IGNORED, return

Step 5 — Atomic Postgres transaction
  BEGIN;
    UPDATE Payment  SET status = targetStatus
    INSERT ProvisioningOutbox { status: PENDING }   ← SUCCESS path only
    INSERT AuditLog { triggeredBy: 'webhook' }
  COMMIT;

Step 6 — Mark WebhookEvent PROCESSED
  webhookRepo.update({ status: PROCESSED, processedAt: now() })

Step 7 — Emit PaymentSuccessEvent  (async, non-critical)
  eventEmitter.emit('payment.success', ...)
  → ReceiptEmailListener   (async: true — never blocks main pipeline)
  → AnalyticsListener      (async: true — writes AuditLog analytics row)
```

**Event type → target status mapping:**

| Stripe event | Target `PaymentStatus` |
|---|---|
| `checkout.session.completed` | `success` |
| `checkout.session.expired` | `expired` |
| `payment_intent.succeeded` | `success` |
| `payment_intent.payment_failed` | `failed` |

---

#### `ProvisioningOutboxPoller` ✅
- `@Cron(EVERY_30_SECONDS)` — picks up to 50 `PENDING` jobs, oldest first
- `pg_try_advisory_lock(7001001)` — only one pod runs per interval
- Per-job `try/catch` — one failure never stops the batch
- Dispatch stubs for `ACTIVATE_SUBSCRIPTION`, `SEND_RECEIPT`, `GRANT_ENTITLEMENT` — real handlers wired in Phase 2

#### `ReconciliationScheduler` ✅
- `@Cron(EVERY_10_MINUTES)` — stale threshold: 30 min
- `pg_try_advisory_lock(7001002)` — distinct key from outbox poller
- Batch of 100, oldest first; per-payment `try/catch`
- On `SUCCESS`: writes same atomic tx as webhook pipeline (checks for existing outbox job before inserting)
- Audit entry carries `triggeredBy: 'reconciliation'` for ops visibility

#### `PaymentService` ✅
- Legacy `createPayment` — PaymentIntent flow (existing code, untouched)
- New `initiatePayment(userId, dto)` — Checkout Session flow, plan-sourced amount (tamper-proof)

#### `SubscriptionService` ✅ · `WebhookHandlerFactory` ✅

---

### 5.4 Controller Layer

#### `POST /payment/initiate` ✅ [JWT Bearer]

**Request:**
```typescript
{
  planId:      string;  // UUID — amount/currency loaded server-side
  paymentType: 'ONE_TIME' | 'SUBSCRIPTION';
  successUrl:  string;
  cancelUrl:   string;
}
```

**Response:**
```typescript
{
  provider:  'stripe';
  action:    'REDIRECT';
  url:       string;    // Stripe Checkout URL
  sessionId: string;    // cs_...
}
```

JWT strategy: `Bearer` token → `JwtStrategy.validate()` → `{ userId, email }` injected via `req.user`.

#### `WebhookController` ✅
- `POST /webhook/stripe` [PUBLIC] — passes `rawBody` (Buffer) + `stripe-signature` header
- `POST /webhook/:provider` [PUBLIC] — generic fallback
- `rawBody: true` set in `main.ts` — required for HMAC-SHA256 verification before JSON parse

---

## 6. Webhook Processing — Edge Cases

| Scenario | Handling |
|---|---|
| Duplicate webhook | Unique insert conflict → check status → `PROCESSED`: stop / `PENDING`\|`FAILED`: re-run |
| Invalid Stripe signature | Rejected in `verifyWebhook` before pipeline. No state change. |
| Amount tamper | Step 3: mark `WebhookEvent FAILED`, throw 422. No `Payment` state change. |
| Unknown `providerIntentId` | Mark `WebhookEvent FAILED`. `NotFoundException` thrown. |
| Already terminal payment | Step 4 guard: mark `WebhookEvent IGNORED`. No state change. |
| Server crash between tx and PROCESSED mark | Re-delivered webhook hits Step 4 guard (Payment already SUCCESS) → IGNORED safely. |
| Provider disabled mid-session | `isActive` checked at initiation only — not at callback. Webhook processed normally. |
| Non-standard provider status | `NEEDS_REVIEW` (future: alert raised by ops monitor). |

---

## 7. Provisioning — Edge Cases

| Scenario | Handling |
|---|---|
| Provisioning fails after SUCCESS | `Payment.status` stays `SUCCESS` — never rolled back. Outbox retries up to `maxRetries`. |
| Handler throws | Caught per-job. `retryCount++`, `lastError` updated. Other jobs unaffected. |
| Duplicate outbox job | `jobId` PK — second insert rejected at DB level. |
| Server crash mid-provisioning | Job stays `PENDING`. Next poller run picks it up — at-least-once delivery guaranteed. |
| Reconciler + webhook both write outbox | Reconciler checks `outboxRepo.findOne(jobId)` before inserting — `ON CONFLICT` safe. |

---

## 8. Reconciliation — Edge Cases

| Scenario | Handling |
|---|---|
| Webhook never arrived | Reconciler finds `INITIATED` order after 30 min, heals via atomic write |
| Provider returns unknown status | Order left in current state — reconciler never overwrites with unknown |
| Multiple instances running | `pg_try_advisory_lock(7001002)` — only one instance runs per window |
| Provider API down | Per-payment `try/catch` — failed orders logged, batch continues |

---

## 9. Security

| Concern | Implementation |
|---|---|
| Stripe webhook trust | HMAC-SHA256 via `Stripe-Signature` header, raw bytes, before JSON parse |
| Provider idempotency | `Payment.id` passed as idempotency reference — network timeout + retry returns original, no duplicate charge |
| Secrets | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET` in env / Secrets Manager only — never in DB, never logged |
| Webhook endpoint public | Signature validation is the only trust boundary — no JWT on webhook routes |
| JWT on initiation | `JwtAuthGuard` (Passport `passport-jwt`) applied to `POST /payment/initiate` only |
| Amount tamper | Server-side plan lookup — client never sends `amount` or `currency` |

---

## 10. Enum Reference

| Enum | Values |
|---|---|
| `PaymentStatus` | `initiated`, `success`, `failed`, `needs_review`, `expired`, `refunded` |
| `PaymentType` | `ONE_TIME`, `SUBSCRIPTION`, `MARKETPLACE_ORDER` *(declared; impl deferred)* |
| `ProvisioningType` | `ACTIVATE_SUBSCRIPTION`, `SEND_RECEIPT`, `GRANT_ENTITLEMENT` |
| `OutboxStatus` | `PENDING`, `PROCESSING`, `DONE`, `FAILED` |
| `WebhookStatus` | `pending`, `processed`, `failed`, `ignored` |
| `SubscriptionStatus` | `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `UNPAID`, `INCOMPLETE`, `INCOMPLETE_EXPIRED`, `PAUSED` |

---

## 11. Implementation Status — Phase 1

| Component | Status | Location |
|---|---|---|
| `IPaymentProvider` interface | ✅ | `src/payment-provider/interfaces/` |
| `StripeProvider` (all methods) | ✅ | `src/payment-provider/providers/stripe.provider.ts` |
| `ProviderPayload` + `CreateCheckoutSessionDto` | ✅ | `src/payment-provider/dto/checkout-session.dto.ts` |
| `PaymentProviderFactory` (registry + currency routing + isActive cache) | ✅ | `src/payment-provider/payment-provider.factory.ts` |
| `PaymentProviderConfig` entity | ✅ | `src/payment-provider/payment-provider-config.entity.ts` |
| `Payment` entity (`PaymentStatus` aligned) | ✅ | `src/payment/payment.entity.ts` |
| `InitiatePaymentDto` | ✅ | `src/payment/dto/initiate-payment.dto.ts` |
| `POST /payment/initiate` [JWT] | ✅ | `src/payment/payment.controller.ts` |
| `PaymentService.initiatePayment()` | ✅ | `src/payment/payment.service.ts` |
| `JwtStrategy` + `JwtAuthGuard` | ✅ | `src/auth/` |
| `ProvisioningOutbox` entity | ✅ | `src/provisioning-outbox/provisioning-outbox.entity.ts` |
| `ProvisioningOutboxPoller` (30s cron + advisory lock) | ✅ | `src/provisioning-outbox/provisioning-outbox.poller.ts` |
| `PaymentCallbackService` (6-step pipeline) | ✅ | `src/payment-callback/payment-callback.service.ts` |
| `PaymentSuccessEvent` | ✅ | `src/payment-callback/payment-success.event.ts` |
| `ReceiptEmailListener` | ✅ | `src/payment-callback/receipt-email.listener.ts` |
| `AnalyticsListener` | ✅ | `src/payment-callback/analytics.listener.ts` |
| `WebhookHandlerFactory` (delegates to `PaymentCallbackService`) | ✅ | `src/webhook-event/webhook-handler.factory.ts` |
| `WebhookEvent` entity (dedup index) | ✅ | `src/webhook-event/webhook-event.entity.ts` |
| `WebhookController` | ✅ | `src/webhook-event/webhook.controller.ts` |
| `ReconciliationScheduler` (10min cron + advisory lock) | ✅ | `src/reconciliation/reconciliation.scheduler.ts` |
| `AuditLog` entity | ✅ | `src/audit-log/audit-log.entity.ts` |
| `ScheduleModule` + `EventEmitterModule` wired | ✅ | `src/app.module.ts` |
| `Subscription` entity + service + controller | ✅ | `src/subscription/` |
| `Plan` entity | ✅ | `src/plan/plan.entity.ts` |
| `User` entity | ✅ | `src/user/user.entity.ts` |

---

## 12. Deferred — Phase 2

### CCAvenue Provider

**Why deferred:** Phase 1 targets USD/EUR/GBP markets (Stripe). AED/CCAvenue integration is Phase 2.

**Initiation side:**
- Build `CCavenueProvider implements IPaymentProvider`
- Construct CCAvenue request params (merchantId, orderId, amount, currency, billing fields)
- AES-CBC encrypt request → `encRequest`
- Return `{ action: 'FORM_POST', url: CCAvenue_endpoint, fields: { encRequest, access_code } }`

**Callback side (`verifyWebhook`):**
- AES-CBC decrypt `encResp` from raw body
- Decryption failure → throw (trust boundary)
- Extract `orderId`, `status`, `amount`, `currency`
- Idempotency strategy: `SHA-256(rawBody)` fingerprint as `providerEventId` (orderId unknown before decryption); update `WebhookEvent` with real orderId post-decrypt

**Key storage:** `CCAVENUE_WORKING_KEY`, `CCAVENUE_MERCHANT_ID`, `CCAVENUE_ACCESS_CODE` in env / Secrets Manager only.

**Factory wiring:** Add `aed → ccavenue` to currency map in `PaymentProviderFactory`. Register `CCavenueProvider` in `PaymentProviderModule`.

### Other Deferred Items

| Item | Phase |
|---|---|
| `RazorpayProvider` (INR) | Future |
| Marketplace order payment implementation | Future |
| Refund flows | Future |
| `ReceiptEmailListener` — real mailer (SendGrid / SES) | Phase 2 |
| `AnalyticsListener` — external sink (Segment / Mixpanel) | Phase 2 |
| `ProvisioningOutboxPoller` — real handler implementations | Phase 2 |

---

## 13. Open Questions

1. Should `ProvisioningOutbox.maxRetries` be global config or per `provisioningType`? Currently default 5 — phase 2 decision.
2. Should `AuditLog` TTL be 365 days or longer? Some regions require payment records for 5–7 years — compliance sign-off needed.
3. `Plan.amount` stored as minor units (e.g. 19999 cents) — this rule must be enforced consistently at data entry time. No runtime conversion in the payment path.
4. Reconciliation window: currently 10-min cron with 30-min stale threshold. Review after Phase 1 observability data is available.

---

*End of Document*
