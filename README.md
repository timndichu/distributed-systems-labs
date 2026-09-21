# Distributed Systems Labs

A collection of hands-on distributed-systems experiments focused on how real-world services behave under latency, failures, concurrency, retries, and partial system failure.

Rather than treating distributed systems as purely theoretical concepts, each lab builds a small working system, introduces a specific failure scenario, observes the resulting behavior, and evolves the design to handle it.

The emphasis is on understanding **why distributed systems fail and how to design around those failure modes**.

---

## Engineering Focus

The repository currently explores:

* Service-to-service communication
* Network timeouts
* Slow downstream dependencies
* Retry behavior
* Duplicate request processing
* Idempotency
* Race conditions
* Concurrent requests
* Shared state across service instances
* Database-backed coordination
* Atomic database operations
* Ambiguous outcomes
* Crash recovery
* Reconciliation with external systems

---

## Labs

| #  | Topic                            | Status       |
| -- | -------------------------------- | -------------|
| 01 | [Timeouts](./01-Timeouts/)       | ✅ Complete |
| 02 | [Retries](./02-Retries/)         | ✅ Complete |
| 03 | [Idempotency](./03-Idempotency/) | ✅ Complete |

More distributed-systems scenarios will be added as the repository evolves.

---

## Repository Structure

```text
distributed-systems-labs/
│
├── 01-timeouts/
│   ├── README.md
│   ├── client.js
│   ├── order-service.js
│   ├── payment-service.js
│   └── package.json
│
├── 02-retries/
│   ├── README.md
│   ├── client.js
│   ├── order-service.js
│   ├── payment-service.js
│   └── package.json
│
├── 03-Idempotency/
│   ├── README.md
│   │
│   ├── 01-naive/
│   │   ├── client.js
│   │   └── payment-service.js
│   │
│   ├── 02-race-condition-fixed/
│   │   ├── client.js
│   │   └── payment-service.js
│   │
│   └── 03-database/
│       ├── client.js
│       ├── db.js
│       ├── payment-provider.js
│       ├── payment-service.js
│       ├── payment-service-2.js
│       ├── payment-service-recovery.js
│       ├── test-db.js
│       └── package.json
│
└── README.md
```

---

## Engineering Approach

Each lab follows a similar progression:

```text
Normal operation
       ↓
Introduce failure
       ↓
Observe system behavior
       ↓
Identify the failure mode
       ↓
Design a mitigation
       ↓
Implement the mitigation
       ↓
Test under failure conditions
       ↓
Document the trade-offs
```

This approach is intentional.

In distributed systems, understanding the happy path is only part of the problem. The more interesting questions often begin when something goes wrong.

For example:

* What happens when a downstream service is slow?
* What happens when the caller times out but the downstream operation continues?
* What happens when a retry reaches the server after the original request has already succeeded?
* What happens when two service instances process the same request concurrently?
* What happens when a service crashes after an external operation succeeds but before local state is updated?

The labs are designed around these questions.

---

## Technologies

The experiments primarily use lightweight technologies so that the distributed-systems behavior remains visible rather than being hidden behind large frameworks.

Current technologies include:

* Node.js
* HTTP
* PostgreSQL
* SQL
* JavaScript
* `pg`
* `dotenv`

The intention is to keep infrastructure simple enough to focus on the underlying distributed-systems behavior.

---

## Key Principle

A distributed system should not be designed around the assumption that everything will work.

It should be designed around the possibility that:

```text
Requests can be delayed.
Requests can be duplicated.
Services can fail.
Dependencies can fail.
Networks can fail.
Processes can crash.
Operations can succeed without the caller knowing.
Multiple instances can act concurrently.
```

The experiments in this repository explore those situations in progressively more realistic ways.

---

## Status

### Completed

* [x] Service-to-service communication
* [x] Timeout behavior
* [x] Retry behavior
* [x] Duplicate processing
* [x] Idempotency keys
* [x] Race-condition reproduction
* [x] In-memory idempotency protection
* [x] Database-backed idempotency
* [x] Atomic database claims
* [x] Multiple service instances
* [x] Ambiguous outcomes
* [x] Crash recovery
* [x] External-state reconciliation

### Planned

* [ ] Permanently stuck `PROCESSING` records
* [ ] Database transactions and failure boundaries
* [ ] Additional distributed-systems failure scenarios

---

## Why This Repository Exists

The goal is to turn distributed-systems concepts into observable engineering behavior.

Each experiment is intentionally small, but the problems being explored are the same classes of problems that appear in larger production systems:

**latency, failure, concurrency, retries, consistency, and recovery.**