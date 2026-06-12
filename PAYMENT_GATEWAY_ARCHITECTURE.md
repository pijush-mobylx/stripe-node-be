# Payment Gateway Architecture — Technical Design Document
**Document Type:** Low-Level Design — Multi-Provider Payment Gateway  
**Stack:** Node.js · NestJS · TypeORM · PostgreSQL  
**Author:** Pijush Mandal  
**Reviewers:** Anurag Abhishek Joshi  
**Status:** In Progress — Phase 1 (Stripe + CCAvenue)  
**Last Updated:** June 2026

---

## 1. Context

Mobylx previously supported a single payment provider (Stripe) integrated directly in business logic with no abstraction layer. As Mobylx expands across multiple markets, the platform requires:

- Multiple providers selected dynamically by currency (AED → CCAvenue, USD → Stripe)
- A reliable provisioning guarantee — user is always activated even if the server crashes mid-payment
- Idempotent webhook processing — provider retries never double-provision
- A reconciliation safety net — missed webhooks are healed automatically

**Scope:** Subscription payments in Phase 1. Marketplace order payments are declared at the interface level but implemented in a subsequent release.

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
| No payment lifecycle tracking | `PaymentOrders` table with `PaymentOrderStatusEnum` state machine |
| Duplicate webhooks | `WebhookEvent` idempotency key (unique index on `providerName + providerEventId`) |
| Provisioning in callback | `ProvisioningOutbox` — written atomically with `PaymentOrders SUCCESS` in one Postgres transaction |
| No audit trail | `AuditLog` entity — every state change recorded with actor, action, before/after status |
| No reconciliation | `ReconciliationScheduler` — runs every 15 minutes, heals stale `INITIATED` orders |

---

## 4. High-Level Flow

```
Frontend → POST /payment/initiate  (JWT-authenticated)
  └── PaymentService
        ├── SubscriptionService.createPaymentOrder()   — create PaymentOrders record (INITIATED)
        ├── PaymentProviderFactory.getProviderForCurrency()
        └── provider.createSession() / createCheckoutSession()
              └── Return normalised envelope to frontend
                    { provider, action: FORM_POST|REDIRECT, url, fields, sessionId }

User completes payment → Provider sends webhook
  └── WebhookController  POST /webhook/stripe  |  POST /webhook/ccavenue
        └── PaymentCallbackService (6-step pipeline)
              1. Idempotency check  (WebhookEvent unique insert)
              2. Provider validation (verifyWebhook — HMAC-SHA256 or AES-CBC)
              3. Amount tamper check (webhook amount vs PaymentOrders.amount exact integer)
              4. Atomic Postgres transaction
                   WRITE PaymentOrders { status: SUCCESS }
                   WRITE ProvisioningOutbox { status: PENDING }
              5. Mark WebhookEvent { status: PROCESSED }
              6. Publish PaymentSuccessEvent (non-critical: email, analytics)

ProvisioningOutbox poller (every 30s)
  └── PENDING jobs → SubscriptionService.createSubscription() / addSeats() / extendEndDate()
        ├── Success → DONE + AuditLog
        └── Failure → retryCount++, lastError, alert at maxRetries

ReconciliationScheduler (every 15 min)
  └── INITIATED orders older than 15 min, younger than 48 hr
        └── provider.getPaymentOrderStatus()
              └── On SUCCESS → same atomic write as webhook path
```

---

## 5. Component Reference

### 5.1 Provider Layer

#### `IPaymentProvider` (interface)
Every provider must implement this contract. Business logic calls the interface — never an SDK directly.

