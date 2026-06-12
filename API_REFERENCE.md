# API Reference — Mobylx Payment Gateway
**Base URL:** `http://localhost:3000`  
**Swagger UI:** `http://localhost:3000/api/docs`  
**Content-Type:** `application/json` (all requests and responses)

---

## Authentication

Protected endpoints require a **JWT Bearer token** in the `Authorization` header.

```
Authorization: Bearer <access_token>
```

Endpoints marked 🔒 require this header. Endpoints marked 🌐 are public.

---

## Error Response Format

All errors follow a consistent shape:

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

| Code | Meaning |
|---|---|
| `400` | Validation failed — check `message` array for field errors |
| `401` | Missing or invalid JWT token |
| `404` | Resource not found |
| `409` | Conflict — e.g. email already in use |
| `422` | Unprocessable — e.g. amount tamper detected |
| `503` | Payment provider temporarily disabled |

---

## 1. Auth

### `POST /auth/login` 🌐
Get a JWT token. No password required in Phase 1 — login by email only.

**Request:**
```json
{
  "email": "john@example.com"
}
```

**Response `200`:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
}
```

**Errors:**
- `401` — no user found with that email

> Token expires in **7 days**. Store in memory or `sessionStorage` — avoid `localStorage` for security.

---

## 2. Users

### `POST /users` 🌐
Create a new user account.

**Request:**
```json
{
  "email": "john@example.com",
  "name": "John Doe"
}
```

**Response `201`:**
```json
{
  "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "email": "john@example.com",
  "name": "John Doe",
  "isPremium": false,
  "plan": "basic"
}
```

**Errors:**
- `409` — email already in use

---

### `GET /users` 🌐
List all users.

**Response `200`:** Array of user objects (same shape as above).

---

### `GET /users/:id` 🌐
Get a single user by UUID.

**Response `200`:** User object.  
**Errors:** `404`

---

### `PATCH /users/:id` 🌐
Update user fields.

**Request** (all fields optional):
```json
{
  "name": "John Updated",
  "isPremium": true,
  "plan": "pro"
}
```

**Response `200`:** Updated user object.

---

### `DELETE /users/:id` 🌐
Delete a user.

**Response `204`:** No content.

---

## 3. Plans

### `GET /plans` 🌐
List all active plans. Use this to populate a pricing page.

**Response `200`:**
```json
[
  {
    "id": "plan-uuid",
    "name": "Pro",
    "providerName": "stripe",
    "providerPlanId": "price_stripe_id",
    "amount": 1999,
    "currency": "usd",
    "interval": "month",
    "intervalCount": 1,
    "trialDays": 14,
    "features": {
      "analytics": true,
      "api": true,
      "seats": 5
    },
    "isActive": true,
    "createdAt": "2026-06-01T00:00:00.000Z",
    "updatedAt": "2026-06-01T00:00:00.000Z"
  }
]
```

> `amount` is always in **minor units** (cents). `1999` = $19.99 USD. Divide by 100 for display.

---

## 4. Payments

### `POST /payments/initiate` 🔒 ← PRIMARY ENDPOINT
Initiate a payment. Returns a Stripe Checkout URL — redirect the user there.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Request:**
```json
{
  "planId": "plan-uuid",
  "paymentType": "ONE_TIME",
  "successUrl": "https://yourapp.com/payment/success",
  "cancelUrl": "https://yourapp.com/payment/cancel"
}
```

| Field | Type | Required | Values |
|---|---|---|---|
| `planId` | UUID | ✅ | UUID of a plan from `GET /plans` |
| `paymentType` | string | ✅ | `ONE_TIME` \| `SUBSCRIPTION` |
| `successUrl` | string | ✅ | URL Stripe redirects to after payment |
| `cancelUrl` | string | ✅ | URL Stripe redirects to if user cancels |

**Response `201`:**
```json
{
  "provider": "stripe",
  "action": "REDIRECT",
  "url": "https://checkout.stripe.com/c/pay/cs_test_a1b2c3...",
  "sessionId": "cs_test_a1b2c3..."
}
```

**Frontend integration:**
```javascript
const res = await fetch('/payments/initiate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    planId: 'plan-uuid',
    paymentType: 'ONE_TIME',
    successUrl: `${window.location.origin}/payment/success`,
    cancelUrl: `${window.location.origin}/payment/cancel`
  })
});
const payload = await res.json();

