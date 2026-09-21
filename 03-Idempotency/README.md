# 03 — Idempotency

This experiment explores how to safely process retried operations without creating duplicate side effects.

The lab progressively evolves a payment-processing system from a naive implementation into a design that can:

* prevent duplicate processing,
* coordinate multiple service instances,
* survive service crashes,
* handle ambiguous outcomes,
* and reconcile local state with an external payment provider.

---

# Problem

Consider a payment request:

```text
POST /payments
Idempotency-Key: order-payment-123
```

The client sends the request.

The payment service begins processing.

The caller times out.

The client retries the same request.

The original request may still be running.

Without protection:

```text
Request #1
    ↓
Payment succeeds

Request #2
    ↓
Payment succeeds again
```

One logical operation can therefore produce multiple physical side effects.

---

# Experiment 1 — Naive Idempotency

The first implementation uses an in-memory `Map`:

```js
const processedPayments = new Map();
```

The service checks whether an idempotency key has already been processed.

If the key exists, the stored result is returned.

Otherwise, the payment is processed.

Conceptually:

```text
Request
  │
  ▼
Does key exist?
  │
  ├── YES → return previous result
  │
  └── NO  → process payment
```

This looks correct at first.

However, there is a race condition.

---

# Experiment 2 — Race Condition

The initial implementation stores the idempotency key only **after** processing completes.

The timeline becomes:

```text
Request #1
   │
   ├── key does not exist
   │
   ├── start processing
   │
   │
Request #2
   │
   ├── key does not exist
   │
   └── start processing
```

Both requests can therefore enter the payment-processing section before either request records the key.

Result:

```text
Request #1 → Payment A
Request #2 → Payment B
```

The idempotency check exists, but it is not sufficient.

---

# Experiment 3 — Reserve Before Processing

The next implementation reserves the key immediately.

```js
payments.set(idempotencyKey, {
  status: "PROCESSING",
});
```

The state machine becomes:

```text
             ┌──────────────┐
             │              │
             ▼              │
        PROCESSING          │
             │              │
             ▼              │
         COMPLETED          │
```

A second request now sees:

```text
PROCESSING
```

and does not start another payment.

The flow becomes:

```text
Request #1
    │
    ├── reserve key
    │
    └── PROCESSING
          │
          ▼
       payment


Request #2
    │
    └── sees PROCESSING
            │
            └── do not process again
```

This solves the race condition within a single process.

But another problem remains.

---

# The Shared-State Problem

An in-memory `Map` only exists inside one process.

Consider:

```text
                 ┌────────────────────┐
                 │      Database      │
                 └────────────────────┘
                       ▲        ▲
                       │        │
                       │        │
              ┌────────┘        └─────────┐
              │                           │
      ┌───────────────┐           ┌───────────────┐
      │ Payment       │           │ Payment       │
      │ Service #1    │           │ Service #2    │
      └───────────────┘           └───────────────┘
```

If each instance maintains its own `Map`, both instances can believe that a key is new.

For distributed coordination, the idempotency state needs to be shared.

---

# Experiment 4 — Database-Backed Idempotency

PostgreSQL is introduced as the shared source of truth.

The table:

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

The important constraint is:

```sql
UNIQUE (idempotency_key)
```

This allows the database itself to enforce uniqueness.

---

# Atomic Claim

The service attempts to claim an idempotency key using:

```sql
INSERT INTO idempotency_keys (
    idempotency_key,
    status
)
VALUES ($1, 'PROCESSING')
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;
```

The result determines ownership.

### Insert succeeds

The service successfully claimed the operation.

```text
INSERT
  ↓
row returned
  ↓
PROCESSING
  ↓
process payment
```

### Insert does not return a row

Another request already owns the key.

The service reads the existing state.

```text
INSERT
  ↓
conflict
  ↓
read existing record
```

Possible states:

```text
PROCESSING
COMPLETED
```

---

# Why Not SELECT Then INSERT?

A tempting implementation is:

```sql
SELECT *
FROM idempotency_keys
WHERE idempotency_key = $1;
```

Then:

```text
if not found:
    INSERT
```

But two instances can execute the SELECT at the same time:

```text
Instance A                 Instance B

SELECT → not found         SELECT → not found
     │                           │
     ▼                           ▼
INSERT                      INSERT
```

Both instances believe they can proceed.

The atomic `INSERT ... ON CONFLICT` approach moves the ownership decision into one database operation.

---

# Multiple Service Instances

The experiment runs two payment-service instances:

```text
Payment Service #1 → :3001
Payment Service #2 → :3002
```

Both share the same PostgreSQL database.

The same idempotency key is sent to both instances concurrently.

Expected behavior:

```text
                 ┌───────────────┐
                 │  PostgreSQL   │
                 └───────┬───────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
        Service #1             Service #2
              │                     │
              │ claim key           │
              │                     │
              ▼                     │
         PROCESSING                 │
                                    │
                             conflict detected
                                    │
                                    ▼
                              read PROCESSING
```

Only one instance processes the payment.

---

# Experiment 5 — Ambiguous Outcome

The database-backed design prevents duplicate processing while the operation is known to be in progress.

But there is a more difficult failure scenario.

Consider:

```text
INSERT idempotency key
        ↓
PROCESSING
        ↓
Call external payment provider
        ↓
Payment succeeds
        ↓
Service crashes
        ↓
UPDATE idempotency_keys → COMPLETED
        ↓
NEVER EXECUTES
```

The database now says:

```text
PROCESSING
```

But the external payment provider may say:

