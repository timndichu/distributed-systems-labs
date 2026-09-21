# 02 — Retries

This experiment explores what happens when a service retries a request after a timeout.

Retries are a common reliability mechanism in distributed systems, but they introduce a critical problem:

> The original request may still be executing.

---

## Scenario

The system contains:

```text
Client
  │
  ▼
Order Service
  │
  ▼
Payment Service
```

The payment service takes **5 seconds** to process a payment.

The order service waits only **2 seconds** before timing out.

When the request times out, the order service retries the payment request.

---

## Request Flow

```text
First request
─────────────

Order Service
     │
     │ Payment Request #1
     ▼
Payment Service
     │
     │ processing...
     │
     │
     X timeout after 2s
     │
     │
     ▼
Order Service retries


Second request
──────────────

Order Service
     │
     │ Payment Request #2
     ▼
Payment Service
```

The important detail is that **Request #1 may still be running when Request #2 arrives**.

---

## Observed Behavior

The payment service processes both requests.

```text
Payment Request #1
        │
        └── Payment created

Payment Request #2
        │
        └── Payment created
```

The result can therefore be:

```text
One intended payment
        ↓
Two payment operations
```

This demonstrates why retries cannot safely be treated as:

```text
request failed → send it again
```

---

## Why the Duplicate Happens

The timeout only tells the order service:

> "I did not receive a response within the configured time."

It does **not** prove:

> "The payment service did not process the request."

The original request could be in any of these states:

```text
Request
  │
  ├── Never reached server
  │
  ├── Reached server but has not started
  │
  ├── Still processing
  │
  ├── Successfully completed
  │
  └── Failed
```

The caller does not necessarily know which state applies.

This is an **ambiguous outcome**.

---

## Experiment

The experiment intentionally creates this sequence:

```text
Payment request
      ↓
Payment service starts processing
      ↓
Order service times out
      ↓
Order service retries
      ↓
Payment service receives second request
      ↓
Both requests complete
```

The payment service therefore produces two payment results.

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

Then run:

```bash
node client.js
```

Observe the logs from the payment service.

You should see both payment requests being processed.

---

## Architecture

```text
                  ┌──────────────────┐
                  │     Client       │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │  Order Service   │
                  │                  │
                  │ timeout: 2s      │
                  │ retry: 1         │
                  └────────┬─────────┘
                           │
                    ┌──────┴──────┐
                    │             │
                    ▼             ▼
               Request #1     Request #2
                    │             │
                    └──────┬──────┘
                           ▼
                  ┌──────────────────┐
                  │ Payment Service  │
                  │                  │
                  │ processing: 5s  │
                  └──────────────────┘
```

---

## Engineering Implications

Retries can improve reliability when failures are transient.

However, retries can also amplify failures.

For example:

```text
Service becomes slow
       ↓
Requests timeout
       ↓
Clients retry
       ↓
Request volume increases
       ↓
Service becomes even slower
       ↓
More timeouts
       ↓
More retries
```

This can contribute to a **retry storm**.

Retries therefore need to be designed deliberately.

Typical considerations include:

* Retry limits
* Backoff
* Jitter
* Which errors are safe to retry
* Idempotency
* Request deadlines

---

## Key Takeaway

A retry answers:

> "What should we do when we don't receive a response?"

But it creates another question:

> "How do we know whether the original operation already happened?"

That question leads directly to **idempotency**.

---

## Next Experiment

**03 — Idempotency**

The next lab explores how to safely retry operations without creating duplicate side effects.