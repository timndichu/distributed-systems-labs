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
│      :3000       │
└────────┬─────────┘
         │
         │ POST /payments
         │ Idempotency-Key: order-payment-123
         ▼
┌──────────────────┐
│ Payment Service  │
│      :3001       │
└──────────────────┘
```

The Order Service has a **2-second timeout**.

The Payment Service takes **5 seconds** to process a payment.

This creates the possibility that the caller will retry while the original payment is still being processed.

---

# Experiment 1 — Naive Idempotency

The first implementation stored the payment result using the idempotency key:

```js
processedPayments.set(idempotencyKey, paymentResult);
```

When a request arrived, the service checked:

```js
if (processedPayments.has(idempotencyKey)) {
    // Return previous result
}
```

This looks correct at first.

However, the result was only stored **after processing finished**.

That created a race condition.

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

The problem was the timing.

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

Therefore, while the first request was still processing:

```js
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

# Experiment 2 — Fixing the Race Condition

The implementation was changed so that the idempotency key is **reserved before payment processing begins**.

The service now stores:

```js
payments.set(idempotencyKey, {
  status: "PROCESSING",
});
```

before starting the payment operation.

The lifecycle is now:

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

If another request arrives while the first request is processing:

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

---

## Observed Result After the Fix

The Payment Service produced:

```text
💰 Payment request received
🔑 Idempotency-Key: order-payment-123
🆕 New payment request
🔒 Idempotency key reserved
📊 Status: PROCESSING
⏳ Processing payment...

💰 Payment request received
🔑 Idempotency-Key: order-payment-123
♻️ Existing idempotency record found
📊 Status: PROCESSING
⏳ Payment is already being processed
🚫 NOT starting another payment

✅ Payment processed
💾 Result stored
📊 Status: COMPLETED
```

The key observation is that there is now only **one payment processing operation**.

The retry detects:

```text
Status: PROCESSING
```

and does not start another payment.

---

# Experiment 3 — Retry After Completion

The next scenario tests what happens when the same request is retried **after the original operation has completed**.

The expected lifecycle is:

```text
PROCESSING
     │
     ▼
COMPLETED
     │
     │
     │ retry
     ▼
Return stored result
```

After the first payment completed, another request was sent using the same:

```text
Idempotency-Key: order-payment-123
```

The service detected the existing completed operation and returned the previously stored result instead of processing another payment.

Expected behavior:

```text
💰 Payment request received
🔑 Idempotency-Key: order-payment-123
♻️ Existing idempotency record found
📊 Status: COMPLETED
✅ Payment already completed
📦 Returning stored result
```

No new payment should be created.

---

# Correct Idempotency Model

The complete behavior is now:

```text
                    Request
                       │
                       ▼
              Does key exist?
                 /          \
               No            Yes
               │              │
               ▼              ▼
          PROCESSING       Check status
               │           /          \
               │          /            \
               │    PROCESSING       COMPLETED
               │         │               │
               │         ▼               ▼
               │    Don't duplicate   Return result
               │
               ▼
           Process payment
               │
               ▼
           COMPLETED
               │
               ▼
          Store result
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

### 4. Reserve the operation before processing

The service must record:

```text
PROCESSING
```

before starting the side effect.

This prevents a concurrent retry from starting the same operation again.

---

### 5. Completed operations should return the stored result

Once the operation reaches:

```text
COMPLETED
```

a later request using the same idempotency key should return the original result rather than executing the side effect again.

---

### 6. Distributed systems need shared state

An in-memory `Map` works for this educational experiment, but production systems require shared durable state and atomic operations.

---

## What This Lab Demonstrates

This lab connects several distributed-systems concepts:

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
   │
   ▼
Shared Persistent State
```

The progression is important:

```text
Naive implementation
        │
        ▼
Race condition discovered
        │
        ▼
PROCESSING state introduced
        │
        ▼
Duplicate processing prevented
        │
        ▼
COMPLETED result reused
```

---

## Status

* [x] Demonstrate idempotency key
* [x] Demonstrate duplicate retry
* [x] Reproduce race condition
* [x] Prevent duplicate processing while request is `PROCESSING`
* [x] Store completed result
* [x] Return stored result for completed operation
* [ ] Explore database-backed idempotency

---

## Next Step

The current implementation uses an in-memory `Map`.

The next stage is to replace this with a **database-backed idempotency mechanism** and explore how a unique constraint and atomic database operation protect the system when multiple service instances are running.
