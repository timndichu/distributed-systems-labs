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


# Experiment 4 — Database-Backed Idempotency

The in-memory solution works within a single Node.js process, but it has an important limitation.

Imagine we have two payment service instances:

```text
                 ┌──────────────────────┐
                 │      Client          │
                 └──────────┬───────────┘
                            │
                 ┌──────────┴───────────┐
                 │                      │
                 ▼                      ▼
        Payment Service 1       Payment Service 2
             :3001                    :3002
                 │                      │
                 └──────────┬───────────┘
                            │
                            ▼
                     PostgreSQL
```

Each process has its own memory.

Therefore:

```text
Service 1
    |
    v
Map A

Service 2
    |
    v
Map B
```

Service 1 cannot see Service 2's `Map`.

We therefore need **shared state**.

---

## Database Schema

We created a PostgreSQL database:

```text
idempotency_lab
```

with the following table:

```sql
CREATE TABLE idempotency_keys (
    id SERIAL PRIMARY KEY,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL,
    result JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

The important part is:

```sql
idempotency_key VARCHAR(255) NOT NULL UNIQUE
```

This means PostgreSQL guarantees that two rows cannot have the same idempotency key.

---

## Atomic Claim

The payment service attempts to claim the idempotency key using:

```sql
INSERT INTO idempotency_keys (
    idempotency_key,
    status
)
VALUES ($1, 'PROCESSING')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;
```

This is important because the operation is atomic.

If the insert succeeds:

```text
rowCount === 1
```

This service successfully claimed the operation.

It can process the payment.

If the insert does not insert anything:

```text
rowCount === 0
```

the key already exists.

The service then checks the existing record.

---

## Why Not SELECT Then INSERT?

A tempting implementation would be:

```text
SELECT
  ↓
Does key exist?
  ↓
No
  ↓
INSERT
```

But two service instances could do this simultaneously:

```text
Service 1                 Service 2
    |                         |
    |------ SELECT ---------->|
    |                         |
    |<----- not found --------|
    |                         |
    |                    SELECT
    |                         |
    |                    not found
    |                         |
    |------ INSERT ---------->|
    |                    INSERT
```

Both services could believe they were allowed to process the payment.

Instead, we let PostgreSQL perform the uniqueness check atomically:

```text
Service 1 ─────┐
               │
               ▼
          PostgreSQL
          UNIQUE KEY
               ▲
               │
Service 2 ─────┘
```

Only one instance can successfully claim the key.

---

## Two-Instance Experiment

We started two copies of the payment service:

```text
Payment Service 1 → localhost:3001
Payment Service 2 → localhost:3002
```

Both received:

```text
Idempotency-Key: order-payment-123
```

The client intentionally sent both requests at almost the same time.

### One instance successfully claimed the key

```text
💰 payment-service-1
🔑 Idempotency-Key: order-payment-123

🔒 Idempotency key successfully claimed
📊 Status: PROCESSING
⏳ Processing payment...
```

### The second instance detected the existing operation

```text
💰 payment-service-2
🔑 Idempotency-Key: order-payment-123

♻️ Idempotency key already exists
📊 Existing status: PROCESSING
🚫 Payment already being processed
```

After processing completed:

```text
✅ Payment processed
💾 Result stored in database
📊 Status: COMPLETED
```

---

## Database Verification

We verified the result directly in PostgreSQL:

```sql
SELECT
    id,
    idempotency_key,
    status,
    result,
    created_at,
    updated_at
FROM idempotency_keys;
```

The database contained **one record** for:

```text
order-payment-123
```

with:

```text
status = COMPLETED
```

This proves that two independent service instances did not create two payment operations.

---

# The Evolution of the Solution

The lab progressed through three increasingly robust approaches:

### 1. Naive

```text
Check → Process → Store
```

Problem:

```text
Race condition
```

---

### 2. In-memory reservation

```text
Check → Reserve → Process → Complete
```

Problem:

```text
State exists only inside one process
```

Multiple service instances cannot share it.

---

### 3. Database-backed reservation

```text
Atomic INSERT
      ↓
   PROCESSING
      ↓
   Process
      ↓
   COMPLETED
      ↓
 Store result
```

The database becomes the shared source of truth.

```text
              PostgreSQL
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
   Service 1           Service 2
```

This allows independent service instances to coordinate.

---

# Correct Idempotency Model

A robust idempotent operation should conceptually maintain a state like:

```text
             ┌─────────────┐
             │   ABSENT    │
             └──────┬──────┘
                    │
                    │ claim key
                    ▼
             ┌─────────────┐
             │ PROCESSING  │
             └──────┬──────┘
                    │
                    │ payment succeeds
                    ▼
             ┌─────────────┐
             │  COMPLETED  │
             └─────────────┘
```

Repeated requests behave differently depending on the state:

```text
ABSENT
  → process request

PROCESSING
  → do not start another operation

COMPLETED
  → return stored result
```

---

# Why Shared State Matters in Distributed Systems

A major lesson from this experiment is that **local memory is not shared memory**.

With one process:

```text
Service
  |
  └── Map
```

the `Map` can work for demonstrating the concept.

With multiple instances:

```text
Service 1 ── Map A

Service 2 ── Map B
```

each instance has a different view of the world.

A shared database provides:

```text
Service 1 ──┐
            │
            ▼
        PostgreSQL
            ▲
            │
Service 2 ──┘
```

The database can therefore coordinate operations across instances.

---

# Key Takeaways

* A timeout does not necessarily cancel the downstream operation.
* Retrying a request can create duplicate side effects.
* An idempotency key gives repeated requests the same logical identity.
* Simply checking whether a key exists is not enough.
* The idempotency key must be reserved before processing begins.
* In-memory state works only within the process that owns it.
* Multiple service instances require shared state.
* PostgreSQL's `UNIQUE` constraint provides a strong primitive for preventing duplicate keys.
* `INSERT ... ON CONFLICT DO NOTHING` provides an atomic way to claim an idempotency key.
* The database can maintain the lifecycle of an operation:

```text
ABSENT → PROCESSING → COMPLETED
```

---

# Status

* [x] Demonstrate idempotency key
* [x] Demonstrate duplicate retry
* [x] Reproduce race condition
* [x] Prevent duplicate processing while `PROCESSING`
* [x] Store completed result
* [x] Return stored result for completed operation
* [x] Implement database-backed idempotency
* [x] Demonstrate shared state across multiple service instances
* [x] Use database uniqueness to prevent duplicate claims
* [ ] Explore failure handling for `PROCESSING` records
* [ ] Explore database-backed idempotency with transactions
* [ ] Explore what happens when the payment succeeds but the service crashes before marking the request `COMPLETED`

---

# Next Step

The next interesting problem is:

> **What happens if the payment succeeds, but the payment service crashes before updating the idempotency record to `COMPLETED`?**

This brings us to an important distributed-systems problem involving **ambiguous outcomes and recovery**.

We will explore that before moving on to the next major distributed-systems pattern.
