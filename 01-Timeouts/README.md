# Lab 01 — Timeouts

## What is a Timeout
A timeout is a mechanism that allows a system to specify a maximum amount of time to wait for an operation to complete. If the operation does not complete within the specified time, the system will terminate the operation and return an error or take alternative action.


## Overview

This experiment demonstrates how a timeout behaves in a distributed system when a downstream service takes longer to respond than the caller is willing to wait.

The key idea is:

> A timeout means the caller has stopped waiting. It does not necessarily mean the downstream operation stopped executing.

---

## Architecture

The experiment consists of three components:

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

| Service         |   Port | Purpose                            |
| --------------- | -----: | ---------------------------------- |
| Client          |      — | Initiates an order                 |
| Order Service   | `3000` | Calls the Payment Service          |
| Payment Service | `3001` | Simulates a slow payment operation |

---

## Scenario

The Order Service sends a payment request to the Payment Service.

The Payment Service intentionally takes **5 seconds** to process the request.

The Order Service has a **2-second timeout**.

Therefore:

```text
Payment processing time = 5 seconds
Order Service timeout   = 2 seconds
```

The Order Service will stop waiting after 2 seconds.

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

### Order Service

The Order Service receives the request and sends a payment request downstream:

```text
📦 Order received
⏰ PAYMENT REQUEST TIMED OUT
```

The timeout occurs after approximately 2 seconds.

The client receives:

```json
{
  "success": false,
  "message": "Payment service timed out"
}
```

### Payment Service

However, the Payment Service continues processing the request:

```text
💰 Payment request received
⏳ Processing payment...
```

After approximately 5 seconds:

```text
✅ Payment processed
```

This demonstrates that the timeout at the caller does not necessarily stop the work being performed by the downstream service.

---

## Timeline

```text
Time
 │
0s ── Client sends order
 │
 ├──── Order Service sends payment request
 │
 ├──── Payment Service starts processing
 │
 │
2s ── Order Service timeout
 │
 ├──── Order Service stops waiting
 │
 └──── Client receives 504 response
 │
 │
 │    Payment Service is still processing
 │
 │
5s ── Payment Service completes payment
 │
 ▼
```

---

## Important Observation

The system can reach an ambiguous state:

```text
                 Did the payment succeed?
                          ?
                         / \
                       YES  NO
```

The Order Service knows only that it **did not receive a response within its timeout window**.

It does not necessarily know whether:

* the Payment Service never received the request;
* the Payment Service received the request but has not finished;
* the Payment Service completed the operation but the response was delayed;
* the Payment Service completed the operation but the response was lost.

Therefore:

> A timeout should not automatically be interpreted as a failed operation.

---

## Why Timeouts Matter

Without timeouts, a service could wait indefinitely for a dependency:

```text
Request 1 → waiting...
Request 2 → waiting...
Request 3 → waiting...
Request 4 → waiting...
...
Request N → waiting...
```

As more requests become blocked, the service can consume resources such as:

* threads
* connections
* memory
* connection-pool slots

Eventually, the calling service can become unhealthy even though the original problem occurred in a downstream dependency.

Timeouts establish a boundary on how long a caller is willing to wait.

---

## What This Experiment Does Not Solve

This experiment intentionally leaves an important problem unresolved.

If the Order Service times out and the client tries the operation again, the original request may already have been processed.

For example:

```text
Request #1
    │
    ▼
Payment Service
    │
    ├── Payment succeeds
    │
    └── Response not received by caller

Caller times out

Request #2
    │
    ▼
Payment Service
    │
    └── Payment succeeds again
```

This can result in duplicate processing.

Handling this scenario requires additional mechanisms such as:

* retries
* idempotency
* request identifiers
* deduplication

These topics are explored in subsequent labs.

---

## Key Takeaways

1. **A timeout limits how long a caller waits for a response.**

2. **A timeout does not necessarily cancel the downstream operation.**

3. **The caller may not know whether the operation actually succeeded.**

4. **Timeouts protect services from waiting indefinitely on slow dependencies.**

5. **Timeouts can create ambiguous outcomes that require careful handling when retries are introduced.**

---

## Experiment Summary

```text
Downstream processing time: 5 seconds
Caller timeout:             2 seconds

Result:

Caller:
    TIMEOUT ❌

Downstream:
    OPERATION COMPLETED ✅

System state:
    OUTCOME UNKNOWN TO CALLER ⚠️
```

This ambiguity is one of the fundamental challenges of building reliable distributed systems.
