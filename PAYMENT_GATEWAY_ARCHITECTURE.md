# Payment Gateway Architecture — Technical Design Document
**Document Type:** CTO Review — LLD v2 Analysis  
**Date:** June 2026  
**Author:** Engineering Team  
**Status:** Current Implementation

---

## 1. Executive Summary

This document describes the Payment Gateway system — what it is, what problems the new architecture solves over the previous approach, and a detailed breakdown of every component. The goal is to give leadership a clear picture of the design decisions made, the trade-offs involved, and what capabilities this system now provides.

---

## 2. What Was There Before (Previous Architecture)

The previous payment system had the following characteristics:

### 2.1 Single Provider, Hard-Coded Integration
- Stripe was the only payment provider, integrated directly inside business logic.
- There was no abstraction layer — Stripe SDK calls were scattered across service files.
- Adding a second provider (e.g., Razorpay, CCAvenue) would have required rewriting large portions of business code.

### 2.2 No Payment Order Tracking
- Payments were initiated and the result was stored directly on the `Orders` table.
- There was no intermediate `PaymentOrders` record to track lifecycle stages (initiated → processing → completed → failed).
- A failed payment had no structured retry path — it required manual intervention or a full re-initiation from the frontend.

### 2.3 No Webhook Reliability
- Webhook events from Stripe arrived and were processed inline — if processing failed mid-way, the event was lost.
- No idempotency — the same webhook event could trigger duplicate actions (double charge, double subscription creation).
- No signature verification audit trail.

### 2.4 No Provisioning Guarantee
- After a payment succeeded, the downstream action (e.g., activating a subscription, adding marketplace add-ons) happened synchronously in the same HTTP request.
- If that downstream step failed (DB timeout, service crash), the user was charged but never provisioned — a silent data corruption with no recovery path.

### 2.5 No Audit Trail
- There was no structured record of who changed what, when, and from which state.
- Debugging a payment dispute required manually tracing across multiple tables with no single source of truth.

### 2.6 Wallet Was Not Integrated
- Wallet top-ups and wallet balance application to orders were separate, disconnected flows with no transactional linkage to payments.

### 2.7 No Reconciliation
- If a webhook was missed or the server was down during a payment confirmation, there was no automatic process to check and heal payment state.

---

## 3. What the New Architecture Solves

| Problem (Before) | Solution (Now) |
|---|---|
| Single provider hard-coded | `IPaymentProvider` interface + `PaymentProviderFactory` — swap/add providers without touching business logic |
| No payment lifecycle tracking | `PaymentOrders` table with status state machine |
| Unreliable webhook processing | `WebhookEvent` entity — idempotent, logged before processing |
| No provisioning guarantee | `ProvisioningOutbox` — polled every 30s, retried until done |
| No audit trail | `AuditLog` entity — every state change recorded with actor, action, before/after |
| Wallet disconnected | `WalletTransactions` + `WalletTopupRequests` linked by orderId |
| No reconciliation | `ReconciliationController` — scheduled every 15 minutes |
| Duplicate webhook risk | Idempotency key check on `WebhookEvent` before processing |

---

## 4. Component Breakdown

---

### 4.1 Data Layer — Entities

#### `Orders`
The primary business record representing a customer order.

| Field | Purpose |
|---|---|
| `orderId` | Primary key (VARCHAR) |
| `buyerId`, `companyId` | Who placed the order |
| `orderStatus` | GSI-indexed — used for filtered queries across order lifecycle |
| `totalPrice`, `wholesalePrice`, `walletBalancePrice` | Price breakdown — supports wallet partial payments |
| `invoicePaid` | Boolean flag — has the invoice been marked settled |
| `remainingAmount` | Tracks partial payment balance |
| `paymentStatus` | Enum: `PAYMENT_PENDING`, `PAYMENT_DONE`, `PAYMENT_COMPLETED`, `PAYMENT_REJECTED`, `PAYMENT_REFUNDED` |
| `paymentOrderId` | Foreign key → `PaymentOrders` — links business record to payment ledger |
| `paymentRejectionDetails` | Stores provider rejection reason for dispute handling |

**Why it matters:** Orders remain the business source of truth. The new design separates payment concerns into `PaymentOrders` rather than bloating this table.

---

#### `PaymentOrders`
The payment ledger — one record per payment attempt.