```text
PAYMENT SUCCESSFUL
```

The local system does not know the final outcome.

This is an **ambiguous outcome**.

---

# Why This Is Dangerous

Suppose the client retries.

The local database says:

```text
PROCESSING
```

A naive implementation might simply process the payment again.

That could produce:

```text
Original request → Payment A
Retry            → Payment B
```

The customer is charged twice.

But refusing to do anything creates another problem:

```text
PROCESSING
```

could remain forever even though the payment actually succeeded.

The system needs a way to determine what happened externally.

---

# Experiment 6 — Recovery and Reconciliation

A mock external payment provider is introduced.

The provider exposes:

```text
POST /payments
GET  /payments/status?idempotencyKey=...
```

The provider also maintains its own payment state.

The recovery flow becomes:

```text
Retry
  │
  ▼
Local database
  │
  ├── COMPLETED
  │      │
  │      └── return stored result
  │
  └── PROCESSING
          │
          ▼
   Query payment provider
          │
       ┌──┴──┐
       │     │
    FOUND   NOT FOUND
       │     │
       │     └── outcome still uncertain
       │
       ▼
Mark local record COMPLETED
       │
       ▼
Return original payment result
```

---

# Crash Simulation

The recovery experiment deliberately crashes the payment service after the external provider confirms payment but before the local database is updated.

The sequence is:

```text
Client
  │
  ▼
Payment Service
  │
  ├── INSERT → PROCESSING
  │
  ▼
Payment Provider
  │
  ├── payment succeeds
  │
  ▼
Payment Service
  │
  X CRASH
```

At this point:

```text
Local database:

idempotency_key = order-payment-123
status = PROCESSING
```

But the provider contains the successful payment.

---

# Recovery

The service is restarted.

The client retries using the same idempotency key.

The service finds:

```text
PROCESSING
```

Instead of blindly charging again, it asks the provider:

```text
Does a payment already exist
for order-payment-123?
```

The provider responds with the existing payment.

The local database is then updated:

```sql
UPDATE idempotency_keys
SET
    status = 'COMPLETED',
    result = $1,
    updated_at = CURRENT_TIMESTAMP
WHERE idempotency_key = $2;
```

The system has now reconciled its local state with the external system.

---

# What If the Provider Has No Payment?

This is the harder case.

Suppose the local database says:

```text
PROCESSING
```

and the provider says:

```text
No payment found
```

The system still needs to be careful.

The absence of a payment does not necessarily prove that the original operation failed.

The provider could itself be:

* temporarily unavailable,
* eventually consistent,
* processing the request asynchronously,
* or unable to answer reliably.

Therefore, the recovery process should not blindly create another payment unless the external system provides a safe way to determine that the original operation did not happen.

In this experiment, the service returns an uncertain state rather than creating a duplicate side effect.

---

# Complete Lifecycle

The complete idempotency lifecycle is now:

```text
                 Request
                    │
                    ▼
             Idempotency Key
                    │
                    ▼
          Atomic database claim
                    │
          ┌─────────┴─────────┐
          │                   │
        NEW                EXISTS
          │                   │
          ▼                   ▼
     PROCESSING          Check status
          │              │           │
          │         PROCESSING   COMPLETED
          │              │           │
          ▼              ▼           ▼
     External         Reconcile    Return
      payment          provider    stored result
          │
          ▼
       SUCCESS
          │
          ▼
      COMPLETED
          │
          ▼
     Store result
```

---

# Evolution of the Solution

The implementation evolved through several stages.

### 1. Naive implementation

```text
Check key
   ↓
Process payment
   ↓
Store result
```

Problem:

```text
Race condition
```

---

### 2. In-memory reservation

```text
Reserve key
   ↓
PROCESSING
   ↓
Process payment
   ↓
COMPLETED
```

Problem:

```text
State belongs to one process
```

---

### 3. Database-backed reservation

```text
Atomic INSERT
   ↓
Database owns coordination
   ↓
PROCESSING
   ↓
Process payment
   ↓
COMPLETED
```

Problem:

```text
Service can crash after external success
```

---

### 4. Recovery and reconciliation

```text
PROCESSING
   ↓
External operation may have succeeded
   ↓
Query external system
   ↓
Reconcile local state
   ↓
COMPLETED
```

This addresses the ambiguous outcome rather than assuming that the local database always knows the truth.

---

# Key Engineering Takeaways

### Idempotency is more than checking a key

The system must coordinate:

* ownership,
* processing state,
* completion state,
* stored results,
* retries,
* concurrency,
* failures,
* and recovery.

### Atomicity matters

The operation that claims the idempotency key must itself be safe against concurrent requests.

### Shared state matters

In-memory state is insufficient when multiple service instances need to coordinate.

### `PROCESSING` is a real state

An operation can be neither clearly successful nor clearly failed.

The system needs to represent that state explicitly.

### External systems can be the source of truth

When an external side effect has occurred, the local service may need to query the external system to determine what actually happened.

### Recovery is part of the design

A robust distributed system does not only define the happy path.

It defines what happens when the process crashes at the worst possible moment.

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
* [x] Simulate service crash during external payment processing
* [x] Demonstrate ambiguous outcome
* [x] Recover a successful external operation
* [x] Reconcile external payment state with local database state
* [ ] Explore failure handling for permanently stuck `PROCESSING` records
* [ ] Explore database-backed idempotency with transactions

---

# Next

The next experiments will build on these failure-handling concepts and explore additional distributed-systems problems.

The focus remains the same:

**Understand the failure → observe the behavior → design the mitigation → verify the result.**