# Distributed Systems Labs

A collection of hands-on experiments for understanding how distributed systems behave under **latency, failures, concurrency, retries, partial failure, and ambiguous outcomes**.

Rather than treating distributed systems as purely theoretical concepts, each lab builds a small working system, introduces a specific failure scenario, observes the resulting behavior, and evolves the design to handle it.

The emphasis is on understanding:

> **Why distributed systems fail, what makes those failures difficult, and how to design systems that remain safe and resilient when they happen.**

---

## Labs

| #  | Topic                                    | Status         |
| -- | ---------------------------------------- | ---------------|
| 01 | [Timeouts](./01-Timeouts/)               | ✅ Complete    |
| 02 | [Retries](./02-Retries/)                 | ✅ Complete    |
| 03 | [Idempotency](./03-Idempotency/)         | ✅ Complete    |
| 04 | [Circuit-Breaker](./04-Circuit-Breaker/) | ✅ Complete    |

More distributed-systems scenarios will be added as the repository evolves.

---

## Engineering Focus

The repository currently explores several recurring distributed-systems problems:

### Communication & Latency

- Service-to-service communication
- Network timeouts
- Slow downstream dependencies
- Partial system failure

### Retries & Duplicate Processing

- Retry behavior
- Duplicate requests
- Idempotency
- Idempotency keys
- Ambiguous outcomes

### Concurrency & Coordination

- Race conditions
- Concurrent requests
- Multiple service instances
- Shared state across instances
- Database-backed coordination
- Atomic database operations

### Failure & Recovery

- Process crashes
- Crash recovery
- External operations succeeding before local state is updated
- Reconciliation with external systems
- Circuit Breakers
- Dependency degradation

These are not isolated concepts. In real systems they interact.

For example:

```text
Slow dependency
      |
      v
Timeout
      |
      v
Retry
      |
      v
More traffic
      |
      v
Dependency becomes less healthy
      |
      v
Circuit Breaker
      |
      v
Fail fast
````

And when the operation being retried has side effects:

```text
Retry
  |
  v
Duplicate request
  |
  v
Idempotency
```

The labs progressively explore these interactions.

---

# Repository Structure

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
├── 04-Circuit-Breaker/
│   ├── README.md
│   │
│   ├── circuit-breaker-demo/
│   │   ├── src/
│   │   ├── pom.xml
│   │   └── ...
│   │
│   └── resilience4j-demo/
│       ├── src/
│       ├── slow-call/
│       │   └── Slow-Call-Detection.md
│       ├── pom.xml
│       └── ...
│
└── README.md
```

Each lab has its own README containing the detailed concepts, experiments, implementation notes, and observations.

---

# Engineering Approach

Every lab follows a similar progression:

```text
Understand the problem
        |
        v
Build the simplest version
        |
        v
Introduce a failure
        |
        v
Observe the behavior
        |
        v
Identify the failure mode
        |
        v
Design a mitigation
        |
        v
Implement the mitigation
        |
        v
Break the mitigation
        |
        v
Improve the design
        |
        v
Document the trade-offs
```

This approach is intentional.

In distributed systems, understanding the happy path is only part of the problem.

The more interesting questions often begin when something goes wrong.

For example:

* What happens when a downstream service is slow?
* What happens when the caller times out but the downstream operation continues?
* What happens when a retry reaches the server after the original request has already succeeded?
* What happens when two service instances process the same request concurrently?
* What happens when a service crashes after an external operation succeeds but before local state is updated?
* What happens when a dependency is technically successful but consistently too slow?
* What happens when a recovery mechanism itself has a concurrency bug?

The labs are designed around these questions.

---

# Lab Progression

The repository is intentionally evolving from simpler failure modes toward more complex distributed behavior.

```text
                    Distributed Systems
                           |
                           v
                    Service Communication
                           |
                           v
                        Timeout
                           |
                           v
                         Retry
                           |
                           v
                      Idempotency
                           |
                           v
                    Concurrent Requests
                           |
                           v
                  Database Coordination
                           |
                           v
                    Circuit Breaker
                           |
                           v
              Combined Resilience Patterns
```

The important part is that each topic builds on previous concepts.

For example:

### Timeout

Answers:

> How long should I wait?

### Retry

Answers:

> Should I try the operation again?

### Idempotency

Answers:

> What happens if that operation is performed more than once?

### Circuit Breaker

Answers:

> What should happen when a dependency is repeatedly failing or becoming unhealthy?

