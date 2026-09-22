# Circuit Breaker Lab — Version 3

## Overview

This lab explores the **Circuit Breaker pattern** from first principles.

The goal was not to start with a framework annotation such as `@CircuitBreaker`, but to understand the problem, build a simple implementation, deliberately break it, observe its behavior under failure and concurrency, and improve the design.

The lab evolved through three versions:

```text
V1 → Basic Circuit Breaker
V2 → Thread-safe HALF_OPEN probe
V3 → Failure-rate-based Circuit Breaker with a sliding window
```

---

# 1. Why Circuit Breakers Exist

In a distributed system, one service frequently depends on another:

```text
Client
  |
  v
Order Service
  |
  v
Payment Service
```

If the Payment Service becomes unavailable, the Order Service may continue sending requests to it.

Without protection, this can cause:

- requests waiting for unavailable dependencies
- thread and connection-pool exhaustion
- retry amplification
- failures propagating upstream
- a local dependency failure becoming a wider system failure

A Circuit Breaker changes this behavior.

Instead of repeatedly calling a dependency known to be failing, the caller temporarily stops making calls and fails fast.

---

# 2. Circuit Breaker State Machine

The core state machine has three states:

```text
             failure threshold
        ┌──────────────────────────┐
        │                          ▼
     CLOSED ─────────────────────> OPEN
        ▲                            │
        │                            │ wait duration
        │                            ▼
        │                        HALF_OPEN
        │                         /       \
        │                   success       failure
        │                     │              │
        └─────────────────────┘              │
                                             ▼
                                            OPEN
```

## CLOSED

Normal operation. Requests are allowed and outcomes are recorded.

## OPEN

The dependency has crossed the configured failure threshold.

Requests are rejected immediately. The dependency is not called.

## HALF_OPEN

After the configured open duration, the breaker allows a controlled test request to determine whether the dependency has recovered.

Success:

```text
HALF_OPEN → CLOSED
```

Failure:

```text
HALF_OPEN → OPEN
```

---

# 3. Relationship to Other Failure-Handling Patterns

Circuit Breakers solve a different problem from timeouts, retries, and idempotency.

```text
Timeout
    ↓
Don't wait forever.

Retry
    ↓
Try again when a failure may be transient.

Idempotency
    ↓
Make repeated attempts safe.

Circuit Breaker
    ↓
Stop repeatedly calling a dependency that is failing.
```

A realistic distributed system often combines these mechanisms.

---

# 4. Project Setup

The lab uses:

- Java 21
- Spring Boot
- Maven Wrapper
- Spring Web

Run the application:

```powershell
.\mvnw.cmd spring-boot:run
```

---

# 5. Baseline Architecture

The initial implementation intentionally kept the Payment Service inside the same Spring Boot application:

```text
Client
  |
  v
Order Controller
  |
  v
Order Service
  |
  v
Payment Service
```

This is not intended to simulate a real network failure yet.

Keeping both services in the same application makes it easier to experiment with the Circuit Breaker state machine before introducing network-level failure.

---

# 6. Failure Injection

The Payment Service has an availability switch:

```http
POST /payment/availability/false
```

makes the payment service unavailable.

```http
POST /payment/availability/true
```

makes it available again.

This allowed failures to be reproduced deterministically.

The payment service was also temporarily slowed down with:

```java
Thread.sleep(3000);
```

The artificial delay made the concurrency experiment easier to observe because a very fast in-process method could complete before concurrent requests had an opportunity to overlap.

---

# 7. Version 1 — Basic Circuit Breaker

The first implementation used a simple consecutive-failure threshold:

```text
Failure threshold = 3
Open duration = 10 seconds
```

The basic behavior was:

```text
CLOSED
  |
  | 3 failures
  v
OPEN
  |
  | 10 seconds
  v
HALF_OPEN
```

A successful HALF_OPEN probe returned the circuit to CLOSED.

A failed HALF_OPEN probe returned it to OPEN.

## Experiment

Payment was made unavailable and three order requests were sent.

The breaker transitioned:

```text
CLOSED → OPEN
```

Further requests were rejected without calling Payment Service.

After the 10-second open duration:

```text
OPEN → HALF_OPEN
```

The next request became the recovery probe.

---

# 8. Version 1 Problem — HALF_OPEN Concurrency

The initial implementation contained:

```java
// HALF_OPEN
return true;
```

This meant every request was allowed while the circuit was HALF_OPEN.

Twenty concurrent requests were sent.

The result was effectively:

```text
20 requests
    |
    +----> Payment Service
    +----> Payment Service
    +----> Payment Service
    ...
```

All 20 requests were allowed through.

This violated an important Circuit Breaker invariant:

> At most one recovery probe should be in flight during HALF_OPEN.

The experiment demonstrated why a correct state machine is not enough. Concurrency must also be considered.

---

# 9. Version 2 — Thread-Safe HALF_OPEN Probe

V2 introduced:

```java
private boolean halfOpenProbeInProgress = false;
```

