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
                      │       Request #2
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
          PROCESSING      Check status
               │          /          \
               │         /            \
               │    PROCESSING       COMPLETED
               │         │               │
               │         ▼               ▼
               │   Don't duplicate   Return result
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

# Experiment 4 — Database-Backed Idempotency

The in-memory solution works within a single Node.js process, but it has an important limitation.

Imagine we have two payment service instances:

```text
                 ┌──────────────────────┐
                 │       Client         │
                 └──────────┬───────────┘
                            │
                 ┌──────────┴───────────┐
                 │                      │
                 ▼                      ▼
       Payment Service 1      Payment Service 2
            :3001                   :3002
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
    |                      SELECT
    |                         |
    |                      not found
    |                         |
    |------ INSERT ---------->|
    |                     INSERT
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

# Experiment 5 — Ambiguous Outcome

The database-backed implementation solves duplicate claims, but another problem remains.

Consider this sequence:

```text
INSERT idempotency key
        ↓
     PROCESSING
        ↓
Call payment provider
        ↓
Payment succeeds
        ↓
💥 Service crashes
        ↓
UPDATE idempotency key to COMPLETED
never happens
```

After the service crashes, our database still says:

```text
PROCESSING
```

But the external payment provider may already have successfully processed the payment.

This creates an **ambiguous outcome**.

Our service knows:

```text
"The operation was started."
```

but it does not know whether the external side effect completed before the crash.

---

## Why This Is Dangerous

Suppose the service simply retries the payment:

```text
PROCESSING
    ↓
Retry payment
    ↓
Payment provider
    ↓
💰 Payment succeeds AGAIN
```

We could charge the customer twice.

But if we refuse to retry forever:

```text
PROCESSING
    ↓
Do nothing
```

the customer may have already paid while our system never records the successful result.

We therefore need a way to determine what actually happened.

---

# Experiment 6 — Recovery and Reconciliation

To demonstrate this, the lab introduced a mock payment provider.

The architecture becomes:

```text
                       Client
                         │
                         ▼
                ┌─────────────────┐
                │ Payment Service │
                │     :3001       │
                └───────┬─────────┘
                        │
               ┌────────┴────────┐
               │                 │
               ▼                 ▼
        ┌─────────────┐   ┌─────────────────┐
        │ PostgreSQL  │   │ Payment Provider│
        │             │   │     :4000       │
        └─────────────┘   └─────────────────┘
```

The two systems answer different questions:

```text
Our database:

"What does our service believe happened?"
```

The payment provider answers:

```text
"What actually happened to the payment?"
```

---

## Simulating the Crash

The recovery experiment deliberately crashes the payment service after the provider successfully processes the payment but before the service updates PostgreSQL.

The flow is:

```text
Client
  │
  ▼
Payment Service
  │
  ├── INSERT PROCESSING
  │
  ▼
Payment Provider
  │
  ├── Process payment
  │
  ├── Store payment
  │
  └── Return success
  │
  ▼
💥 Payment Service crashes
```

The PostgreSQL record is left as:

```text
idempotency_key    status
---------------------------
order-payment-123  PROCESSING
```

while the provider already contains:

```text
order-payment-123
        │
        ▼
provider-payment-...
        │
        ▼
SUCCESS
```

This is the ambiguous state.

---

## Recovery

After restarting the payment service, the same idempotency key is submitted again.

The service finds:

```text
Status: PROCESSING
```

Instead of immediately creating another payment, it asks the provider for the status of the existing operation.

```text
Payment Service
       │
       │ "What happened to
       │  order-payment-123?"
       ▼
Payment Provider
       │
       │ Payment exists
       ▼
Payment Service
       │
       ▼
UPDATE idempotency_keys
SET status = 'COMPLETED'
```

The service can then safely return the provider's original payment result.

---

## Recovery Result

The important behavior is:

```text
Existing idempotency record found

Status: PROCESSING

🔎 Checking payment provider...

💳 Payment exists at provider

✅ Payment recovered

💾 Idempotency record updated

📊 Status: COMPLETED
```

The payment was **not processed a second time**.

The existing external result was recovered and used to complete our local record.

---

# Reconciliation

This process is an example of **reconciliation**.

Instead of assuming that our local database contains the complete truth, the service compares its state with the external system:

```text
              Local State
                   │
                   │
                   ▼
             PROCESSING
                   │
                   │
            Query provider
                   │
                   ▼
          External State
                   │
                   ▼
             PAYMENT EXISTS
                   │
                   ▼
              COMPLETED
```

This is an important distributed-systems pattern because failures can happen between two systems.

There is no single atomic operation covering:

```text
Our PostgreSQL database
        +
External payment provider
```

Therefore, the systems can temporarily disagree.

---

# What If the Provider Has No Payment?

The recovery process also needs to handle the opposite situation.

Suppose our database says:

```text
PROCESSING
```

and the provider says:

```text
Payment not found
```

We cannot automatically conclude that the payment definitely failed.

The external request could still be in progress, or the provider could have lost or delayed the status information.

For this educational implementation, the service returns:

```text
409 Conflict

