# Circuit Breaker Lab

A practical system-design lab for understanding **Circuit Breakers from first principles**, implementing one ourselves, deliberately breaking it, and then improving the design.

## 1. Goal

The goal is not simply to learn how to use a Circuit Breaker library.

We want to understand:

- Why Circuit Breakers exist
- What problem they solve
- How CLOSED, OPEN, and HALF_OPEN work
- How Circuit Breakers interact with timeouts, retries, and idempotency
- What can go wrong with a naive implementation
- How concurrency changes the design
- How the concept applies to real distributed services
- Eventually, how a production library such as Resilience4j implements the concept

Learning approach:

```text
Understand → Build → Break → Observe → Improve → Apply to distributed services
```

---

# 2. Why Circuit Breakers Exist

Consider an Order Service that depends on a Payment Service:

```text
Client
   |
   v
Order Service
   |
   v
Payment Service
```

If Payment is repeatedly failing and Order continues calling it, the failure can propagate back into the caller through increased latency, repeated failures, consumed connections/threads, retries, and resource exhaustion.

The key idea:

> A dependency that is repeatedly failing should not consume unlimited resources from its caller.

A Circuit Breaker allows the caller to **fail fast** instead of continuously calling the failing dependency.

---

# 3. Circuit Breaker States

```text
                    failure threshold
                 ┌────────────────────┐
                 │                    │
                 v                    │
              CLOSED ──────────────> OPEN
                                      |
                                      | wait duration
                                      v
                                  HALF_OPEN
                                    /     \
                              success     failure
                                /           \
                               v             v
                            CLOSED         OPEN
```

### CLOSED

Normal operation. Requests are allowed and failures are recorded.

Our initial configuration:

```text
Failure threshold = 3 failures
```

### OPEN

The dependency is considered unhealthy. Requests are rejected immediately instead of calling it.

Our initial configuration:

```text
Open duration = 10 seconds
```

### HALF_OPEN

After the open duration, the breaker permits a recovery test.

```text
HALF_OPEN
   |
   +-- success --> CLOSED
   |
   +-- failure --> OPEN
```

Our first implementation intentionally has a weakness here: it does not properly restrict concurrent HALF_OPEN requests. That becomes the next experiment.

---

# 4. Relationship With Other Resilience Patterns

These patterns solve different problems:

```text
Timeout
    ↓
Don't wait forever

Retry
    ↓
Try again when a failure may be transient

Idempotency
    ↓
Make repeated attempts safe

Circuit Breaker
    ↓
Stop repeatedly calling a failing dependency
```

They can be combined in a resilient distributed system.

---

# 5. Project Setup

Environment:

```text
Operating System : Windows 11
Java             : Eclipse Temurin 21.0.12.1 LTS
Spring Boot      : 4.1.1
Build Tool       : Maven
Maven            : Maven Wrapper 3.9.16
Packaging        : Jar
Dependency       : Spring Web
IDE              : VS Code
```

Global Maven installation is not required because the project uses the Maven Wrapper.

Run the application:

```powershell
.\mvnw.cmd spring-boot:run
```

Project:

```text
C:\CODE\SYSTEM DESIGN\GITHUB PROJECTS\distributed-systems-labs\04-Circuit-Breaker\circuit-breaker-demo
```

---

# 6. Stage 1 — Baseline Without a Circuit Breaker

We first built the simplest dependency relationship:

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

Payment has a simple availability flag so we can simulate failure.

The availability endpoint is:

```text
POST /payment/availability/{available}
```

Make Payment available:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/true
```

Make Payment unavailable:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/false
```

Create an order:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/orders
```

With Payment available:

```text
Order created: Payment successful
```

With Payment unavailable, the request fails.

The important baseline observation was:

> Every subsequent request continued attempting to call the failing Payment Service.

There was no protection mechanism.

---

# 7. Stage 2 — First Circuit Breaker Implementation

We introduced our own Circuit Breaker instead of using Resilience4j.

Architecture:

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
Circuit Breaker
  |
  v
Payment Service
```

Configuration:

```text
Failure threshold = 3
Open duration     = 10 seconds
```