Together, these begin forming a more complete resilience strategy.

---

# Technologies

The experiments intentionally use relatively lightweight technologies so that the distributed-systems behavior remains visible rather than being hidden behind large frameworks.

Current technologies include:

### Node.js Labs

* Node.js
* JavaScript
* HTTP
* PostgreSQL
* SQL
* `pg`
* `dotenv`

### Java Labs

* Java 21 LTS
* Spring Boot
* Maven
* Spring Web
* Resilience4j

The choice of technology is secondary to the concepts being explored.

The goal is to understand the behavior first and then see how production technologies implement those concepts.

---

# Key Engineering Principles

Several principles appear repeatedly throughout the repository.

## 1. The network is not reliable

Requests can be:

```text
Delayed
Dropped
Duplicated
Timed out
```

A timeout does not necessarily mean that the operation did not happen.

---

## 2. A failure does not always mean the operation did not succeed

Consider:

```text
Client
  |
  | request
  v
Payment Service
  |
  | SUCCESS
  v
Payment completed

        X

Response lost
```

The client may see:

```text
TIMEOUT
```

while the payment actually succeeded.

This creates an **ambiguous outcome**.

---

## 3. Retries can create more failures

Retries are useful for transient failures, but they also create additional traffic.

```text
Request
   |
   X
   |
 Retry
   |
   X
   |
 Retry
   |
   X
```

If many clients do this simultaneously:

```text
Failure
   |
   v
Retries
   |
   v
More traffic
   |
   v
More load
   |
   v
More failures
```

Retries therefore need to be designed carefully.

---

## 4. Concurrency changes the problem

Code that works correctly for one request may fail under concurrent requests.

For example:

```text
Request A ──┐
            |
Request B ──┼──> Shared state
            |
Request C ──┘
```

Without proper coordination, multiple requests can observe the same state and perform the same operation.

This is why several labs deliberately introduce concurrent requests.

---

## 5. Local state is not the whole system

A service may maintain local state while another system maintains external state.

For example:

```text
Order Service
     |
     v
Payment Provider
```

A crash between those operations can leave the systems temporarily inconsistent.

That leads to questions around:

* crash recovery
* reconciliation
* retries
* idempotency
* database coordination

---

## 6. Protection mechanisms also have failure modes

A particularly important lesson from the Circuit Breaker lab was that the protection mechanism itself must be correct.

For example, a naive HALF-OPEN implementation allowed multiple concurrent requests through:

```text
OPEN
  |
  v
HALF_OPEN
  |
  +---- Request A ----> Payment
  +---- Request B ----> Payment
  +---- Request C ----> Payment
  +---- Request D ----> Payment
```

The implementation itself had a concurrency problem.

After fixing it:

```text
OPEN
  |
  v
HALF_OPEN
  |
  +---- one probe ----> Payment
  |
  +---- other requests --> rejected
```

This is one of the reasons the labs intentionally include experiments that **break the solution after it appears to work**.

---

# Current Status

## Completed

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
* [x] Circuit Breaker state machine
* [x] Circuit Breaker fail-fast behavior
* [x] HALF-OPEN concurrency control
* [x] Sliding-window failure rates
* [x] Resilience4j Circuit Breaker
* [x] Slow-call detection

## Next

The next stage is to combine the individual resilience patterns rather than studying them only in isolation.

Planned areas include:

* [ ] Combining Timeout + Retry + Idempotency + Circuit Breaker
* [ ] Understanding interaction between retries and Circuit Breakers
* [ ] Exploring retry amplification
* [ ] Exploring database transactions and failure boundaries
* [ ] Handling permanently stuck `PROCESSING` records
* [ ] Additional distributed-systems failure scenarios

The roadmap will evolve as new experiments are added.

---

# Why This Repository Exists

The goal is to turn distributed-systems concepts into **observable engineering behavior**.

Instead of simply reading:

> "Retries can cause duplicate operations."

we reproduce the duplicate.

Instead of simply reading:

> "Concurrent requests can create race conditions."

we create the race.

Instead of simply reading:

> "Circuit Breakers prevent calls to unhealthy dependencies."

we build one, break its HALF-OPEN behavior, fix the concurrency problem, and then compare it with Resilience4j.

Each experiment is intentionally small, but the problems being explored are the same classes of problems that appear in larger production systems:

**latency, failure, concurrency, retries, consistency, and recovery.**

The objective is not to memorize patterns.

It is to develop the ability to reason about what happens when a distributed system does **not** behave as expected.