| Field | Purpose |
|---|---|
| `id` | UUID PK |
| `orderId` | FK → Orders |
| `subscriptionId` | FK → Subscription (for subscription payments) |
| `companyId` | Tenant identifier |
| `amount`, `currency` | What was charged |
| `paymentOrderType` | Enum distinguishing Marketplace Order, Subscription, Marketplace Plan Order |
| `status` | `PaymentOrderStatusEnum` — the lifecycle state |
| `paymentProvider` | Which provider handled this (STRIPE, RAZORPAY, CCAVENUE) |
| `paymentProviderOrderId` | Provider's own reference ID — used for reconciliation and refunds |
| `provisioningStatus` | Tracks whether downstream provisioning has completed |
| `retryCount` | Tracks automatic retry attempts |
| `lastError` | Last failure reason — surfaced for ops tooling |
| `processedAt` | When the payment was confirmed by the provider |

**Why it matters:** Every payment attempt is its own record. Retries create a traceable history. Refunds reference the original `paymentProviderOrderId`. Reconciliation can query by `status` without scanning `Orders`.

---

#### `Subscription`
Tracks active subscription state per company.

| Field | Purpose |
|---|---|
| `id` | UUID PK |
| `userId`, `companyId` | Owner — `companyId` is GSI-indexed for fast tenant lookup |
| `planId` | FK → `SubscriptionPlans` |
| `status` | `subscriptionStatusEnum`: `ACTIVE`, `TRIALING`, `CANCELLED`, `EXPIRED` |
| `currentPeriodStart`, `currentPeriodEnd` | Billing window |
| `trialEnd` | Trial period boundary |
| `cancelAtPeriodEnd` | Graceful cancel flag — does not immediately revoke access |
| `paymentProvider` | Which provider manages this subscription |
| `providerSubscriptionId` | Provider's own subscription ID (Stripe `sub_xxx`) |
| `canceledAt` | Timestamp of cancellation |

**Why it matters:** Decoupled from `Orders` — subscription lifecycle is independent from marketplace order lifecycle.

---

#### `SubscriptionPlans`
The plan catalogue.

| Field | Purpose |
|---|---|
| `planId` | PK |
| `name`, `description` | Display fields |
| `price` | DECIMAL — base price |
| `interval`, `intervalCount` | Billing frequency (e.g., monthly, 1) |
| `trialPeriodDays` | Free trial window |
| `isActive` | Soft toggle — disable plans without deleting them |
| `providerPlanId` | Provider's plan/price ID (e.g., Stripe `price_xxx`) |
| `marketplace` | Whether this plan is tied to marketplace access |

---

#### `AuditLog`
Immutable event ledger — every state change in the system writes a record here.

| Field | Purpose |
|---|---|
| `id` | UUID PK |
| `entity_type` | GSI — `EntityTypeEnum`: Order or Subscription |
| `entity_id` | GSI — the orderId or subscriptionId being changed |
| `companyId` | Tenant |
| `actorType` | `SYSTEM`, `USER`, `ADMIN` |
| `actorId` | Who triggered the change |
| `action` | `actionTypeEnum` — what happened (PAYMENT_SUCCESS, REFUND_INITIATED, etc.) |
| `previousStatus`, `newStatus` | State before and after — can be null for creation events |
| `metadata` | Free JSON — provider response, amount, reason |
| `createdAt` | Immutable timestamp |

**Why it matters:** Single source of truth for payment disputes, refund decisions, and compliance. No manual table-tracing needed.

---

#### `ProvisioningOutbox`
Reliability pattern — guarantees downstream provisioning completes even if the system crashes after a payment success.

| Field | Purpose |
|---|---|
| `jobId` | UUID PK — maps to `PaymentOrders.orderId` |
| `orderId` | FK → `PaymentOrders` |
| `status` | `ProvisioningStatusEnum`: `PENDING`, `IN_PROGRESS`, `DONE`, `FAILED` |
| `paymentType` | What needs to be provisioned |
| `retryCount` | Auto-incremented on each failed attempt |
| `lastError` | Last failure reason |
| `processedAt` | When provisioning completed successfully |
| `TTL` | Epoch seconds — record auto-expires after completion |