Payment outcome is still uncertain
```

The important lesson is that **uncertainty itself is a state that needs to be handled**.

A production payment system may use additional mechanisms such as provider webhooks, status APIs, reconciliation jobs, transaction records, or manual review depending on the payment provider.

---

# Important Distributed Systems Lesson

The complete problem is larger than simply preventing duplicate requests.

We started with:

```text
Retry
  ↓
Duplicate side effect
```

and solved it with:

```text
Idempotency
```

But then we discovered another failure window:

```text
Payment succeeds
       ↓
Service crashes
       ↓
Local state remains PROCESSING
```

This means a robust distributed system needs to consider both:

```text
Duplicate processing
        AND
Unknown processing outcome
```

Idempotency protects against duplicate execution.

Reconciliation helps recover when the outcome of an external operation is uncertain.

---

# Complete Idempotency Lifecycle

The lab now demonstrates a more realistic lifecycle:

```text
                    ABSENT
                       │
                       │ claim
                       ▼
                 PROCESSING
                  /        \
                 /          \
                /            \
        provider             provider
         succeeds             outcome
            │                  uncertain
            ▼
        COMPLETED              │
            │                  │
            │                  ▼
            │             Reconciliation
            │                  │
            │           ┌──────┴──────┐
            │           │             │
            │       payment exists   unknown
            │           │             │
            │           ▼             ▼
            │       COMPLETED      remain
            │                        uncertain
            ▼
      Return stored result
```

---

# The Evolution of the Solution

The lab has now progressed through four major stages:

### 1. Naive idempotency

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
```

Problem:

```text
What if the external operation succeeds
but the service crashes before COMPLETED?
```

---

### 4. Recovery / reconciliation

```text
Atomic INSERT
      ↓
PROCESSING
      ↓
Call external system
      ↓
External operation succeeds
      ↓
Service crashes
      ↓
Restart
      ↓
Check external system
      ↓
Recover result
      ↓
COMPLETED
```

This is the point where idempotency becomes more than simply "don't process twice."

It becomes a mechanism for **tracking the lifecycle of a distributed operation and recovering from failures**.

---

# Key Takeaways

### 1. Retries can duplicate side effects

A timeout does not necessarily mean the downstream operation failed.

The operation may still be executing.

### 2. An idempotency key identifies a logical operation

Both requests can have:

```text
Idempotency-Key: order-payment-123
```

even though they are separate HTTP requests.

The service uses the key to recognize that they represent the same logical operation.

### 3. Storing the result only after completion is insufficient

This creates a window where multiple requests can begin processing the same operation.

### 4. Reserve the operation before processing

The service must record:

```text
PROCESSING
```

before starting the side effect.

This prevents a concurrent retry from starting the same operation again.

### 5. Completed operations should return the stored result

Once the operation reaches:

```text
COMPLETED
```

a later request using the same idempotency key should return the original result rather than executing the side effect again.

### 6. Distributed systems need shared state

An in-memory `Map` works for this educational experiment, but production systems require shared durable state and atomic operations.

### 7. Atomic database operations matter

A pattern such as:

```sql
INSERT ... ON CONFLICT DO NOTHING
```

allows the database to decide which request successfully claims the operation.

### 8. Local state and external state can disagree

Our database may say:

```text
PROCESSING
```

while an external payment provider has already processed the payment.

### 9. A service crash can create an ambiguous outcome

There can be a failure window between:

```text
External operation succeeds
```

and:

```text
Local database updated to COMPLETED
```

### 10. Recovery may require reconciliation

When the outcome is uncertain, the service can query the external system and reconcile its local state with the external result.

---

# What This Lab Demonstrates

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
   │
   ▼
Ambiguous Outcome
   │
   ▼
Recovery / Reconciliation
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
        │
        ▼
Shared database introduced
        │
        ▼
Failure during external operation
        │
        ▼
Ambiguous outcome discovered
        │
        ▼
External state reconciliation
```

---

# Status

* [x] Demonstrate idempotency key
* [x] Demonstrate duplicate retry
* [x] Reproduce race condition
* [x] Prevent duplicate processing while request is `PROCESSING`
* [x] Store completed result
* [x] Return stored result for completed operation
* [x] Implement database-backed idempotency
* [x] Demonstrate shared state across multiple service instances
* [x] Use database uniqueness to prevent duplicate claims
* [x] Simulate service crash during external payment processing
* [x] Demonstrate ambiguous outcome
* [x] Recover a successful external operation
* [x] Reconcile external payment state with local database state
* [ ] Explore failure handling for permanently stuck `PROCESSING` records
* [ ] Explore database-backed idempotency with transactions

---

# Next Step

The idempotency lab is now complete enough to demonstrate the core problem and several progressively stronger solutions.

The next distributed-systems concept can build on what we have learned here rather than adding more complexity to idempotency.

```text
Timeouts
   ↓
Retries
   ↓
Idempotency
   ↓
?
```