// Always switch on `action`, never on `provider`
if (payload.action === 'REDIRECT') {
  window.location.href = payload.url;
}
```

**Errors:**
- `401` — missing/invalid token
- `404` — planId not found
- `400` — plan is inactive
- `503` — payment provider is disabled

---

### `GET /payments` 🌐
List all payments. Filter by user with query param.

```
GET /payments?userId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
```

**Response `200`:** Array of payment objects.

```json
[
  {
    "id": "payment-uuid",
    "userId": "user-uuid",
    "planId": "plan-uuid",
    "providerName": "stripe",
    "providerIntentId": "cs_test_...",
    "amount": 1999,
    "status": "initiated",
    "type": "ONE_TIME",
    "frozen": false,
    "createdAt": "2026-06-12T10:00:00.000Z",
    "updatedAt": "2026-06-12T10:00:00.000Z"
  }
]
```

**Payment `status` values:**

| Status | Meaning |
|---|---|
| `initiated` | User sent to provider — awaiting confirmation |
| `success` | Payment confirmed by provider |
| `failed` | Provider rejected the payment |
| `needs_review` | Unrecognised provider status — ops to review |
| `expired` | Session expired without payment |
| `refunded` | Refund issued |

---

### `GET /payments/:id` 🌐
Get a single payment by UUID.

**Response `200`:** Payment object (see above).  
**Errors:** `404`

---

### `POST /payments/:id/sync` 🌐
Force-sync payment status from provider. Useful if webhook was missed.

**Response `200`:** Updated payment object.

---

### `POST /payments/:id/retry` 🌐
Re-check status of a failed payment from provider.

**Response `200`:** Updated payment object.  
**Errors:** `400` — payment already succeeded or is frozen.

---

### `POST /payments/:id/refund` 🌐
Refund a succeeded payment.

**Request:**
```json
{
  "amount": 1000,
  "reason": "customer_request"
}
```

| Field | Required | Notes |
|---|---|---|
| `amount` | ❌ | Omit for full refund; provide for partial (in cents) |
| `reason` | ❌ | `customer_request` \| `duplicate` \| `fraudulent` |

**Response `200`:** Payment object with `status: "refunded"`.

---

## 5. Subscriptions

### `POST /subscriptions` 🌐
Create a subscription. Requires Stripe Customer ID and Payment Method ID (collected via Stripe.js on the frontend).

**Request:**
```json
{
  "userId": "user-uuid",
  "planId": "plan-uuid",
  "providerCustomerId": "cus_stripe_customer_id",
  "providerPmId": "pm_stripe_payment_method_id",
  "providerName": "stripe"
}
```

| Field | Required | Notes |
|---|---|---|
| `userId` | ✅ | |
| `planId` | ✅ | |
| `providerCustomerId` | ✅ | Stripe `cus_...` — create via Stripe.js or Stripe Dashboard |
| `providerPmId` | ✅ | Stripe `pm_...` — from `stripe.createPaymentMethod()` |
| `providerName` | ❌ | Defaults to plan's `providerName` |

**Response `201`:**
```json
{
  "id": "sub-uuid",
  "userId": "user-uuid",
  "providerName": "stripe",
  "providerSubId": "sub_stripe_id",
  "providerCustomerId": "cus_...",
  "planId": "plan-uuid",
  "planName": "Pro",
  "planAmount": 1999,
  "status": "active",
  "currentPeriodStart": "2026-06-12T00:00:00.000Z",
  "currentPeriodEnd": "2026-07-12T00:00:00.000Z",
  "trialEnd": null,
  "cancelAtPeriodEnd": false,
  "failedAttempts": 0,
  "nextRetryAt": null,
  "cancelledAt": null,
  "createdAt": "2026-06-12T10:00:00.000Z"
}
```

**Subscription `status` values:**

| Status | Meaning |
|---|---|
| `trialing` | In trial period |
| `active` | Billing normally |
| `past_due` | Payment failed — retrying |
| `canceled` | Cancelled |
| `unpaid` | All retries exhausted |
| `incomplete` | Initial payment incomplete |
| `incomplete_expired` | Initial payment expired |

---

### `GET /subscriptions` 🌐
List subscriptions. Filter by user.

```
GET /subscriptions?userId=user-uuid
```

**Response `200`:** Array of subscription objects.

---

### `GET /subscriptions/:id` 🌐
Get single subscription.

**Response `200`:** Subscription object.

---

### `POST /subscriptions/:id/subscribe` 🌐
Upgrade or re-activate to a new plan.

**Request:**
```json
{ "planId": "new-plan-uuid" }
```

**Response `200`:** Updated subscription object.

---

### `POST /subscriptions/:id/cancel` 🌐
Cancel a subscription.

**Request:**
```json
{ "atPeriodEnd": true }
```

| `atPeriodEnd` | Behaviour |
|---|---|
| `true` (default) | Access continues to end of billing cycle |
| `false` | Cancelled immediately — user downgraded now |

**Response `200`:** Updated subscription object.

---

### `POST /subscriptions/:id/renew` 🌐
Manually renew a subscription (usually called by webhook, but exposed for admin use).

**Request:**
```json
{ "newProviderPmId": "pm_new_payment_method" }
```

`newProviderPmId` is optional — omit to renew with the existing payment method.

**Response `200`:** Updated subscription object.

---

## 6. Webhooks — Provider Callbacks

These endpoints are called by **Stripe**, not by the frontend. Do not call these from client code.

### `POST /webhook/stripe` 🌐
Stripe webhook receiver. Stripe posts here after payment events.

**Headers set by Stripe:**
```
stripe-signature: t=1234567890,v1=abc123...
Content-Type: application/json
```

**Response `200`:**
```json
{ "received": true }
```

Configure in **Stripe Dashboard → Webhooks → Add endpoint:**
```
https://your-domain.com/webhook/stripe
```

**Events to enable:**
- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

---

## 7. Complete Frontend Integration Flows

### Flow A — One-Time Payment

```
1. POST /users               → create account
2. POST /auth/login          → get access_token
3. GET  /plans               → show pricing to user
4. POST /payments/initiate   → get Stripe Checkout URL
5. window.location.href = url   → user pays on Stripe
6. Stripe redirects to successUrl
7. GET  /payments?userId=... → poll/display payment status
```

---

### Flow B — Subscription Payment (via Checkout Session)

```
1. POST /users               → create account
2. POST /auth/login          → get access_token
3. GET  /plans               → pick plan
4. POST /payments/initiate   → { paymentType: "SUBSCRIPTION", ... }
5. Redirect to Stripe Checkout
6. Stripe sends webhook → subscription activated automatically
7. GET  /subscriptions?userId=...  → show subscription status
```

---

### Flow C — Check Payment Result on Success Page

After Stripe redirects to your `successUrl`, Stripe appends `?session_id=cs_test_...` to the URL. Use it to display the result:

```javascript
// On /payment/success page
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session_id');