**Why it matters:** This is the most critical reliability mechanism. The flow is:
1. Payment succeeds → write `ProvisioningOutbox` record atomically in the same transaction.
2. A background poller runs every 30 seconds, picks up `PENDING` records, and calls `SubscriptionService.addMarketplaceAddOns()`.
3. On success → marks `DONE`. On failure → increments `retryCount`, marks `FAILED`, retries on next poll.
4. The customer is **always provisioned** even if the service crashes between payment confirmation and provisioning.

---

#### `WalletTransactions`
Ledger of all wallet money movements per company.

| Field | Purpose |
|---|---|
| `id` | UUID PK |
| `orderId` | Which order triggered this movement |
| `companyId` | Tenant |
| `amount`, `currency` | Movement value |
| `type` | `walletTransactionTypeEnum`: `CREDIT` (top-up, refund) or `DEBIT` (applied to order) |
| `auditId` | Links to `AuditLog` record |

---

#### `WalletTopupRequests`
Approval workflow for manually adding funds to a company wallet.

| Field | Purpose |
|---|---|
| `orderId` | Reference |
| `amount`, `currency` | Requested top-up value |
| `status` | `walletTopupStatusEnum`: `proposed`, `PROCESSED`, `denied`, `CLOSED` |
| `requestedBy`, `approvedBy` | Dual-control — who asked, who approved |
| `approvalNote` | Free text for ops audit |
| `processedAt` | When funds were actually applied |

---

#### `PaymentProviderConfig`
Runtime configuration per payment provider — avoids hardcoded secrets in code.

| Field | Purpose |
|---|---|
| `provider` | STRIPE, RAZORPAY, CCAVENUE |
| `apiKey` | Encrypted at rest |
| `supportedCurrencies` | e.g., `[MAC_USD]` — used by factory for routing |
| `webhookSecret` | Used for signature verification on incoming webhooks |
| `isActive` | Toggle providers on/off without deployment |

---

#### `WebhookEvent`
Idempotent log of every inbound webhook from a payment provider.

| Field | Purpose |
|---|---|
| `id` | Provider's event ID — used as idempotency key |
| `paymentProvider` | Which provider sent it |
| `eventType` | `webhookEventTypeEnum` |
| `payload` | Full raw payload stored for replay |
| `status` | Processing state |
| `processedAt` | When it was handled |

**Why it matters:** The handler checks if `id` already exists before processing. Duplicate webhooks (Stripe retries on 5xx) are silently discarded. The raw payload enables event replay for debugging.

---

### 4.2 Provider Layer

#### `IPaymentProvider` Interface
The contract every payment provider must implement:

```
+ createSessionOrder(orderId, amount, currency, description)
+ markOrderAsPaid(orderId, providerId, providerOrderId, status)
+ getSessionOrderStatus()           — polls provider for final status
+ getSubscriptionById()             — fetch subscription state from provider
+ cancelSubscription(subscriptionId)
+ renewSubscription(subscriptionId)
```

**Why it matters:** Business logic calls the interface, not a specific SDK. Swapping Stripe for Razorpay for a specific country requires zero changes to service code.

---

#### `StripeProvider`
Implements `IPaymentProvider` using the Stripe Node SDK. Handles Stripe Checkout Sessions, Stripe Subscriptions, and Stripe refund APIs.

#### `RazorPayProvider`
Implements `IPaymentProvider` using the Razorpay SDK. Intended for INR payments and Indian market.

#### `CCavenueProvider`
Implements `IPaymentProvider`. CCAvenue is a popular Indian payment gateway with its own redirect-based flow.

---

#### `PaymentProviderFactory`
Routes payment requests to the correct provider implementation.

```
+ getProvider(type: PaymentProviderTypeEnum): IPaymentProvider
+ getProviderForCountry(country, currency): IPaymentProvider
```

**Why it matters:** Country/currency-based routing means a company in India automatically uses Razorpay while a US company uses Stripe — without any application logic change.

---

### 4.3 Controller Layer

#### `PaymentController`
```
POST /payment/initiate   [AUTHENTICATED]
```
Entry point for all payment initiations — marketplace orders and subscription payments. Validates the request, creates a `PaymentOrders` record, delegates to `PaymentService`.

#### `SubscriptionController`
```
GET    /subscriptions          — list active subscription for the company
GET    /subscriptions/{planId} — get plan details
DELETE /subscriptions/{plan}   — cancel subscription
```