```typescript
interface IPaymentProvider {
  readonly providerName: string;

  // Initiation
  createSession(dto: CreateSessionDto): Promise<SessionResult>;
  createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult>;

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

**Normalised initiation response** — the frontend switches on `action`, never on `provider`:

```typescript
interface ProviderPayload {
  provider:   'STRIPE' | 'CCAVENUE';
  action:     'FORM_POST' | 'REDIRECT';
  url:        string | null;
  fields:     Record<string, string> | null;  // CCAvenue hidden-form fields
  sessionId:  string | null;                  // Stripe checkout session ID
}
```

---

#### `StripeProvider` ✅ Implemented
- `createSession` → Stripe PaymentIntent
- `createCheckoutSession` → Stripe Checkout Session (returns `sessionId` + `paymentUrl`, action: `REDIRECT`)
- `verifyWebhook` → reads `Stripe-Signature` header, HMAC-SHA256 verified **before** any JSON parsing
- All other `IPaymentProvider` methods implemented

---

#### `CCavenueProvider` 🔲 To Build
**Initiation side:**
- Builds CCAvenue request params (merchantId, orderId, amount, currency, billing fields)
- AES-CBC encryption of request → produces `encRequest`
- Returns `{ action: 'FORM_POST', url: CCAvenue_endpoint, fields: { encRequest, access_code } }`

**Callback side (inside `verifyWebhook`):**
- AES-CBC decryption of `encResp` from raw body
- If decryption fails → throw (trust boundary)
- Extract `orderId`, `status`, `amount`, `currency` from decrypted payload
- Amount handled as minor units (Long)
- Return `PaymentWebhookResult`

**Idempotency note:** CCAvenue has no eventId visible before decryption.  
Strategy: `eventId = SHA-256(rawBody)` — deterministic fingerprint written to `WebhookEvent` before decryption. After decryption, `WebhookEvent.orderId` is updated with the real orderId.

**Key storage:** Working key in env/Secrets Manager as `CCAVENUE_WORKING_KEY`. Never logged.

---

#### `PaymentProviderFactory` ✅ Implemented (partial)
Routes by currency or explicit provider name. `isActive` check (from `PaymentProviderConfig`) runs at initiation — never at callback.

Current currency map (extend when new providers are added):

| Currency | Provider |
|---|---|
| USD, EUR, GBP | Stripe |
| AED | CCAvenue |
| INR | Razorpay *(placeholder — not yet registered)* |

---

### 5.2 Data Layer — Entities

#### `PaymentOrders` (maps to current `Payment` entity — needs status enum alignment)

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID PK | Internal order ID — passed as idempotency key to provider |
| `userId` | UUID FK | Owner |
| `planId` | UUID FK | Plan purchased |
| `subscriptionId` | UUID FK | Linked subscription (nullable until provisioned) |
| `providerName` | string | `STRIPE` / `CCAVENUE` |
| `providerOrderId` | string | Provider's own reference — used for reconciliation and refunds |
| `amount` | bigint | Minor units (e.g. 19999 for 199.99 AED). Currency-aware: `Currency.getDefaultFractionDigits()` |
| `currency` | char(3) | ISO-4217 |
| `status` | enum | `PaymentOrderStatusEnum` — see below |
| `orderContext` | enum | `SUBSCRIPTION` / `MARKETPLACE_ORDER` |
| `paymentType` | enum | `ONE_TIME` / `SUBSCRIPTION` |
| `couponCode` | string | Optional applied coupon |
| `failureMessage` | string | Last failure reason |
| `webhookEventId` | UUID FK | Linked `WebhookEvent` after processing |
| `createdAt` | timestamptz | — |
| `updatedAt` | timestamptz | — |

**`PaymentOrderStatusEnum`:**

```
INITIATED     — order created, user sent to provider
SUCCESS       — provider confirmed payment
FAILED        — provider rejected payment
NEEDS_REVIEW  — unrecognised provider status — flagged for manual investigation
EXPIRED       — INITIATED record older than 30 min, eligible for fresh initiation
```

**Amount rule:** All amounts stored as `bigint` minor units. Conversion is currency-aware — `fractionDigits = Currency.getDefaultFractionDigits(currencyCode)`. Example: 199.99 AED → 19999 (×100), JPY 500 → 500 (×1).

**Index:** Composite index on `(status, createdAt)` — required by `ReconciliationScheduler` to query stale `INITIATED` orders by age without full-table scan.

---

#### `ProvisioningOutbox` 🔲 To Build

| Field | Type | Purpose |
|---|---|---|
| `jobId` | UUID PK | = `PaymentOrders.id` — prevents duplicate jobs at DB level |
| `paymentOrderId` | UUID FK | → `PaymentOrders` |
| `userId` | UUID | Owner |
| `provisioningType` | enum | `SUBSCRIPTION_NEW` / `SUBSCRIPTION_ADDON` / `SUBSCRIPTION_RENEW` / `MARKETPLACE` |
| `status` | enum | `PENDING` / `IN_PROGRESS` / `DONE` / `FAILED` |
| `retryCount` | int | Auto-incremented on each failed attempt |
| `maxRetries` | int | Configurable — default 3 |
| `lastError` | text | Exception message from last failed attempt |
| `processedAt` | timestamptz | When provisioning completed successfully |
| `createdAt` | timestamptz | — |

**Atomic write guarantee:** `PaymentOrders { SUCCESS }` and `ProvisioningOutbox { PENDING }` are written inside a single Postgres transaction. Both succeed or both fail — no partial state possible.

```typescript
// Inside PaymentCallbackService step 4:
await this.dataSource.transaction(async (manager) => {
  await manager.update(PaymentOrders, { id: orderId }, { status: 'SUCCESS' });
  await manager.insert(ProvisioningOutbox, { jobId: orderId, status: 'PENDING', ... });
});
```

---

#### `PaymentProviderConfig` 🔲 To Build

| Field | Type | Purpose |
|---|---|---|
| `provider` | enum PK | `STRIPE` / `CCAVENUE` |
| `displayName` | string | UI label |
| `isActive` | boolean | Toggle without deployment — checked at initiation |
| `supportedCurrencies` | string[] | e.g. `['AED']` — used by factory for routing |
| `supportedCountries` | string[] | Optional — country-level routing |
| `updatedAt` | timestamptz | — |

**Caching:** Non-secret fields (`isActive`, `supportedCurrencies`, `displayName`) cached in-process using a simple TTL map (or `node-cache`). Consistent with the existing coupon-config pattern. Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CCAVENUE_WORKING_KEY`) stay in env / Secrets Manager — never in this table.