and synchronized access to the state transition:

```java
public synchronized boolean allowRequest()
```

The HALF_OPEN behavior became:

```text
HALF_OPEN
    |
    +---- first request → claim probe → ALLOW
    |
    +---- other requests → REJECT
```

The key invariant became:

> Only one request may claim the HALF_OPEN probe.

## Why Synchronization Was Necessary

Without synchronization, this could race:

```java
if (!halfOpenProbeInProgress) {
    halfOpenProbeInProgress = true;
    return true;
}
```

Two threads could both observe `false` before either updated it.

With synchronization, one thread claims the probe first and later threads observe that the probe is already in progress.

---

# 10. Version 2 Experiment

The experiment used:

- 3-second payment delay
- 20 concurrent requests
- Payment service recovered before the test

The behavior changed from:

```text
20 successful payment calls
```

to approximately:

```text
1 successful probe
19 rejected requests
```

Application logs showed:

```text
[CircuitBreaker] CLOSED -> OPEN
[CircuitBreaker] OPEN -> HALF_OPEN
[CircuitBreaker] HALF_OPEN probe CLAIMED
[CircuitBreaker] HALF_OPEN -> CLOSED
```

This demonstrated that the HALF_OPEN probe was controlled.

---

# 11. HALF_OPEN Failure Experiment

Payment was intentionally kept unavailable after the breaker entered HALF_OPEN.

The observed transition was:

```text
[CircuitBreaker] OPEN -> HALF_OPEN
[CircuitBreaker] HALF_OPEN -> OPEN
```

This was repeated when another recovery period elapsed.

The resulting behavior was:

```text
OPEN
  |
  | wait
  v
HALF_OPEN
  |
  | probe fails
  v
OPEN
```

This verified both HALF_OPEN outcomes:

```text
                    HALF_OPEN
                   /          \
              success        failure
                 |              |
                 v              v
              CLOSED           OPEN
```

---

# 12. Version 2 Lessons

### State transitions must be concurrency-safe

The Circuit Breaker is a shared state machine.

Fields such as:

```text
state
failureCount
openedAt
halfOpenProbeInProgress
```

cannot be treated as independent ordinary variables when multiple threads access them.

### Do not hold the lock during the dependency call

We should not do:

```text
lock
  |
  v
Payment Service
  |
  | 3 seconds
  v
unlock
```

That would unnecessarily serialize requests.

Instead:

```text
lock
  |
  | claim probe
  v
unlock
  |
  v
Payment Service
  |
  v
lock
  |
  | record result
  v
unlock
```

The critical section protects state transitions, not the remote operation itself.

---

# 13. Version 3 — Failure-Rate-Based Circuit Breaker

The V1/V2 breaker opened after:

```text
3 consecutive failures
```

That is useful for learning but simplistic.

V3 introduces a simple sliding window.

Configuration:

```text
Window size = 10 calls
Failure rate threshold = 50%
Open duration = 10 seconds
```

The breaker evaluates the failure rate once the window contains enough calls.

Example:

```text
10 recent calls

Success = 4
Failure = 6

Failure rate = 60%

60% >= 50%
       |
       v
      OPEN
```

Whereas:

```text
10 recent calls

Success = 7
Failure = 3

Failure rate = 30%

30% < 50%
       |
       v
     CLOSED
```

---

# 14. Sliding Window

The implementation uses:

```java
Deque<Boolean> results
```

Each result represents:

```text
true  → success
false → failure
```

When the window is full:

```java
results.removeFirst();
```

removes the oldest result.

Then:

```java
results.addLast(success);
```

adds the newest result.

Therefore the breaker always evaluates the most recent calls.

This is the basic idea of a sliding window.

---

# 15. Minimum Number of Calls

V3 does not evaluate the failure rate immediately.

It waits until:

```text
results.size() >= windowSize
```

This prevents a tiny sample from immediately opening the circuit.

Without this rule:

```text
1 call
1 failure
100% failure rate
```

could immediately open the circuit.

Instead, the breaker waits until enough observations have been collected.

---

# 16. Version 3 HALF_OPEN Behavior

V3 retains the controlled HALF_OPEN probe from V2.

When OPEN duration expires:

```text
OPEN
  |
  | wait 10 seconds
  v
HALF_OPEN
```

Only one request can claim the probe:

```text
HALF_OPEN
    |
    +---- Request A → PROBE
    |
    +---- Request B → REJECT
    |
    +---- Request C → REJECT
    |
    +---- ...
```

### Probe succeeds

```text
HALF_OPEN → CLOSED
```

The previous results are cleared because the dependency has demonstrated recovery.

### Probe fails

```text
HALF_OPEN → OPEN
```

The dependency is still unhealthy, so the circuit remains open.

---

# 17. Version 3 Architecture

The lab keeps separate service implementations so the learning history is preserved:

```text
OrderService
    |
    └── CircuitBreaker
         └── V1

OrderServiceV2
    |
    └── CircuitBreakerV2
         └── V2

OrderServiceV3
    |
    └── CircuitBreakerV3
         └── V3
```

