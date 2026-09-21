# 03 — Idempotency

## Overview

This lab demonstrates how **idempotency** prevents duplicate processing when a request is retried.

The scenario is based on a payment service where:

1. A client sends a payment request.
2. The payment service takes several seconds to process it.
3. The caller has a shorter timeout.
4. The caller times out and retries the request.
5. Both requests contain the same `Idempotency-Key`.

The goal is to understand why retries can cause duplicate side effects and how idempotency can prevent them.

---

## Architecture

```text
Client
   │
   │ POST /orders
   ▼
┌──────────────────┐
│  Order Service   │
│   :3000          │
└────────┬─────────┘
         │
         │ POST /payments
         │ Idempotency-Key: order-payment-123
         ▼
┌──────────────────┐
│ Payment Service  │
│   :3001          │
└──────────────────┘
```

The Order Service has a **2-second timeout**.

The Payment Service takes **5 seconds** to process a payment.

This creates the possibility that the caller will retry while the original payment is still being processed.

---

# Experiment 1 — Naive Idempotency

The first implementation stores the payment result using the idempotency key:

```js
processedPayments.set(idempotencyKey, paymentResult);
```

When a request arrives, the service checks:

```js
if (processedPayments.has(idempotencyKey)) {
    // Return previous result
}
```

This looks correct at first.

However, the result is only stored **after processing finishes**.

That creates a race condition.

---

## Running the Experiment

Start the Payment Service:

```bash
node payment-service.js
```

Start the Order Service in another terminal:

```bash
node order-service.js
```

Then run the client:

```bash
node client.js
```

---

## Observed Result

The Payment Service produced:

```text
💰 Payment request received
🔑 Idempotency-Key: order-payment-123
🆕 New payment request
⏳ Processing payment...

💰 Payment request received
🔑 Idempotency-Key: order-payment-123
🆕 New payment request
⏳ Processing payment...

✅ Payment processed
💾 Result stored against idempotency key

✅ Payment processed
💾 Result stored against idempotency key
```

Two requests were processed even though they used the **same idempotency key**.

The service generated two different payment IDs:

```text
payment-1789995813485
payment-1789995815488
```

This proves that the payment was processed twice.

---

# Why Did This Happen?

The problem is the timing.

```text
Time
 │
0s ── Request #1 arrives
 │
 │    Key does not exist
 │    Start processing
 │
2s ── Request #1 times out
 │
 │    Retry starts
 │
 │    Request #2 arrives
 │    Key still does not exist
 │
 │    Start processing AGAIN
 │
5s ── Request #1 finishes
 │    Store idempotency key
 │
7s ── Request #2 finishes
      Store idempotency key again
```

The important detail is that the idempotency key wasn't recorded when processing **started**.

It was only recorded when processing **finished**.

Therefore, during the period where the first request was still processing:

```text
processedPayments.has("order-payment-123")
```

returned:

```text
false
```

for the retry.

The retry therefore looked like a completely new operation.

---

# The Race Condition

The problem can be visualized as:

```text
                 Request #1
                     │
                     ▼
              Key doesn't exist
                     │
                     ▼
              Start processing
                     │
                     │
                     │
                     │        Request #2
                     │            │
                     │            ▼
                     │     Key doesn't exist
                     │            │
                     │            ▼
                     │     Start processing
                     │
                     ▼
                Payment #1
                     │
                     ▼
              Store result
                     │
                     ▼
                Payment #2
                     │
                     ▼
              Store result
```

Both requests passed the idempotency check before either one stored the completed result.

---

# Important Lesson

An idempotency implementation cannot simply ask:

> "Have I already completed this operation?"

It also needs to know:

> "Is this operation already being processed?"

This means the idempotency record needs a state.

For example:

```text
NEW
 │
 ▼
PROCESSING
 │
 ▼
COMPLETED
```

---

# Correct Idempotency Model

A better implementation should behave like this:

```text
Request #1
    │
    ▼
Idempotency key does not exist
    │
    ▼
Create PROCESSING record
    │
    ▼
Process payment
    │
    ▼
Mark COMPLETED
```

If Request #2 arrives while Request #1 is processing:

```text
Request #2
    │
    ▼
Idempotency key exists
    │
    ▼
Status = PROCESSING
    │
    ▼
Do NOT process payment again
```

If a later request arrives after completion:

```text
Request #3
    │
    ▼
Idempotency key exists
    │
    ▼
Status = COMPLETED
    │
    ▼
Return stored result
```

---

# Why This Matters in Distributed Systems

The problem becomes even more important when a service has multiple instances.

For example:

```text
                 ┌───────────────┐
                 │ Load Balancer │
                 └───────┬───────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       Payment Service 1     Payment Service 2
              │                     │
              └──────────┬──────────┘
                         ▼
                    Shared DB
```

An in-memory `Map` is not sufficient here.

Each application instance would have its own memory:

```text
Payment Service 1
Map(...)
       ≠
Payment Service 2
Map(...)
```

Both instances could therefore believe:

```text
"This idempotency key doesn't exist."
```

A production implementation normally uses a shared persistent store such as a database or Redis, together with an atomic operation or unique constraint.

For example:

```text
idempotency_key UNIQUE
status
result
```

The uniqueness constraint ensures that only one request can successfully create the idempotency record.

---

# Key Takeaways

### 1. Retries can duplicate side effects

A timeout does not necessarily mean the original operation failed.

The operation may still be executing.

---

### 2. An idempotency key identifies a logical operation

Both requests can have:

```text
Idempotency-Key: order-payment-123
```

even though they are separate HTTP requests.

The service uses the key to recognize that they represent the same logical operation.

---

### 3. Storing the result only after completion is insufficient

This creates a window where multiple requests can begin processing the same operation.

---

### 4. Idempotency needs concurrency protection

The system needs to reserve the operation when processing begins:

```text
PROCESSING
```

rather than waiting until completion.

---

### 5. Distributed systems need shared state

An in-memory map works for this educational experiment, but production systems require shared durable state and atomic operations.

---

## What This Lab Demonstrates

This lab connects three concepts:

```text
Timeout
   │
   ▼
Retry
   │
   ▼
Duplicate Processing
   │
   ▼
Idempotency
   │
   ▼
Concurrency / Atomicity
```

The next stage of this lab will modify the implementation to correctly handle the `PROCESSING` state and prevent concurrent duplicate processing.

---

## Status

* [x] Demonstrate idempotency key
* [x] Demonstrate duplicate retry
* [x] Reproduce race condition
* [ ] Prevent duplicate processing while request is `PROCESSING`
* [ ] Store completed result
* [ ] Explore database-backed idempotency
