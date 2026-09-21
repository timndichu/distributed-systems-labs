# Lab 01 — Timeouts

## What is a Timeout
A timeout is a mechanism that allows a system to specify a maximum amount of time to wait for an operation to complete. If the operation does not complete within the specified time, the system will terminate the operation and return an error or take alternative action.


# 01 — Timeouts

This experiment demonstrates how a timeout behaves when one service depends on a slow downstream service.

The focus is not simply on implementing a timeout, but on understanding what a timeout actually means in a distributed system.

---

## Scenario

The system contains three components:

```text
Client
  │
  ▼
Order Service
  │
  ▼
Payment Service
```

The `Payment Service` intentionally takes **5 seconds** to respond.

The `Order Service` has a **2-second timeout** when calling the payment service.

---

## Expected Behavior

The request flow is:

```text
Client
  │
  │ POST /orders
  ▼
Order Service
  │
  │ POST /payments
  │
  │ timeout = 2s
  ▼
Payment Service
  │
  │ processing...
  │
  │ 5 seconds
  │
  X
```

After approximately two seconds, the order service gives up waiting for the payment service.

The client therefore receives a failure response instead of waiting the full five seconds.

---

## The Important Observation

A timeout does **not necessarily cancel the downstream operation**.

This is the key behavior demonstrated by the experiment.

```text
Order Service
      │
      │ request
      ▼
Payment Service
      │
      │ still processing
      │
      │
      X Order Service times out
      │
      ▼
Client receives 504

Payment Service may still finish
the original operation.
```

This creates an important distributed-systems problem:

> The caller has stopped waiting, but the operation may still be executing.

---

## Why This Matters

Consider a real payment request.

The client sends:

```text
Pay KES 10,000
```

The payment service receives the request and starts processing it.

The caller times out.

From the caller's perspective:

```text
"Payment failed."
```

But from the payment service's perspective:

```text
"Payment is still processing."
```

The two systems now have different views of the operation.

This is one of the reasons timeout handling cannot be treated as simply:

```text
timeout = failure
```

---

## Running the Experiment

Install dependencies:

```bash
npm install
```

Start the payment service:

```bash
node payment-service.js
```

Start the order service:

```bash
node order-service.js
```

Then run the client:

```bash
node client.js
```

The order service should time out while the payment service continues processing.

---

## Architecture

```text
┌──────────┐
│  Client  │
└────┬─────┘
     │
     │ HTTP
     ▼
┌───────────────┐
│ Order Service │
│               │
│ timeout: 2s   │
└───────┬───────┘
        │
        │ HTTP
        ▼
┌──────────────────┐
│ Payment Service  │
│                  │
│ processing: 5s   │
└──────────────────┘
```

---

## Key Takeaways

### 1. Timeouts protect the caller

Without a timeout, a slow dependency can cause the caller to wait indefinitely.

### 2. Timeouts do not guarantee cancellation

The downstream service may continue processing after the caller stops waiting.

### 3. Timeout does not always mean failure

The caller often cannot immediately determine whether the operation:

* never started,
* is still running,
* completed successfully,
* or completed unsuccessfully.

### 4. Timeouts create the conditions for retries

Once a request times out, a common next step is to retry it.

That introduces another problem:

```text
Timeout
   ↓
Retry
   ↓
Could the original request still be running?
```

This question leads directly into the next experiment.

---

## Next Experiment

**[02 — Retries](../02-Retries/)**

The next lab explores what happens when a client retries a request after a timeout while the original request may still be executing.