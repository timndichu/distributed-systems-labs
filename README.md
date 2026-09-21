# Distributed Systems Labs

A collection of small, practical experiments designed to explore distributed systems concepts through runnable code.

The goal is to move beyond theoretical understanding by building small systems, introducing realistic failure scenarios, observing their behavior, and documenting the engineering trade-offs.

## Labs

| #  | Topic                            | Status        |
| -- | ------------------------------   | ------------- |
| 01 | [Timeouts](./01-Timeouts/)       | ✅ Complete  |
| 02 | [Retries](./02-Retries/)         | ✅ Complete  |
| 03 | [Idempotency](./03-Idempotency/) | ✅ Complete  |

More labs will be added as I progress through distributed systems and system design topics.

## Approach

Each lab focuses on a specific distributed-systems problem and follows a practical approach:

1. Understand the concept
2. Build a minimal implementation
3. Introduce a failure scenario
4. Observe the system behavior
5. Improve the design
6. Document the lessons learned

## Repository Structure

```text
## Repository Structure

```text
distributed-systems-labs/
│
├── 01-Timeouts/
│   ├── README.md
│   ├── client.js
│   ├── order-service.js
│   ├── payment-service.js
│   └── package.json
│
├── 02-Retries/
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
|   |   ├── order-service.js
│   │   └── payment-service.js
│   │
│   ├── 02-race-condition-fixed/
│   │   ├── client.js
|   |   ├── order-service.js
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

## Concepts

The labs will explore concepts such as:

* Timeouts
* Retries
* Idempotency
* Circuit breakers
* Rate limiting
* Caching
* Message queues
* Event-driven architecture
* Distributed locking
* Database replication
* Consistency
* Partitioning
* Kafka
* Failure handling
* Observability
* And other system-design concepts

## Why This Repository?

Distributed systems are difficult to understand purely from diagrams and definitions.

These labs are experiments intended to make the behavior of distributed systems observable.

Instead of simply learning that:

> "Timeouts can lead to retries and duplicate processing"

I want to be able to demonstrate the behavior with a running system.

## Author

Timothy Ndichu

Software Engineer | T24 Consultant | Full-Stack Developer

This repository is part of my ongoing practical study of system design and distributed systems.