// Poll the payment status using userId
const payments = await fetch(`/payments?userId=${userId}`, {
  headers: { Authorization: `Bearer ${token}` }
}).then(r => r.json());

const payment = payments.find(p => p.providerIntentId === sessionId);
// payment.status will be 'success', 'initiated' (still processing), or 'failed'
```

> Webhooks are async — the payment may still be `initiated` for a few seconds after redirect. Poll with a short delay or show a "processing" state.

---

### Flow D — Subscription Cancellation

```javascript
// Cancel at period end (user keeps access until billing cycle ends)
await fetch(`/subscriptions/${subId}/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ atPeriodEnd: true })
});

// Cancel immediately
await fetch(`/subscriptions/${subId}/cancel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ atPeriodEnd: false })
});
```

---

## 8. Environment Setup for Local Testing

Add to `.env`:
```
JWT_SECRET=replace-with-a-long-random-string-32-chars-min
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Test webhook locally with Stripe CLI:**
```bash
stripe listen --forward-to localhost:3000/webhook/stripe
# Stripe CLI prints a webhook secret — set it as STRIPE_WEBHOOK_SECRET
```

**Trigger a test payment event:**
```bash
stripe trigger checkout.session.completed
```

---

## 9. Quick Reference — All Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | 🌐 | Get JWT token |
| `POST` | `/users` | 🌐 | Create user |
| `GET` | `/users` | 🌐 | List users |
| `GET` | `/users/:id` | 🌐 | Get user |
| `PATCH` | `/users/:id` | 🌐 | Update user |
| `DELETE` | `/users/:id` | 🌐 | Delete user |
| `GET` | `/plans` | 🌐 | List active plans |
| `POST` | `/payments/initiate` | 🔒 | **Initiate payment → Stripe Checkout URL** |
| `GET` | `/payments` | 🌐 | List payments (`?userId=`) |
| `GET` | `/payments/:id` | 🌐 | Get payment |
| `POST` | `/payments/:id/sync` | 🌐 | Sync status from provider |
| `POST` | `/payments/:id/retry` | 🌐 | Retry failed payment |
| `POST` | `/payments/:id/refund` | 🌐 | Refund payment |
| `POST` | `/subscriptions` | 🌐 | Create subscription |
| `GET` | `/subscriptions` | 🌐 | List subscriptions (`?userId=`) |
| `GET` | `/subscriptions/:id` | 🌐 | Get subscription |
| `POST` | `/subscriptions/:id/subscribe` | 🌐 | Upgrade / re-activate plan |
| `POST` | `/subscriptions/:id/cancel` | 🌐 | Cancel subscription |
| `POST` | `/subscriptions/:id/renew` | 🌐 | Renew subscription |
| `POST` | `/webhook/stripe` | 🌐 | Stripe webhook (Stripe → server only) |