---

#### `WebhookEvent` ✅ Implemented

| Field | Purpose |
|---|---|
| `id` | UUID PK |
| `providerEventId` | Idempotency anchor — unique per `(providerName, providerEventId)` |
| `providerName` | `stripe` / `ccavenue` |
| `type` | Provider event type string |
| `rawPayload` | Full encrypted-at-rest payload (for replay/debugging) |
| `status` | `PENDING` / `PROCESSED` / `FAILED` / `IGNORED` |
| `retryCount` | — |
| `lastError` | — |
| `processedAt` | — |

**Crash recovery:** If status is `PENDING` or `FAILED` on a re-delivered event, re-run processing. If `PROCESSED`, stop — already done.

---

#### `AuditLog` ✅ Implemented
Append-only — every state change writes a record. Actions: `PAYMENT_INITIATED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `TAMPER_DETECTED`, `PROVISIONING_COMPLETE`, `RECONCILIATION_RESOLVED`, `WEBHOOK_DUPLICATE`, `PROVIDER_DISABLED`.

**PII policy:** Only non-PII identifiers stored — `orderId`, `userId`, `status`, `action`. No email, phone, billing address, card metadata.

---

#### `Subscription` ✅ Implemented
#### `Plan` ✅ Implemented
#### `User` ✅ Implemented

---

### 5.3 Service Layer

#### `PaymentService` ✅ Implemented (needs `/payment/initiate` alignment)
Coordinates initiation: validates request → delegates `PaymentOrders` creation to `SubscriptionService` → calls factory → returns `ProviderPayload` envelope.

#### `PaymentCallbackService` 🔲 To Build — 6-Step Pipeline

All provider webhooks run through the same 6 steps:

```
Step 1 — Idempotency check
  Stripe:    eventId = event.id (evt_...)
             INSERT WebhookEvent { eventId }
             ON CONFLICT → check status → PROCESSED? stop. PENDING/FAILED? re-run.
  CCAvenue:  eventId = SHA-256(rawBody)   ← fingerprint (orderId unknown before decryption)
             INSERT WebhookEvent { eventId }
             After decryption → UPDATE WebhookEvent { orderId }

Step 2 — Provider validation (inside provider.verifyWebhook)
  Stripe:    Read Stripe-Signature header
             HMAC-SHA256 verify against raw bytes BEFORE JSON parse
             Reject if invalid
  CCAvenue:  AES-CBC decrypt encResp using Working Key
             Reject if decryption fails
             Extract orderId, status, amount, currency

Step 3 — Amount tamper check
  webhookAmount (minor units) === PaymentOrders.amount (exact integer)
  Mismatch → AuditLog { TAMPER_DETECTED } → reject