The implementation tracks:

```text
Current state
Failure count
Failure threshold
Time when the breaker opened
Open duration
```

The states are:

```java
CLOSED
OPEN
HALF_OPEN
```

---

# 8. Integrating the Circuit Breaker

OrderService first asks whether the request is allowed:

```text
Order request
     |
     v
allowRequest()
     |
     +------ false ------> Reject immediately
     |
     true
     |
     v
Payment Service
```

On success:

```text
recordSuccess()
```

On failure:

```text
recordFailure()
```

The simplified flow:

```java
if (!circuitBreaker.allowRequest()) {
    return "Payment service unavailable - request rejected by circuit breaker";
}

try {
    String paymentResult = paymentService.processPayment();

    circuitBreaker.recordSuccess();

    return "Order created: " + paymentResult;

} catch (Exception e) {

    circuitBreaker.recordFailure();

    return "Payment failed";
}
```

---

# 9. Circuit Breaker Experiment

## Step 1 — Payment Available

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/true
```

Then:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/orders
```

Expected:

```text
Order created: Payment successful
```

## Step 2 — Break Payment

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/false
```

Create an order three times.

Each produces:

```text
Payment failed
```

The internal count reaches:

```text
failureCount = 3
```

The state changes:

```text
CLOSED → OPEN
```

## Step 3 — Observe Fail Fast

Immediately send another order:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/orders
```

Expected:

```text
Payment service unavailable - request rejected by circuit breaker
```

The important observation:

> The request is rejected by the Circuit Breaker without calling Payment Service.

Before:

```text
Order → Payment → Failure
```

After the breaker opens:

```text
Order → Circuit Breaker → REJECT
                                               X Payment Service
```

This is **fail-fast behavior**.

---

# 10. HALF_OPEN Experiment

After the breaker remains OPEN for 10 seconds, the next request is allowed through as a test:

```text
OPEN
  |
  | 10 seconds
  v
HALF_OPEN
```

If Payment is still unavailable:

```text
HALF_OPEN → failure → OPEN
```

If Payment has recovered:

```text
HALF_OPEN → success → CLOSED
```

This gives the dependency an opportunity to recover without immediately allowing unrestricted traffic.

---

# 11. What We Have Learned

At this point we have implemented and observed the fundamental Circuit Breaker behavior ourselves.

### A Circuit Breaker protects the caller

It does not directly repair the failing dependency.

### OPEN means fail fast

The caller stops sending requests to a repeatedly failing dependency.

### HALF_OPEN is a recovery test

The system checks whether the dependency has recovered before returning to normal operation.

### Circuit Breakers are state machines

The behavior can be understood through explicit state transitions.

### The threshold is a policy

We chose:

```text
3 failures → OPEN
```

A production system may use different thresholds or failure-rate rules.

---

# 12. Current Limitations — Intentionally

Our first implementation is deliberately naive.

## Problem 1 — HALF_OPEN is not properly restricted

The current implementation effectively does:

```java
// HALF_OPEN
return true;
```

Therefore, if many requests arrive at the same time:

```text
             ┌── Request 1 ──→ Payment
             ├── Request 2 ──→ Payment
HALF_OPEN ───┼── Request 3 ──→ Payment
             ├── Request 4 ──→ Payment
             └── Request 5 ──→ Payment
```

A more controlled design would allow only a limited number of probe requests, potentially just one:

```text
HALF_OPEN
     |
     v
 Allow ONE test
     |
   ┌─┴──────────┐
   |            |
success       failure
   |            |
   v            v
 CLOSED        OPEN
```

## Problem 2 — The implementation is not thread-safe

Spring handles requests concurrently.

Code such as:

```java
failureCount++;
```

does not by itself guarantee correct behavior under concurrent access.

Two threads could attempt to update state simultaneously.

## Problem 3 — Every exception is treated as a failure

Currently:

```java
catch (Exception e) {
    circuitBreaker.recordFailure();
}
```

This means every exception can potentially count toward opening the circuit.

In a real system, dependency failures should be distinguished from business or validation failures where appropriate.

For example:

```text
Dependency unavailable       → potentially count
Connection failure           → potentially count
Timeout                      → potentially count

Invalid customer input       → usually not a dependency failure
Business validation failure → usually not a dependency failure
```

## Problem 4 — No observability

The current implementation does not expose useful operational information such as:

```text
Current state
Failure count
Last failure
Time opened
Rejected request count
Recovery probe results
```

## Problem 5 — Payment is not actually remote

Currently both components are inside the same Spring application:

```text
Spring Application
│
├── OrderService
└── PaymentService
```

This simplifies the first experiment.

Later we will separate them:

```text
Order Service
      |
      | HTTP
      v
Payment Service
```

That will let us introduce real distributed-system failure modes such as network latency, connection failures, HTTP errors, timeouts, service crashes, and connection-pool pressure.

---

# 13. Why We Are Not Using Resilience4j Yet

A production application would normally use an established resilience library rather than implementing everything from scratch.

We are deliberately delaying that.

The learning sequence is:

```text
Build it ourselves
       ↓
Understand the failure modes
       ↓
Improve the design
       ↓
Understand production requirements
       ↓
Then use a library
```

Later we will compare our implementation with Resilience4j.

---

# 14. Planned Evolution

```text
Stage 1
Baseline without Circuit Breaker
        ↓
Stage 2
Simple Circuit Breaker
        ↓
Stage 3
Deliberately break it with concurrency
        ↓
Stage 4
Fix HALF_OPEN behavior
        ↓
Stage 5
Make state management thread-safe
        ↓
Stage 6
Separate Payment into a real HTTP service
        ↓
Stage 7
Introduce network failures and timeouts
        ↓
Stage 8
Combine Timeout + Retry + Idempotency + Circuit Breaker
        ↓
Stage 9
Use Resilience4j
        ↓
Stage 10
Compare our implementation with production patterns
```

---

# 15. Next Experiment

The next experiment is to deliberately attack the current implementation.

Put the Circuit Breaker into:

```text
OPEN
```

Wait for the 10-second period so it becomes:

```text
HALF_OPEN
```

Then send multiple requests concurrently.

We want to answer:

> What happens when many threads discover HALF_OPEN at the same time?

This lets us observe the limitation rather than simply being told that it exists.

That leads naturally into:

```text
Concurrency
   ↓
Race conditions
   ↓
Thread safety
   ↓
Atomic state transitions
   ↓
Controlled HALF_OPEN probes
```

---

# 16. Current Status

```text
[x] Understand Circuit Breaker problem
[x] Understand CLOSED / OPEN / HALF_OPEN
[x] Create Spring Boot project
[x] Build failing Payment Service simulation
[x] Build Order Service
[x] Implement simple Circuit Breaker
[x] Integrate Circuit Breaker with Order Service
[x] Test failure threshold
[x] Test OPEN state
[x] Test fail-fast behavior
[x] Test HALF_OPEN recovery flow
[ ] Test concurrent HALF_OPEN requests
[ ] Fix HALF_OPEN concurrency
[ ] Make implementation thread-safe
[ ] Separate Payment into HTTP service
[ ] Introduce network failures/timeouts
[ ] Combine resilience patterns
[ ] Compare with Resilience4j
```

---

# 17. Key Takeaway

The most important idea from this stage is:

> A Circuit Breaker prevents a caller from repeatedly spending resources on a dependency that is currently failing.

Normal:

```text
Caller → Dependency
```

Dependency failing:

```text
Caller → Dependency → Failure
Caller → Dependency → Failure
Caller → Dependency → Failure
Caller → Dependency → Failure
```

With a Circuit Breaker:

```text
Caller → Circuit Breaker → Dependency
                         ↓
                      Failure
                         ↓
Caller → Circuit Breaker → REJECT
Caller → Circuit Breaker → REJECT
Caller → Circuit Breaker → REJECT
```

The Circuit Breaker is therefore a **protective mechanism around a dependency**, not a mechanism for fixing that dependency.

---

## Reference

This document captures the lab from the initial baseline through the first working Circuit Breaker and its known limitations.

Next implementation milestone: **concurrent HALF_OPEN testing and fixing the resulting design problem.**