#### `WebhookController`
```
POST /webhook/stripe
POST /webhook/razorpay
POST /webhook/[ccavenue]
```
Receives provider callbacks. Verifies signature, writes a `WebhookEvent` record, delegates to `PaymentCallbackService`. No business logic lives here.

#### `ReconciliationController`
```
+ reconcile()   — runs every 15 minutes
```
Queries `PaymentOrders` where status is `INITIATED` or `PROCESSING` and the `processedAt` is older than a threshold. For each, calls `getSessionOrderStatus()` on the provider and heals the state. Handles missed webhooks (e.g., server was down).

---

### 4.4 Service Layer

#### `PaymentService`
```
+ initiatePaymentOrder()   — creates PaymentOrders record, calls provider.createSessionOrder()
+ updatePaymentOrder()     — updates status, writes AuditLog
+ processPayment()         — top-level orchestrator
```

#### `PaymentCallbackService`
Called by `WebhookController` after signature verification.
```
+ handleCallback(provider, orderId, signature)
+ verifySignature()       — delegates to provider-specific verification
+ updateStatus()          — updates PaymentOrders status
+ emitEvent()             — publishes PaymentSuccessEvent
```
After emitting the event, three async listeners run:
- `SubscriptionProvisioningListener` → writes to `ProvisioningOutbox`
- `ReceiptMailListener` → sends payment confirmation email
- `AnalyticsListener` → pushes event to analytics pipeline

#### `SubscriptionService`
```
+ createOrUpdateSubscription(companyId, planId)
+ cancelSubscription()
+ getActiveSubscription()
+ renewSubscription()
+ getActivePlanDetails()
+ handleSubscriptionRefund()
```

---

### 4.5 Event-Driven Layer

#### `PaymentSuccessEvent`
Published by `PaymentCallbackService` after a confirmed payment. Decouples the payment confirmation from downstream side-effects. Each listener is independent — a mail failure does not roll back provisioning.

#### `SubscriptionProvisioningListener`
Receives `PaymentSuccessEvent` and writes a `ProvisioningOutbox` record. The actual provisioning is then handled by the outbox poller — not inline.

#### `ReceiptMailListener`
Sends the payment receipt email to the company.

#### `AnalyticsListener`
Pushes payment data to the analytics system (revenue tracking, cohort analysis).

---

## 5. Enum Reference

| Enum | Values |
|---|---|
| `subscriptionStatusEnum` | ACTIVE, TRIALING, CANCELLED, EXPIRED |
| `paymentOrderTypeEnum` | SUBSCRIPTION, SUBSCRIPTION_MARKETPLACE, MARKETPLACE_ORDER, MARKETPLACE_PLAN_ORDER |
| `walletTopupStatusEnum` | proposed, PROCESSED, denied, CLOSED |
| `walletTransactionTypeEnum` | CREDIT, DEBIT |
| `paymentMethodEnum` | OWN_TIME, RAZORPAY, STRIPE, CCAVENUE |
| `orderTypeEnum` | order, ADMIN, AGENT, MARKETING |
| `actionTypeEnum` | PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_INITIATED, REFUND_PAYMENT, REFUND_INITIATED, APPROVED, ADMIN_ADDED, EXPIRED, PENDING, SUBSCRIPTION_CREATED, PAYMENT_CANCELLED |
| `webhookEventTypeEnum` | PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_INITIATED, SUBSCRIPTION_RENEWED, SUBSCRIPTION_CANCELLED |
| `walletTransactionStatusEnum` | PENDING, FAILED, SUBMITTED, REVERSED |
| `orderStatusEnum` | CREATED, ORDER_IN_PROGRESS, SYNC_COMPLETED, MAIN_JOB_DELIVERY, APPROVED, CANCELLED |
| `orderPaymentStatusEnum` | PAYMENT_PENDING, PAYMENT_DONE, PAYMENT_COMPLETED, PAYMENT_REJECTED, PAYMENT_REFUNDED |
| `provisioningStatusEnum` | PENDING, IN_PROGRESS, DONE, FAILED |
| `paymentProviderTypeEnum` | STRIPE, RAZORPAY, CCAVENUE |

---

## 6. End-to-End Payment Flow