Step 4 — Atomic Postgres transaction (SUCCESS path)
  BEGIN;
    UPDATE PaymentOrders SET status = 'SUCCESS' WHERE id = orderId AND status = 'INITIATED';
    INSERT INTO ProvisioningOutbox (jobId, ...) VALUES (orderId, 'PENDING', ...)
      ON CONFLICT (jobId) DO NOTHING;
  COMMIT;
  On FAILED path: UPDATE PaymentOrders { FAILED } + AuditLog only

Step 5 — Mark webhook processed
  UPDATE WebhookEvent SET status = 'PROCESSED'

Step 6 — Publish PaymentSuccessEvent (async, non-critical)
  → ReceiptEmailListener  (send receipt email)
  → AnalyticsListener     (push event to analytics)
  Provisioning is NOT triggered here — guaranteed by outbox row in Step 4
```

#### `SubscriptionService` ✅ Implemented (needs `createPaymentOrder` method)

#### `ProvisioningOutboxPoller` 🔲 To Build
- Runs every 30 seconds (`@Cron`)
- Advisory lock (`SELECT pg_try_advisory_lock(key)`) — only one instance in multi-node deployment
- Per-job `try/catch` — one job failure does not abort the batch

```
For each PENDING job:
  SUBSCRIPTION_NEW   → SubscriptionService.createSubscription()
  SUBSCRIPTION_ADDON → SubscriptionService.addSeats()
  SUBSCRIPTION_RENEW → SubscriptionService.extendEndDate()
  MARKETPLACE        → declared, implementation deferred

  Success → status = DONE, AuditLog { PROVISIONING_COMPLETE }
  Failure → retryCount++, lastError = exception.message
             if retryCount >= maxRetries → status = FAILED, alert raised