The versions represent the evolution of the design.

---

# 18. Key Invariants Learned

## Invariant 1 — OPEN must fail fast

When the circuit is OPEN, the dependency should not be called.

## Invariant 2 — HALF_OPEN must be controlled

Only a limited number of requests should test recovery.

For this implementation:

```text
At most one probe in flight.
```

## Invariant 3 — HALF_OPEN failure must reopen the circuit

```text
HALF_OPEN + failed probe
        ↓
      OPEN
```

## Invariant 4 — HALF_OPEN success closes the circuit

```text
HALF_OPEN + successful probe
        ↓
      CLOSED
```

## Invariant 5 — State transitions must be thread-safe

The breaker is shared state accessed by concurrent requests.

## Invariant 6 — Don't hold synchronization around slow dependency calls

Protect the state transition, not the remote operation.

---

# 19. Why We Built This Before Using Resilience4j

A framework can make Circuit Breakers easy to configure:

```java
@CircuitBreaker(...)
```

But using an annotation without understanding the underlying behavior makes it easy to miss important system-design questions.

By building the breaker ourselves, we encountered:

- state machines
- concurrency
- race conditions
- synchronization
- failure thresholds
- failure-rate windows
- recovery probes
- fail-fast behavior
- state-transition correctness
- observability considerations

These concepts remain relevant even when a production library handles the implementation details.

---

# 20. What Our Implementation Still Does Not Handle

This implementation is intentionally educational rather than production-ready.

### Failure classification

Currently an exception is treated as a dependency failure.

A real system should distinguish between:

```text
Dependency failure
Timeout
Connection failure
Application bug
Validation error
Business rejection
```

Not every exception should necessarily trip the circuit.

### Slow calls

A dependency may respond successfully but take too long.

Production Circuit Breakers can consider slow calls as a separate failure signal.

### Metrics

A production implementation needs visibility into:

```text
Circuit state
Failure rate
Rejected calls
Successful calls
Failed calls
Slow calls
HALF_OPEN probes
```

### Distributed instances

Our Circuit Breaker is local to one application instance.

With multiple Order Service instances:

```text
             Load Balancer
              /    |    \
             /     |     \
            v      v      v
          App 1  App 2  App 3
            |      |      |
           CB     CB     CB
            \      |      /
             \     |     /
              Payment
```

Each instance can have its own breaker state.

This is an important architectural consideration.

### Real network failure

Our Payment Service currently lives in the same Spring Boot application.

A future experiment can separate it into an actual service so we can observe:

- connection failures
- HTTP timeouts
- network latency
- connection pool exhaustion
- retries interacting with the breaker

---

# 21. Current Status

## Circuit Breaker Lab

- [x] Understand why Circuit Breakers exist
- [x] Understand CLOSED
- [x] Understand OPEN
- [x] Understand HALF_OPEN
- [x] Implement V1
- [x] Test fail-fast behavior
- [x] Test recovery
- [x] Break HALF_OPEN with concurrent requests
- [x] Implement controlled HALF_OPEN probe
- [x] Make state operations thread-safe
- [x] Test successful HALF_OPEN recovery
- [x] Test failed HALF_OPEN recovery
- [x] Implement failure-rate-based opening
- [x] Implement a sliding window
- [x] Understand minimum-call requirements
- [ ] Explore slow-call thresholds
- [ ] Introduce a real remote Payment Service
- [ ] Study production Circuit Breaker implementations
- [ ] Implement Circuit Breaker with Resilience4j
- [ ] Combine Timeout + Retry + Circuit Breaker

---

# 22. Next Step

The homemade implementation has now served its purpose.

The next stage is to study a production implementation such as **Resilience4j**.

The goal is not simply:

> "How do I add `@CircuitBreaker`?"

Instead:

```text
Our implementation
        ↓
What problems did we solve?
        ↓
What problems did we ignore?
        ↓
How does Resilience4j solve them?
        ↓
How should Circuit Breaker interact with
Timeout + Retry + Idempotency?
```

This bridges the gap between the theory implemented manually and patterns used in production Spring Boot systems.

---

# 23. Final Takeaway

The most important mental model from this lab is:

> A Circuit Breaker is a state machine that protects a caller from repeatedly interacting with an unhealthy dependency.

It does not repair the dependency.

It does not replace timeouts.

It does not automatically make retries safe.

It does not eliminate failures.

It controls **when the caller is willing to attempt the dependency again**.

The essential flow is:

```text
             Healthy
               |
               v
            CLOSED
               |
       repeated failures
               |
               v
             OPEN
               |
          wait period
               |
               v
          HALF_OPEN
           /       \
      success      failure
         |            |
         v            v
      CLOSED         OPEN
```

And under concurrency:

```text
HALF_OPEN
    |
    +-- one controlled probe
    |
    +-- competing requests fail fast
```

That is the core Circuit Breaker pattern.