```
1. Frontend calls POST /payment/initiate
2. PaymentController → PaymentService.initiatePaymentOrder()
3. PaymentService creates PaymentOrders record (status: INITIATED)
4. PaymentProviderFactory.getProvider() → correct provider
5. Provider.createSessionOrder() → returns checkout URL/session
6. Frontend redirects user to provider checkout
7. User completes payment → Provider sends webhook
8. WebhookController receives webhook
   ├── Verify signature (PaymentCallbackService.verifySignature)
   ├── Write WebhookEvent record (idempotency check)
   └── PaymentCallbackService.handleCallback()
       ├── Update PaymentOrders → status: COMPLETED
       ├── Write AuditLog record
       └── Emit PaymentSuccessEvent
           ├── SubscriptionProvisioningListener → write ProvisioningOutbox
           ├── ReceiptMailListener → send email
           └── AnalyticsListener → push to analytics

9. ProvisioningOutbox poller (every 30s)
   └── Picks PENDING jobs → calls SubscriptionService.addMarketplaceAddOns()
       ├── Success → mark DONE
       └── Failure → increment retryCount, mark FAILED, retry next poll

10. ReconciliationController (every 15m)
    └── Finds stale INITIATED orders → calls provider.getSessionOrderStatus() → heals state
```

---

## 7. Key Design Decisions and Trade-offs

### Decision 1: Outbox Pattern for Provisioning
**Why:** Eliminates the "charged but not provisioned" data corruption scenario.  
**Trade-off:** Provisioning is eventually consistent — there is up to a 30-second delay between payment confirmation and feature activation. This is acceptable for the business.

### Decision 2: Provider Abstraction via Interface
**Why:** Multi-market support (India vs global) without code duplication.  
**Trade-off:** Each new provider requires implementing the full `IPaymentProvider` contract — adds initial development overhead but saves long-term maintenance.

### Decision 3: Webhook Idempotency via WebhookEvent Table
**Why:** Payment providers retry webhooks on failure — without idempotency a customer could be double-charged or double-provisioned.  
**Trade-off:** Adds a DB write on every webhook, but this is necessary for correctness.

### Decision 4: Event-Driven Post-Payment Side Effects
**Why:** Decouples mail, analytics, and provisioning from the payment critical path. A broken mail server does not fail a payment.  
**Trade-off:** Harder to trace failures end-to-end — requires event bus monitoring.

### Decision 5: Reconciliation Scheduler
**Why:** Webhooks can be missed (server downtime, network issues). Reconciliation ensures eventual consistency without manual ops intervention.  
**Trade-off:** 15-minute window means a missed webhook can leave a payment in limbo for up to 15 minutes. Acceptable given the low frequency of missed webhooks.

---

## 8. What Is Not Yet Built (Gaps from LLD)

Based on the diagram, the following components are designed but not yet fully implemented in the codebase:

| Component | Status | Notes |
|---|---|---|
| `RazorPayProvider` | Designed, not implemented | Only `StripeProvider` exists in `/src/payment-provider/providers/` |
| `CCavenueProvider` | Designed, not implemented | Not in codebase |
| `ReconciliationController` | Designed, not implemented | No reconciliation service found in codebase |
| `ProvisioningOutbox` | Designed, not implemented | No outbox entity or poller in codebase |
| `WalletTransactions` | Designed, not implemented | No wallet module in current codebase |
| `WalletTopupRequests` | Designed, not implemented | No wallet module in current codebase |
| `PaymentProviderConfig` | Designed, not implemented | Config is currently static |
| `AnalyticsListener` | Designed, not implemented | |
| `ReceiptMailListener` | Designed, not implemented | |

**Current codebase implements:** Stripe-only payment, subscription management, plan management, audit log, and webhook handling for Stripe.

---

## 9. Recommended Next Steps

1. **Implement `ProvisioningOutbox`** — highest priority. Eliminates the biggest reliability risk.
2. **Implement `ReconciliationController`** — second highest. Handles missed webhooks without manual ops.
3. **Add `WalletTransactions` module** — enables wallet-based partial payments.
4. **Implement `RazorPayProvider`** — required for India market.
5. **Migrate `PaymentProviderConfig` to DB** — allows ops to rotate keys and toggle providers without deployment.
6. **Wire `ReceiptMailListener` and `AnalyticsListener`** — complete the event-driven pipeline.

---

*End of Document*