```

#### `ReconciliationScheduler` 🔲 To Build
- Runs every 15 minutes (`@Cron`)
- Advisory lock — only one instance at a time
- Queries `PaymentOrders` where `status = INITIATED AND createdAt < NOW() - 15min AND createdAt > NOW() - 48hr`
- For each: calls `provider.getPaymentOrderStatus(providerOrderId)`
- On `SUCCESS` → same atomic Postgres transaction as webhook Step 4
- On null/unknown → skip, leave as-is
- Each order wrapped in `try/catch` — provider outage does not abort batch

---

### 5.4 Controller Layer

#### `PaymentController` — `POST /payment/initiate` [JWT] 🔲 Needs alignment
Current `POST /payments` exists but needs to match the TDD's unified initiation endpoint with normalised `ProviderPayload` response.

**Request:**
```typescript
{
  planId:          string;   // required
  currency:        string;   // required — AED | USD
  paymentType:     string;   // ONE_TIME | SUBSCRIPTION
  couponCode?:     string;
  // Billing fields — required for CCAvenue, optional for Stripe
  billingName?:    string;
  billingAddress?: string;
  billingCity?:    string;
  billingState?:   string;
  billingZip?:     string;
  billingCountry?: string;
  billingTel?:     string;
  billingEmail?:   string;
}
```

**Response:**
```typescript
{
  provider:   'STRIPE' | 'CCAVENUE';
  action:     'FORM_POST' | 'REDIRECT';
  url:        string | null;
  fields:     Record<string, string> | null;
  sessionId:  string | null;
}
```

#### `WebhookController` ✅ Implemented
- `POST /webhook/stripe` [PUBLIC] — passes `rawBody` + `stripe-signature` header
- `POST /webhook/ccavenue` [PUBLIC] — passes `rawBody` (encrypted `encResp`)
- `POST /webhook/:provider` [PUBLIC] — generic fallback

**Raw body capture:** `rawBody` must be captured as `Buffer` before any JSON parsing. Requires `express.raw()` middleware on webhook routes, not `express.json()`.

#### `SubscriptionController` ✅ Implemented

---

## 6. Webhook Processing — Edge Cases

| Scenario | Handling |
|---|---|
| Duplicate webhook | `WebhookEvent` unique insert fails → check status → PROCESSED: stop / PENDING or FAILED: re-run |
| CCAvenue no eventId before decryption | `SHA-256(rawBody)` fingerprint as idempotency anchor, updated with orderId post-decryption |
| Invalid signature | Rejected in Step 2 before touching `PaymentOrders`. No `AuditLog`. |
| Amount tamper | Rejected in Step 3. `AuditLog { TAMPER_DETECTED }`. No state change. |
| Unknown `orderId` | Rejected. `AuditLog` row written. No state change. |
| Already SUCCESS/FAILED order | `WebhookEvent` stored but no state change — idempotent by design. |
| Server restart between SUCCESS write and outbox write | Postgres transaction ensures both are written atomically. Webhook redelivery re-runs safely. |
| Provider disabled mid-session | `isActive` check applies at initiation only — not at callback. Webhook processed normally. |
| Non-standard status from provider | Normalised to `NEEDS_REVIEW`. Raw value logged in `AuditLog.metadata`. |

---

## 7. Provisioning — Edge Cases

| Scenario | Handling |
|---|---|
| Provisioning fails after SUCCESS | `PaymentOrders.status` stays `SUCCESS` — never rolled back. Outbox retries up to `maxRetries`. |
| `createSubscription` throws | Caught per-job. `retryCount++`, `lastError` updated. Other jobs unaffected. |
| Duplicate provisioning job | `jobId = PaymentOrders.id` PK — second insert fails at DB level. |
| Server crash mid-provisioning | Job stays `PENDING`. Next poller run picks it up — at-least-once delivery guaranteed. |
| `createSubscription` runs twice (at-least-once retry) | `subscriptionId` FK check prevents duplicate subscription creation. |

---

## 8. Reconciliation — Edge Cases

| Scenario | Handling |
|---|---|
| Webhook never arrived | Reconciler finds `INITIATED` order after 15 min, calls `getPaymentOrderStatus()`, heals via atomic write |
| Order too old (>48 hr) | Skipped — providers typically expire orders by then; manual review |
| Provider returns null status | Order left in current state — reconciler never overwrites with unknown |
| Multiple instances running | Postgres advisory lock (`pg_try_advisory_lock`) — only one instance runs per 15-min window |
| Provider API down | Per-order `try/catch` — failed orders logged, batch continues |

---

## 9. Security

| Concern | Implementation |
|---|---|
| Stripe webhook trust | HMAC-SHA256 via `Stripe-Signature` header, raw bytes, before JSON parse |
| CCAvenue webhook trust | AES-CBC decryption success = trust boundary |
| Provider idempotency | `PaymentOrders.id` passed as idempotency key to provider — network timeout + retry returns original, no duplicate charge |
| Secrets | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CCAVENUE_WORKING_KEY`, `CCAVENUE_MERCHANT_ID`, `CCAVENUE_ACCESS_CODE` in env / Secrets Manager only — never in DB, never logged |
| PII in webhook payload | `WebhookEvent.rawPayload` encrypted at rest (AES) before DynamoDB/PG storage |
| PII in logs | `LogSanitizerUtil` — email, phone, billing address, card metadata excluded from all logs |
| Webhook endpoint public | Signature validation is the only trust boundary — no JWT on webhook routes |

---

## 10. Enum Reference

| Enum | Values |
|---|---|
| `PaymentOrderStatusEnum` | `INITIATED`, `SUCCESS`, `FAILED`, `NEEDS_REVIEW`, `EXPIRED` |
| `PaymentOrderContextEnum` | `SUBSCRIPTION`, `MARKETPLACE_ORDER` |
| `PaymentTypeEnum` | `ONE_TIME`, `SUBSCRIPTION` |
| `ProvisioningTypeEnum` | `SUBSCRIPTION_NEW`, `SUBSCRIPTION_ADDON`, `SUBSCRIPTION_RENEW`, `MARKETPLACE` |
| `ProvisioningStatusEnum` | `PENDING`, `IN_PROGRESS`, `DONE`, `FAILED` |
| `WebhookStatusEnum` | `PENDING`, `PROCESSED`, `FAILED`, `IGNORED` |
| `PaymentProviderEnum` | `STRIPE`, `CCAVENUE` *(RAZORPAY placeholder for future)* |
| `AuditActionEnum` | `PAYMENT_INITIATED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `TAMPER_DETECTED`, `PROVISIONING_COMPLETE`, `RECONCILIATION_RESOLVED`, `WEBHOOK_DUPLICATE`, `PROVIDER_DISABLED` |
| `SubscriptionStatusEnum` | `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `UNPAID`, `INCOMPLETE`, `INCOMPLETE_EXPIRED`, `PAUSED` |

