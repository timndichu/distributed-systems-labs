# Lab 02 — Retries

## Overview

This experiment demonstrates how retries behave in a distributed system when a downstream service does not respond within the caller's timeout period.

The experiment builds on **[Lab 01 — Timeouts](/01-Timeouts/)**.

The key lesson is:

> A retry does not necessarily replace the original request. The original request may still be executing while the retry creates a second request.

This can result in duplicate processing and unintended side effects.

---

## Architecture

```text
┌──────────────┐
│    Client    │
└──────┬───────┘
       │
       │ POST /orders
       ▼
┌──────────────────┐
│  Order Service   │
│                  │
│ Timeout: 2 sec   │
│ Retry: 1         │
└────────┬─────────┘
         │
         │ POST /payments
         ▼
┌──────────────────┐
│ Payment Service  │
│                  │
│ Processing: 5s   │
└──────────────────┘
```

### Services

| Service         |   Port | Purpose                                     |
| --------------- | -----: | ------------------------------------------- |
| Client          |      — | Initiates an order                          |
| Order Service   | `3000` | Sends payment requests and performs retries |
| Payment Service | `3001` | Simulates a slow payment operation          |

---

## Scenario

The Payment Service takes **5 seconds** to process a payment.

The Order Service waits only **2 seconds** for a response.

When the first request times out, the Order Service retries the request once.

```text
Payment processing time = 5 seconds
Caller timeout           = 2 seconds
Maximum retries          = 1
```

---

## Running the Experiment

### 1. Start the Payment Service

```bash
node payment-service.js
```

Expected output:

```text
💰 Payment Service running on port 3001
```

### 2. Start the Order Service

In another terminal:

```bash
node order-service.js
```

Expected output:

```text
📦 Order Service running on port 3000
```

### 3. Send an order

In a third terminal:

```bash
node client.js
```

---

## Expected Behaviour

The Order Service receives the order:

```text
📦 Order received
💳 Attempt 1: Sending payment request
```

After 2 seconds:

```text
⏰ Attempt 1: Request timed out
🔄 Retrying payment...
```

The second request is then sent:

```text
💳 Attempt 2: Sending payment request
```

It also times out because the Payment Service still takes 5 seconds:

```text
⏰ Attempt 2: Request timed out
❌ Payment failed: TIMEOUT
```

The client receives:

```json
{
  "orderCreated": false,
  "message": "Payment service unavailable"
}
```

---

## What Happens in the Payment Service?

This is where the important behavior appears.

The Payment Service receives **two separate HTTP requests**:

```text
💰 Payment request received
🆔 Payment operation #1
⏳ Processing payment...

💰 Payment request received
🆔 Payment operation #2
⏳ Processing payment...

✅ Payment #1 processed
✅ Payment #2 processed
```

Although the Order Service believes the payment failed, the Payment Service actually processed the operation twice.

---

## Timeline

```text
Time
 │
0s ── Attempt #1
 │
 ├──── Order Service → Payment Service
 │
 │     Payment Service starts processing
 │
 │
2s ── Attempt #1 times out
 │
 ├──── Order Service stops waiting
 │
 ├──── Retry begins
 │
 └──── Attempt #2 → Payment Service
 │
       Payment Service starts another operation
 │
 │
5s ── Payment #1 completes
 │
 │
7s ── Payment #2 completes
 │
 ▼
```

The important detail is that **the retry did not cancel or replace the first operation**.

---

## The Core Problem

A timeout creates an ambiguous outcome.

After Attempt #1 times out, the Order Service does not know whether:

```text
                    Attempt #1
                        │
                        ▼
                 Did it succeed?
                      ?
                     / \
                   YES  NO
```

It only knows that it didn't receive a response within 2 seconds.

The Order Service therefore sends Attempt #2.

But Attempt #1 may still be running.

The result can be:

```text
Attempt #1 → Payment succeeds
Attempt #2 → Payment succeeds
```

One logical user action has now caused **two side effects**.

---

## Why This Is Dangerous

Consider a real payment operation:

```http
POST /payments
```

with:

```json
{
  "accountId": "123",
  "amount": 10000
}
```

Suppose the first payment succeeds, but the response is lost or delayed.

The caller sees:

```text
TIMEOUT
```

and retries.

The payment service may process:

```text
Payment #1 → KES 10,000
Payment #2 → KES 10,000
```

The customer could therefore be charged twice.

The same problem can occur with other non-idempotent operations such as:

* creating orders
* transferring money
* sending emails
* charging credit cards
* creating accounts
* reserving inventory

---

## Retries Are Not Always Bad

Retries are useful when failures are transient.

For example:

```text
Service temporarily unavailable
        ↓
Retry
        ↓
Request succeeds
```

They can improve reliability when used appropriately.

The problem is **blindly retrying operations whose outcome is uncertain**.

A retry strategy therefore needs to consider:

1. **What failed?**
2. **Is the failure transient?**
3. **Has the original request potentially completed?**
4. **Is the operation safe to repeat?**
5. **How many times should we retry?**
6. **How long should we wait between attempts?**

---

## Retryable vs Non-Retryable Failures

Not every error should trigger a retry.

Examples:

| Failure            | Retry?      | Reason                                    |
| ------------------ | ----------- | ----------------------------------------- |
| HTTP `400`         | Usually no  | Request is invalid                        |
| HTTP `401`         | Usually no  | Authentication problem                    |
| HTTP `404`         | Usually no  | Resource may not exist                    |
| HTTP `429`         | Potentially | Rate limit may be temporary               |
| HTTP `500`         | Potentially | Server failure may be temporary           |
| Timeout            | Potentially | Outcome may be unknown                    |
| Connection failure | Potentially | Dependency may be temporarily unavailable |

The correct policy depends on the operation and the failure.

---

## The Retry Amplification Problem

Retries can also increase the load on an already struggling service.

Consider:

```text
100 requests
    ↓
Service becomes slow
    ↓
100 requests timeout
    ↓
100 retries
    ↓
Service receives 200 requests
    ↓
Service becomes even slower
    ↓
More timeouts
    ↓
More retries
```

This can create a feedback loop:

```text
Load
 ↓
Latency
 ↓
Timeouts
 ↓
Retries
 ↓
More Load
 ↓
More Latency
```

Therefore, retries need to be used carefully.

---

## Important Retry Strategies

Real systems commonly use techniques such as:

### Limited retries

Instead of retrying indefinitely:

```text
Maximum attempts = 3
```

### Backoff

Wait before retrying:

```text
Attempt 1
   ↓
wait
   ↓
Attempt 2
   ↓
wait longer
   ↓
Attempt 3
```

### Exponential backoff

For example:

```text
Attempt 1 → immediate
Attempt 2 → wait 1s
Attempt 3 → wait 2s
Attempt 4 → wait 4s
```

### Jitter

Add randomness to the backoff interval so that many clients do not retry simultaneously.

```text
Client A → retry after 1.2s
Client B → retry after 1.7s
Client C → retry after 1.4s
```

This helps reduce synchronized retry spikes.

---

## The Remaining Problem

Even with limited retries and backoff, there is still a fundamental question:

> **How do we safely retry an operation when we don't know whether the previous attempt succeeded?**

This experiment demonstrates that retries alone do not solve that problem.

We need a mechanism that allows the server to recognize:

```text
"This is the same logical operation I have already processed."
```

That mechanism is **idempotency**.

---

## Key Takeaways

1. **Retries can improve reliability when failures are transient.**

2. **A timeout does not necessarily mean the original operation failed.**

3. **The original request may still be executing when a retry is sent.**

4. **A retry creates a new request; it does not automatically replace the original request.**

5. **Retrying non-idempotent operations can cause duplicate side effects.**

6. **Retries can amplify load during an outage or performance problem.**

7. **Retry policies should consider the type of failure, retry count, backoff, and whether the operation is safe to repeat.**

8. **Idempotency is needed when an operation may be retried but should only produce one logical side effect.**

---

## Experiment Summary

```text
Downstream processing time: 5 seconds
Caller timeout:             2 seconds
Maximum retries:            1

Result:

Attempt #1
    ↓
TIMEOUT
    ↓
Attempt #2
    ↓
Both requests continue processing
    ↓
Payment #1 ✅
Payment #2 ✅

One logical operation
        ↓
Two HTTP requests
        ↓
Two side effects
```

This demonstrates why reliable distributed systems need to consider **timeouts, retries, and idempotency together**.
