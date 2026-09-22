# Circuit Breaker Lab

A practical system-design lab for understanding the **Circuit Breaker pattern from first principles**.

This lab is part of the `distributed-systems-labs` repository.

## Goal

The goal is to understand why Circuit Breakers exist, how they protect a system from failing dependencies, and how the Circuit Breaker state machine works.

We are intentionally building the pattern ourselves before using a production library such as Resilience4j.

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
Success
```

But if Payment Service becomes unavailable:

```text
Order Service
      |
      v
Payment Service
      |
      X
   Failure
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

A Circuit Breaker helps by temporarily stopping calls to a dependency that is repeatedly failing.

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

Instead of continually calling a failing Payment Service, the Circuit Breaker can **fail fast** and prevent the request from reaching the dependency.

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

A Circuit Breaker normally has three states.

```text
              failure threshold
                     |
                     v
                +---------+
                | CLOSED  |
                +----+----+
                     |
                     | repeated failures
                     v
                +---------+
                |  OPEN   |
                +----+----+
                     |
                     | wait period
                     v
                +---------+
                |HALF-OPEN|
                +----+----+
                     |
             test request
                /        \
           success       failure
              |             |
              v             v
           CLOSED          OPEN
```

## CLOSED

Normal operation.

Requests are allowed to reach the downstream service.

The Circuit Breaker records successes and failures.

Example:

```text
Request 1 -> SUCCESS
Request 2 -> SUCCESS
Request 3 -> FAILURE
Request 4 -> SUCCESS
```

## OPEN

The dependency has experienced enough failures to trip the circuit.

Requests are rejected without calling the downstream service.

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

After a configured waiting period, the Circuit Breaker allows a limited test request through.

If the dependency succeeds:

```text
HALF-OPEN -> CLOSED
```

If it fails:

```text
HALF-OPEN -> OPEN
```

---

# 5. Relationship With Other Failure Patterns

We have already studied:

### Timeout

> Don't wait forever.

```text
Payment
   |
   +--- 5 seconds ---> TIMEOUT
```

### Retry

> A failure may be temporary, so try again.

```text
Payment
   |
   X
   |
 Retry
```

### Idempotency

> If a request is retried, make sure the operation does not accidentally happen multiple times.

### Circuit Breaker

> The dependency is repeatedly failing, so stop calling it temporarily.

These patterns solve different parts of the failure problem.

```text
Timeout
   |
   v
Request fails
   |
   v
Retry (when appropriate)
   |
   v
Repeated failures
   |
   v
Circuit Breaker
   |
   v
Fail fast
```

They should not automatically be applied to every request in every system.

---

# 6. Practical Lab Setup

## Technology

- Java 21 LTS
- Spring Boot 4.1.1
- Maven Wrapper
- Spring Web
- Embedded Tomcat
- Windows 11

The project was created with Spring Initializr.

Project structure:

```text
04-Circuit-Breaker/
└── circuit-breaker-demo/
    ├── src/
    ├── pom.xml
    ├── mvnw
    └── mvnw.cmd
```

The application currently runs on:

```text
http://localhost:8080
```

---

# 7. Current Architecture

At this stage, the application intentionally has **no Circuit Breaker**.

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

The Payment Service is currently implemented inside the same Spring Boot application to keep the first experiment simple.

Later, the lab can evolve into separate services communicating over HTTP.

---

# 8. Payment Service

The Payment Service has a simple availability switch.

Conceptually:

```java
private boolean available = true;
```

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

This gives us a controlled way to simulate a failing dependency.

---

# 9. Failure Simulation

The Payment Controller exposes:

```text
POST /payment/availability/{available}
```

To make Payment unavailable:

```text
POST http://localhost:8080/payment/availability/false
```

To make it available again:

```text
POST http://localhost:8080/payment/availability/true
```

This is only a simulation mechanism for the lab.

---

# 10. Order Endpoint

Orders are created using:

```text
POST http://localhost:8080/orders
```

When Payment is available:

```text
Order created: Payment successful
```

When Payment is unavailable, the current implementation throws an exception.

This is intentional.

We are first observing the failure without any protection.

---

# 11. Current Failure Behaviour

With Payment available:

```text
POST /orders
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

After making Payment unavailable:

```text
POST /orders
       |
       v
Order Service
       |
       v
Payment Service
       |
       X
    FAILURE
```

Calling `/orders` repeatedly continues to call the unhealthy Payment Service.

There is currently nothing that says:

> "Payment has failed repeatedly. Stop calling it."

That is the problem our next implementation will solve.

---

# 12. What We Have Learned So Far

The important mental model is:

> The Circuit Breaker is primarily a **protection mechanism for the caller and the overall system**, not a mechanism for fixing the failing dependency.

If Payment is unhealthy:

```text
Payment Service
      X
      |
      v
Circuit Breaker
      |
      v
Protect Order Service
```

The Circuit Breaker does not repair Payment.

It limits the impact of Payment's failure.

---

# 13. Next Step

The next implementation will introduce our own `CircuitBreaker` class.

Initial configuration:

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

We will then deliberately test:

1. Three failed requests
2. Circuit opening
3. A fourth request being rejected immediately
4. Waiting for the open duration
5. Transitioning to HALF-OPEN
6. Successful recovery
7. Returning to CLOSED

After that, we will deliberately identify weaknesses in our first implementation and improve it toward production-grade behaviour.

---

## Learning Philosophy

This lab intentionally follows:

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
Compare with production libraries
```

The goal is understanding the underlying distributed-systems concepts rather than memorizing framework annotations.