---

## 11. Implementation Status

| Component | Status | Location |
|---|---|---|
| `IPaymentProvider` interface | ✅ Done | `src/payment-provider/interfaces/` |
| `StripeProvider` | ✅ Done | `src/payment-provider/providers/stripe.provider.ts` |
| `PaymentProviderFactory` (registry + currency routing) | ✅ Done | `src/payment-provider/payment-provider.factory.ts` |
| `Payment` entity (→ `PaymentOrders`) | ✅ Done (needs status enum alignment) | `src/payment/payment.entity.ts` |
| `Subscription` entity + service + controller | ✅ Done | `src/subscription/` |
| `Plan` entity | ✅ Done | `src/plan/plan.entity.ts` |
| `WebhookEvent` entity (dedup index) | ✅ Done | `src/webhook-event/webhook-event.entity.ts` |
| `WebhookController` (`/webhook/stripe`, `/:provider`) | ✅ Done | `src/webhook-event/webhook.controller.ts` |
| `WebhookHandlerFactory` | ✅ Done | `src/webhook-event/webhook-handler.factory.ts` |
| `StripeEventHandler` | ✅ Done | `src/webhook-event/handlers/stripe-event.handler.ts` |
| `AuditLog` entity | ✅ Done | `src/audit-log/audit-log.entity.ts` |
| `CCavenueProvider` | 🔲 To Build | `src/payment-provider/providers/ccavenue.provider.ts` |
| `ProvisioningOutbox` entity + poller | 🔲 To Build | `src/provisioning-outbox/` |
| `PaymentCallbackService` (6-step pipeline) | 🔲 To Build | `src/webhook-event/payment-callback.service.ts` |
| `ReconciliationScheduler` | 🔲 To Build | `src/reconciliation/` |
| `PaymentProviderConfig` entity (cached) | 🔲 To Build | `src/payment-provider/payment-provider-config.entity.ts` |
| `POST /payment/initiate` unified endpoint | 🔲 To Build | `src/payment/payment.controller.ts` |
| Normalised `ProviderPayload` response envelope | 🔲 To Build | `src/payment-provider/dto/` |
| `ReceiptEmailListener` | 🔲 To Build | `src/events/` |
| `AnalyticsListener` | 🔲 To Build | `src/events/` |
| `RazorpayProvider` | 🔲 Deferred (future release) | — |
| Marketplace order payment implementation | 🔲 Deferred (future release) | — |
| Refund flows | 🔲 Deferred | — |

---

## 12. Build Priority Order

1. **`PaymentOrderStatusEnum` alignment** — align existing `Payment` entity status enum to `INITIATED / SUCCESS / FAILED / NEEDS_REVIEW / EXPIRED`
2. **`ProvisioningOutbox` entity + poller** — highest reliability risk eliminated here
3. **`CCavenueProvider`** — AES-CBC + SHA-256 fingerprint idempotency
4. **`PaymentCallbackService` (6-step pipeline)** — replaces inline webhook handling
5. **`POST /payment/initiate` + `ProviderPayload` envelope** — unified initiation for both providers
6. **`ReconciliationScheduler`** — heals missed webhooks
7. **`PaymentProviderConfig` entity + cache** — runtime provider toggle without deployment
8. **`ReceiptEmailListener` + `AnalyticsListener`** — complete event-driven pipeline

---

## 13. Open Questions

1. Should the reconciliation window be 15 min or 30 min for Stripe? Stripe webhooks are more reliable — longer window reduces unnecessary provider API calls.
2. Should `ProvisioningOutbox.maxRetries` be global config or per `provisioningType`? Default 3 assumed.
3. Should `AuditLog` TTL be 365 days or longer? Some regions require payment records for 5–7 years — compliance sign-off needed.
4. `SubscriptionPlans.amount` — stored as whole currency (199.99) or minor units (19999)? Same rule must apply consistently across plan → `PaymentOrders` → provider.
5. CCAvenue eventId strategy — SHA-256 fingerprint of `encResp` as idempotency anchor. Needs confirmation that CCAvenue never sends a different `encResp` for the same payment event.

---

*End of Document*
