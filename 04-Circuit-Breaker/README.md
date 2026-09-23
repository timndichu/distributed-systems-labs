# Circuit Breaker Lab

A practical system-design lab for understanding the **Circuit Breaker pattern from first principles**, implementing it ourselves, deliberately breaking it, and then comparing the result with a production-oriented library such as Resilience4j.

This lab is part of the [`distributed-systems-labs`](https://github.com/timndichu/distributed-systems-labs) repository.

---

## Goal

The goal of this lab is to understand:

- Why Circuit Breakers exist
- How they protect callers from unhealthy dependencies
- How the `CLOSED`, `OPEN`, and `HALF_OPEN` states work
- How concurrency affects Circuit Breaker correctness
- How failure rates and sliding windows can be used
- How slow-call detection works
- How a production library such as Resilience4j implements these ideas
- How Circuit Breakers relate to timeouts, retries, and idempotency

The learning approach is intentional:

```text
Understand the problem
        |
        v
Build the simplest solution
        |
        v
Observe the solution
        |
        v
Break the solution
        |
        v
Understand its limitations
        |
        v
Improve it
        |
        v
Compare with a production library
        |
        v
Combine the resilience patterns
```

---

# 1. Problem We Are Solving

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

Normally:

```text
Request
   |
   v
Order Service
   |
   v
Payment Service
   |
   v
SUCCESS
```

But if Payment Service becomes unavailable:

```text
Order Service
      |
      v
Payment Service
      |
      X
   FAILURE
```

The Order Service may continue sending requests to a dependency that is already known to be unhealthy.

If requests also use timeouts and retries, the problem can become worse:

```text
Many requests
      |
      v
Payment Service
      X
      |
      +--> timeouts
      |
      +--> retries
      |
      +--> more load
```

This can contribute to **cascading failures** and resource exhaustion.

## Key principle

> A failing dependency should not be allowed to consume unlimited resources from the service that depends on it.

A Circuit Breaker helps by temporarily stopping calls to a dependency that is repeatedly failing or becoming unhealthy.

---

# 2. Circuit Breaker Concept

The Circuit Breaker sits between a caller and a downstream dependency:

```text
Client
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

Instead of continually calling a failing or unhealthy Payment Service, the Circuit Breaker can **fail fast** and prevent the request from reaching the dependency.

---

# 3. Why "Fail Fast" Matters

Without a Circuit Breaker:

```text
Request
   |
   v
Payment
   |
   | wait
   v
Timeout
   |
   v
Retry
   |
   v
Payment
   |
   | wait
   v
Timeout
```

The caller can spend significant time waiting for a dependency that is already unhealthy.

With an open Circuit Breaker:

```text
Request
   |
   v
Circuit Breaker
   |
   X
Fail immediately
```

The downstream service is not called.

This reduces unnecessary work and protects resources in the calling service.

---

# 4. Circuit Breaker States

A Circuit Breaker normally has three states:

```text
              failure / health threshold
                        |
                        v
                   +---------+
                   | CLOSED  |
                   +----+----+
                        |
                        | threshold exceeded
                        v
                   +---------+
                   |  OPEN   |
                   +----+----+
                        |
                        | wait duration
                        v
                  +------------+
                  | HALF-OPEN  |
                  +------+-----+
                         |
                    test request
                     /         \
                success       failure
                   |             |
                   v             v
                CLOSED          OPEN
```

## CLOSED

Normal operation.

Requests are allowed to reach the downstream service.

The Circuit Breaker records outcomes such as:

```text
Request 1 -> SUCCESS
Request 2 -> SUCCESS
Request 3 -> FAILURE
Request 4 -> SUCCESS
```

Depending on the implementation, the breaker may use failures, slow calls, or other configured signals to determine when the dependency has become unhealthy.

## OPEN

The dependency has crossed the configured threshold.

Requests are rejected without calling the downstream service:

```text
Order Service
      |
      v
Circuit Breaker
      |
      X
Payment Service
```

The request **fails fast**.

## HALF-OPEN

After a configured waiting period, the Circuit Breaker allows a limited number of test requests through.

If the dependency recovers:

```text
HALF-OPEN -> CLOSED
```

If the test fails:

```text
HALF-OPEN -> OPEN
```

An important lesson from this lab is that HALF-OPEN must be carefully controlled under concurrency. Allowing every concurrent request through defeats the purpose of the recovery probe.

---

# 5. Relationship With Other Failure Patterns

We have studied several complementary resilience patterns.

### Timeout

> Don't wait forever.

```text
Payment
   |
   +--- 5 seconds ---> TIMEOUT
```

A timeout limits how long an individual operation is allowed to wait.

### Retry

> A failure may be temporary, so try again when retrying is appropriate.

```text
Payment
   |
   X
   |
 Retry
```

Retries can help with transient failures, but can also increase load on an already unhealthy dependency.

### Idempotency

> If a request is retried, make sure repeating the request does not accidentally perform the operation multiple times.

This is especially important for operations such as payments or order creation.

### Circuit Breaker

> The dependency is repeatedly failing or becoming unhealthy, so stop calling it temporarily.

These patterns solve different parts of the failure problem:

```text
Timeout
   |
   v
Limit how long one request waits
   |
   v
Retry when appropriate
   |
   v
Repeated dependency problems
   |
   v
Circuit Breaker
   |
   v
Fail fast
```

They should not automatically be applied to every request in every system.

---

# 6. Lab Structure

The Circuit Breaker folder contains two implementations:

```text
04-Circuit-Breaker/
│
├── circuit-breaker-demo/
│   └── Homemade implementations
│
├── resilience4j-demo/
│   └── Resilience4j implementation
│
└── README.md
```

The learning path is:

```text
Homemade Circuit Breaker
        |
        v
V1 - Basic state machine
        |
        v
V2 - Thread-safe HALF_OPEN
        |
        v
V3 - Failure-rate + sliding window
        |
        v
Resilience4j
        |
        v
Slow-call detection
        |
        v
Combined resilience patterns
```

The two implementations are intentionally kept separate so that the homemade experiments remain available for comparison.

---

# 7. Lab 1 — Homemade Circuit Breaker

Location:
[circuit-breaker-demo/](./circuit-breaker-demo/)


This project starts without a Circuit Breaker and gradually builds one from scratch.

## Technology

- Java 21 LTS
- Spring Boot 4.1.1
- Maven Wrapper
- Spring Web
- Embedded Tomcat

The application runs on:

```text
http://localhost:8080
```

## Initial Architecture

The initial application intentionally has no Circuit Breaker:

```text
Client
  |
  | POST /orders
  v
Order Controller
  |
  v
Order Service
  |
  v
Payment Service
```

The Payment Service is implemented inside the same Spring Boot application to keep the first experiments simple.

Later, the lab can evolve into genuinely separate services communicating over HTTP.

---

# 8. Failure Simulation

The Payment Service has a simple availability switch.

When available:

```text
processPayment()
      |
      v
Payment successful
```

When unavailable:

```text
processPayment()
      |
      v
RuntimeException
```

The Payment Controller exposes:

```text
POST /payment/availability/{available}
```

Make Payment unavailable:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/false
```

Make it available again:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/true
```

This is only a simulation mechanism for the lab.

Orders are created with:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/orders
```

---

# 9. Homemade Circuit Breaker — V1

The first implementation introduced the basic state machine.

Configuration:

```text
Failure threshold: 3 failures
Open duration:     10 seconds
```

Expected lifecycle:

```text
CLOSED
   |
   | 3 failures
   v
OPEN
   |
   | wait 10 seconds
   v
HALF-OPEN
   |
   | test request
   |
   +---- success ----> CLOSED
   |
   +---- failure ----> OPEN
```

V1 demonstrated:

- Failure counting
- Opening the circuit
- Fail-fast behavior
- Waiting before recovery
- HALF-OPEN recovery testing

---

# 10. Homemade Circuit Breaker — V2

V1 deliberately contained a concurrency problem.

The initial HALF-OPEN implementation effectively allowed multiple concurrent requests to pass through the recovery test.

We exposed the problem by sending many concurrent requests.

The lesson was:

> HALF-OPEN is not normal traffic. It is a controlled recovery probe.

V2 introduced:

- `synchronized` state operations
- A `halfOpenProbeInProgress` flag
- A single controlled HALF-OPEN probe
- Thread-safe state transitions

The result became:

```text
OPEN
  |
  | wait duration
  v
HALF-OPEN
  |
  +---- one request ----> Payment Service
  |
  +---- other requests -> rejected
```

This was an important distributed-systems lesson because a correct state machine can still behave incorrectly when multiple threads interact with it concurrently.

---

# 11. Homemade Circuit Breaker — V3

V3 moved beyond a simple consecutive-failure counter.

Instead of opening after exactly three consecutive failures, it used a **sliding window** and **failure rate**.

Example configuration:

```text
Window size:          10 calls
Failure-rate threshold: 50%
Open duration:        10 seconds
```

Conceptually:

```text
Recent calls:

[ SUCCESS ][ FAILURE ][ FAILURE ][ SUCCESS ][ FAILURE ]
[ SUCCESS ][ FAILURE ][ SUCCESS ][ FAILURE ][ FAILURE ]
```

The Circuit Breaker calculates the failure rate over the recent window.

This introduces two important production concepts:

### Sliding window

Only recent calls influence the decision.

### Minimum number of calls

The Circuit Breaker should not make a failure-rate decision based on too little data.

This version also retained the controlled HALF-OPEN probe introduced in V2.

---

# 12. What We Learned From Building It Ourselves

Building the Circuit Breaker manually exposed several important lessons:

### The state machine is simple; concurrency is not

The states are easy to describe:

```text
CLOSED
OPEN
HALF_OPEN
```

But implementing them safely under concurrent requests requires careful synchronization.

### Singleton is not the solution to the race

Having one Circuit Breaker instance controls how many breaker objects exist.

It does not automatically make concurrent state changes safe.

Thread synchronization protects the state transitions.

### Do not hold the lock around the slow dependency call

The lock should protect the Circuit Breaker's state:

```text
claim probe
update state
record result
```

It should not be held while waiting for Payment Service:

```text
Circuit Breaker lock
      |
      X
3-second Payment call
```

That would unnecessarily serialize unrelated requests.

### HALF-OPEN is a controlled recovery state

It should not become a temporary version of CLOSED.

The purpose is to answer:

> "Has the dependency recovered enough to accept traffic again?"

---

# 13. Lab 2 — Resilience4j

Location:
[resilience4j-demo/](./resilience4j-demo/)


After understanding the pattern ourselves, the lab moves to a production-oriented implementation using Resilience4j.

Technology:

- Java 21 LTS
- Spring Boot 4.1.1
- Maven Wrapper
- Spring Web
- Resilience4j 2.4.0
- Spring Boot 4 integration
- AspectJ support for annotation-based interception

The core dependency is:

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot4</artifactId>
    <version>2.4.0</version>
</dependency>
```

---

# 14. Resilience4j Architecture

The application follows the same conceptual architecture:

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

The difference is that the Circuit Breaker behavior is now provided by Resilience4j.

The Order Service uses:

```java
@CircuitBreaker(
    name = "paymentService",
    fallbackMethod = "paymentFallback"
)
```

This allows us to compare the library's behavior against the homemade implementations.

---

# 15. Resilience4j Configuration

The initial configuration:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        slidingWindowSize: 10
        minimumNumberOfCalls: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 10s
        permittedNumberOfCallsInHalfOpenState: 1
```

This gives us the same major concepts we implemented manually:

```text
Sliding window
Minimum calls
Failure threshold
Open wait duration
Controlled HALF_OPEN probes
```

---

# 16. Resilience4j Experiments

The Resilience4j lab verified the complete state machine.

### Failure recording

When Payment Service failed, Resilience4j recorded the error.

### CLOSED → OPEN

After enough failures:

```text
CLOSED → OPEN
```

### OPEN fail-fast behavior

Once OPEN:

```text
Request
   |
   v
Circuit Breaker
   |
   X
NOT_PERMITTED
```

Payment Service was not called.

### OPEN → HALF_OPEN

After the configured wait duration:

```text
OPEN → HALF_OPEN
```

### Failed recovery

If Payment remained unavailable:

```text
HALF_OPEN → OPEN
```

### Successful recovery

After restoring Payment:

```text
HALF_OPEN → CLOSED
```

This verified the same core state machine that we implemented manually.

---

# 17. Slow-Call Detection

A dependency does not have to fail outright to become unhealthy.

It can remain successful while becoming too slow.

For example:

```text
Payment request
      |
      | 3 seconds
      v
Payment succeeds
```

Technically:

```text
SUCCESS
```

but the call may still be harmful to the overall system if this latency becomes common.

Resilience4j can detect this with:

```yaml
slowCallDurationThreshold
slowCallRateThreshold
```

In the experiment:

```yaml
payment:
  delay: 3000

slowCallDurationThreshold: 2s
slowCallRateThreshold: 50
```

Therefore:

```text
Payment delay:       3 seconds
Slow threshold:      2 seconds
```

Each call succeeds but is classified as slow.

After enough slow calls:

```text
Slow-call rate
      |
      v
Threshold exceeded
      |
      v
CLOSED → OPEN
```

The Circuit Breaker then rejects subsequent requests with:

```text
NOT_PERMITTED
```

without calling Payment Service.

The detailed experiment is documented separately:

👉 [`Slow-Call Detection Lab`](./resilience4j-demo/slow-call/README.md)

---

# 18. Slow Calls vs Timeouts

These concepts are related but different.

### Timeout

Protects an individual request:

```text
Request
  |
  |---- waiting ---->
  |
  X TIMEOUT
```

### Slow-call detection

Detects a pattern:

```text
Request 1 ── 3s ── SUCCESS
Request 2 ── 3s ── SUCCESS
Request 3 ── 3s ── SUCCESS
...
```

The calls succeed, but the dependency is consistently too slow.

### Circuit Breaker

Acts on the broader health signal:

```text
Timeout
   ↓
Individual request protection

Slow-call detection
   ↓
Dependency latency signal

Circuit Breaker
   ↓
Stop traffic when dependency health deteriorates
```

---

# 19. Homemade vs Resilience4j

The purpose of the homemade implementation was not to replace Resilience4j.

It was to understand what the library is actually doing.

| Concept | Homemade Lab | Resilience4j |
|---|---|---|
| CLOSED | Implemented | Supported |
| OPEN | Implemented | Supported |
| HALF_OPEN | Implemented | Supported |
| Fail-fast | Implemented | Supported |
| Thread-safe state | Implemented in V2/V3 | Library-managed |
| Sliding window | Implemented in V3 | Supported |
| Failure rate | Implemented in V3 | Supported |
| Minimum calls | Implemented in V3 | Supported |
| Slow-call detection | Explored conceptually through library | Supported |
| Fallback | Manually handled | Supported |
| Production-oriented implementation | Learning implementation | Production library |

The important observation is that the library is not magic.

The underlying concepts are still:

```text
State
+
Metrics
+
Thresholds
+
Time
+
Concurrency control
```

The library provides a mature implementation around those concepts.

---

# 20. Current Lab Status

The Circuit Breaker lab has now covered:

- [x] Understand why Circuit Breakers exist
- [x] Understand CLOSED
- [x] Understand OPEN
- [x] Understand HALF_OPEN
- [x] Implement a basic Circuit Breaker
- [x] Test fail-fast behavior
- [x] Test recovery
- [x] Break HALF_OPEN with concurrent requests
- [x] Implement a controlled HALF_OPEN probe
- [x] Make state operations thread-safe
- [x] Test successful HALF_OPEN recovery
- [x] Test failed HALF_OPEN recovery
- [x] Implement failure-rate-based opening
- [x] Implement a sliding window
- [x] Understand minimum-call requirements
- [x] Implement Resilience4j Circuit Breaker
- [x] Observe `NOT_PERMITTED` behavior
- [x] Test successful HALF_OPEN recovery with Resilience4j
- [x] Test failed HALF_OPEN recovery with Resilience4j
- [x] Implement slow-call detection
- [x] Verify successful calls can still be classified as slow
- [x] Verify slow-call rate can open the Circuit Breaker
- [x] Verify OPEN state prevents calls from reaching the dependency

---

# 21. Project Structure

The final structure is approximately:

```text
04-Circuit-Breaker/
│
├── README.md
│
├── circuit-breaker-demo/
│   ├── src/
│   ├── pom.xml
│   ├── mvnw
│   └── mvnw.cmd
│
└── resilience4j-demo/
    ├── src/
    ├── slow-call/
    │   └── README.md
    ├── pom.xml
    ├── mvnw
    └── mvnw.cmd
```

The separation is intentional:

```text
circuit-breaker-demo
        |
        v
Learn by building

resilience4j-demo
        |
        v
Learn by using a production library

slow-call
        |
        v
Explore latency-based health detection
```

---

# 22. What Comes Next

The Circuit Breaker concept is now sufficiently explored as a standalone pattern.

The next stage is to stop studying the resilience patterns in isolation and see how they interact.

The patterns studied so far are:

```text
Timeout
   +
Retry
   +
Idempotency
   +
Circuit Breaker
```

The next practical lab will combine them into a small distributed system.

The interesting questions will be:

- What happens when a retry encounters an open Circuit Breaker?
- Where should the timeout live?
- How many retries should be allowed?
- How can retries amplify load?
- How does idempotency make retries safe?
- What happens when a timeout occurs but the downstream operation actually succeeds?
- How do all these mechanisms interact during a dependency outage?

The goal is to move from understanding individual patterns to understanding **resilience as a system-level design problem**.

---

# Final Takeaway

The most important lesson from this lab is not the annotation:

```java
@CircuitBreaker
```

It is the behavior behind it.

We first implemented that behavior ourselves:

```text
CLOSED
   ↓
OPEN
   ↓
HALF_OPEN
   ↓
CLOSED / OPEN
```

Then we deliberately broke our implementation under concurrency, fixed the HALF-OPEN race, introduced sliding-window failure rates, and finally compared those concepts with Resilience4j.

We also saw that dependency health is not only about explicit failures:

```text
Failure
   +
Latency degradation
   ↓
Dependency becomes unhealthy
   ↓
Circuit Breaker
   ↓
Fail fast
```

The core purpose remains:

> **Protect the caller and the wider system from repeatedly interacting with an unhealthy dependency.**

And that is the foundation on which the next resilience experiments will build.
