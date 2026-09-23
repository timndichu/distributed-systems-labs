# Resilience4j Circuit Breaker Lab

## Overview

This lab is the production-library continuation of the homemade Circuit Breaker implementations built earlier in this project.

The goal was not to treat Resilience4j as a black box, but to map its behavior to the Circuit Breaker concepts already implemented manually in V1, V2, and V3.

The progression was:

```text
V1
 └── Basic Circuit Breaker state machine

V2
 └── Thread-safe state management
 └── Controlled HALF_OPEN probe

V3
 └── Failure-rate-based opening
 └── Sliding window
 └── Minimum number of calls

Resilience4j
 └── Production-ready Circuit Breaker implementation
 └── Spring Boot integration
 └── Configuration
 └── Events and observability
```

---

## 1. What We Are Learning

A Circuit Breaker protects a service from repeatedly calling an unhealthy dependency.

The core states are:

```text
CLOSED
  │
  │ failures exceed threshold
  ▼
OPEN
  │
  │ wait duration expires
  ▼
HALF_OPEN
  │
  ├── success ──> CLOSED
  │
  └── failure ──> OPEN
```

The same state machine was implemented manually before introducing Resilience4j.

This made it possible to understand what the framework is doing underneath the annotations.

---

## 2. Project Setup

- Java 21
- Spring Boot 4.1.1
- Maven
- Spring Web
- Resilience4j 2.4.0
- Resilience4j Spring Boot 4 integration

Project:

```text
04-Circuit-Breaker/
│
├── circuit-breaker-demo/
│   └── Homemade Circuit Breaker implementations
│       ├── V1
│       ├── V2
│       └── V3
│
└── resilience4j-demo/
    └── Resilience4j implementation
```

The previous implementations were deliberately preserved rather than overwritten.

---

## 3. Dependency

Because this project uses Spring Boot 4.1.1, the Spring Boot 4 Resilience4j integration was used.

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot4</artifactId>
    <version>2.4.0</version>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aspectj</artifactId>
</dependency>
```

The AspectJ/Spring AOP integration is important because `@CircuitBreaker` is applied through Spring's method interception mechanism.

Without the AOP integration, the annotated method was called normally and the Payment Service exception propagated as HTTP 500.

After adding the AOP integration, Resilience4j intercepted the call and the fallback worked correctly.

---

## 4. Application Architecture

```text
                    ┌─────────────────┐
                    │     Client      │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Order Controller│
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Order Service  │
                    │                 │
                    │ @CircuitBreaker │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Payment Service │
                    └─────────────────┘
```

Payment availability can be manually toggled to simulate a failing dependency.

This is intentionally simple so Circuit Breaker behavior can be observed without introducing network complexity yet.

---

## 5. Payment Service

The Payment Service contains a simple availability flag.

```java
@Service
public class PaymentService {

    private boolean available = true;

    public String processPayment() {

        System.out.println("[PaymentService] processPayment() CALLED");

        if (!available) {
            System.out.println("[PaymentService] FAILING");
            throw new RuntimeException(
                    "Payment service is unavailable");
        }

        System.out.println("[PaymentService] SUCCESS");

        return "Payment successful";
    }

    public void setAvailable(boolean available) {
        this.available = available;
    }

    public boolean isAvailable() {
        return available;
    }
}
```

The logging was added during the experiments to make an important distinction visible:

```text
Circuit OPEN
     ↓
request rejected
     ↓
PaymentService is NOT called
```

versus:

```text
Circuit CLOSED / HALF_OPEN
     ↓
request allowed
     ↓
PaymentService is called
```

---

## 6. Order Service

The Circuit Breaker is applied declaratively.

```java
@Service
public class OrderService {

    private final PaymentService paymentService;

    public OrderService(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @CircuitBreaker(
            name = "paymentService",
            fallbackMethod = "paymentFallback"
    )
    public String createOrder() {

        String paymentResult =
                paymentService.processPayment();

        return "Order created: " + paymentResult;
    }

    public String paymentFallback(Throwable e) {

        return "Payment service unavailable - "
                + "request rejected by circuit breaker";
    }
}
```

This replaces the explicit state-management code from V1/V2/V3.

Previously we manually wrote:

```java
if (!circuitBreaker.allowRequest()) {
    ...
}

try {
    ...
    circuitBreaker.recordSuccess();
} catch (Exception e) {
    circuitBreaker.recordFailure();
}
```

With Resilience4j, the Circuit Breaker is applied through:

```java
@CircuitBreaker(...)
```

The library performs the state management and failure recording.

---

## 7. Circuit Breaker Configuration

`application.yml`:

```yaml
spring:
  application:
    name: resilience4j-demo

resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        slidingWindowSize: 10
        minimumNumberOfCalls: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 10s
        permittedNumberOfCallsInHalfOpenState: 1

logging:
  level:
    io.github.resilience4j.circuitbreaker: DEBUG
```

### Configuration mapping

| Resilience4j setting    | Meaning |
|-------------------------|--------------------------------------------------------|
| `slidingWindowSize: 10` | Evaluate the most recent 10 calls |
| `minimumNumberOfCalls: 10` | Don't evaluate failure rate until at least 10 calls are recorded |
| `failureRateThreshold: 50` | Open when failure rate reaches 50% |
| `waitDurationInOpenState: 10s` | Stay OPEN for at least 10 seconds |
| `permittedNumberOfCallsInHalfOpenState: 1` | Allow one recovery probe |
| DEBUG logging | Expose Circuit Breaker events |

These settings closely correspond to the V3 implementation.

---

## 8. Basic Test

Start the application:

```powershell
.\mvnw.cmd spring-boot:run
```

Test a successful order:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/orders
```

Expected:

```text
Order created: Payment successful
```

---

## 9. Failure Injection

Make Payment unavailable:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/false
```

Expected:

```text
Payment service is now UNAVAILABLE
```

Then call:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/orders
```

The fallback should return:

```text
Payment service unavailable - request rejected by circuit breaker
```

Initially, the application returned HTTP 500 when the Payment Service failed.

The stack trace showed the exception propagating directly through:

```text
PaymentService.processPayment()
        ↓
OrderService.createOrder()
        ↓
OrderController.createOrder()
```

This revealed that the Resilience4j interceptor was not being applied.

After adding the Spring AspectJ dependency, the fallback started working.

Important practical lesson:

> An annotation alone does not guarantee that the framework interception mechanism is correctly configured.

---

## 10. Observing Failure Recording

DEBUG logging was enabled:

```yaml
logging:
  level:
    io.github.resilience4j.circuitbreaker: DEBUG
```

When Payment failed, Resilience4j logged events such as:

```text
CircuitBreaker 'paymentService' recorded an error:
'java.lang.RuntimeException: Payment service is unavailable'
```

and:

```text
CircuitBreaker 'paymentService' recorded an exception as failure
```

The Payment Service logs showed:

```text
[PaymentService] processPayment() CALLED
[PaymentService] FAILING
```

Therefore the observed flow was:

```text
Order Service
     │
     ▼
Resilience4j Circuit Breaker
     │
     │ request permitted
     ▼
Payment Service
     │
     │ failure
     ▼
RuntimeException
     │
     ▼
Resilience4j records failure
     │
     ▼
Fallback
```

This is conceptually equivalent to the manual V3 implementation:

```java
try {
    paymentService.processPayment();
    circuitBreaker.recordSuccess();
} catch (Exception e) {
    circuitBreaker.recordFailure();
}
```

---

## 11. CLOSED → OPEN

Configuration:

```yaml
slidingWindowSize: 10
minimumNumberOfCalls: 10
failureRateThreshold: 50
```

The Circuit Breaker does not simply open after one failure.

It evaluates the failure rate once enough calls have been recorded.

For example:

```text
10 calls
10 failures
0 successes

failure rate = 100%
```

Since:

```text
100% >= 50%
```

the Circuit Breaker can transition:

```text
CLOSED → OPEN
```

The sliding-window concept comes directly from the V3 implementation.

Our homemade implementation maintained:

```java
Deque<Boolean> results
```

and calculated:

```java
failureRate = failures / results.size()
```

Resilience4j provides the production implementation of this concept.

---

## 12. OPEN State

When the Circuit Breaker is OPEN, requests are rejected without calling the Payment Service.

Conceptually:

```text
Client
  │
  ▼
Circuit Breaker
  │
  X──────────── Payment Service
```

Resilience4j exposes this through the `NOT_PERMITTED` event.

Observed log:

```text
Event NOT_PERMITTED published:
CircuitBreaker 'paymentService'
recorded a call which was not permitted.
```

This demonstrates an important property of a Circuit Breaker:

> Once OPEN, the caller stops spending resources on a dependency that is currently considered unhealthy.

This is different from a timeout.

A timeout still makes the downstream call.

An OPEN Circuit Breaker prevents the call from happening at all.

---

## 13. OPEN → HALF_OPEN

The configuration:

```yaml
waitDurationInOpenState: 10s
```

causes Resilience4j to wait before testing the dependency again.

After the wait:

```text
OPEN
  │
  │ wait 10 seconds
  ▼
HALF_OPEN
```

The configuration:

```yaml
permittedNumberOfCallsInHalfOpenState: 1
```

allows only one test request.

This is equivalent to the controlled HALF_OPEN probe implemented manually in V2/V3.

---

## 14. HALF_OPEN Failure

When Payment remained unavailable, the recovery probe failed.

Observed logs:

```text
CircuitBreaker 'paymentService' recorded an error:
'java.lang.RuntimeException: Payment service is unavailable'
```

followed by:

```text
CircuitBreaker 'paymentService'
changed state from HALF_OPEN to OPEN
```

Therefore:

```text
OPEN
  │
  │ wait duration
  ▼
HALF_OPEN
  │
  │ probe fails
  ▼
OPEN
```

This matches the behavior implemented manually in V2.

---

## 15. HALF_OPEN Success

Payment was then restored:

```powershell
Invoke-RestMethod -Method POST http://localhost:8080/payment/availability/true
```

The recovery request produced:

```text
[PaymentService] processPayment() CALLED
[PaymentService] SUCCESS
```

Resilience4j then logged:

```text
Event SUCCESS published:
CircuitBreaker 'paymentService'
recorded a successful call.
```

followed by:

```text
CircuitBreaker 'paymentService'
changed state from HALF_OPEN to CLOSED
```

Therefore:

```text
OPEN
  │
  │ wait duration
  ▼
HALF_OPEN
  │
  │ probe succeeds
  ▼
CLOSED
```

The full lifecycle was successfully observed.

---

## 16. Full State Machine Verified

```text
                    failure rate threshold
                  ┌─────────────────────────┐
                  │                         ▼
               CLOSED ───────────────────> OPEN
                  ▲                          │
                  │                          │ wait duration
                  │                          ▼
                  └──────── success ──── HALF_OPEN
                                             │
                                             │ failure
                                             ▼
                                            OPEN
```

Observed Resilience4j events included:

```text
ERROR
SUCCESS
NOT_PERMITTED
STATE_TRANSITION
```

These events provide more observability than the basic `System.out.println()` statements used in the homemade implementation.

---

## 17. Resilience4j vs Homemade V3

| Concept | Homemade V3 | Resilience4j |
|---|---|---|
| CLOSED | Implemented manually | Built in |
| OPEN | Implemented manually | Built in |
| HALF_OPEN | Implemented manually | Built in |
| Failure rate | Manual calculation | Built in |
| Sliding window | `Deque<Boolean>` | Built in |
| Minimum calls | Manual check | Configuration |
| HALF_OPEN probe | Manual flag | Configurable |
| Thread safety | `synchronized` | Library-managed |
| Failure events | `System.out.println()` | Event system |
| Spring integration | Manual wiring | `@CircuitBreaker` |
| Configuration | Java constructor | `application.yml` |
| Metrics/observability | Not implemented | Supported |
| Slow-call detection | Not implemented | Supported |
| Exception classification | Basic catch | Configurable |

The important lesson is:

> Resilience4j isn't introducing a completely new concept. It is providing a mature implementation of the concepts we already built manually.

---

## 18. Why We Built It Ourselves First

If we had started with:

```java
@CircuitBreaker(name = "paymentService")
```

we could make the application work without understanding what was happening.

By implementing V1 → V2 → V3 first, we can now look at Resilience4j configuration and recognize what it represents.

For example:

```yaml
slidingWindowSize: 10
```

maps to the sliding-window concept from V3.

```yaml
failureRateThreshold: 50
```

maps to the failure-rate calculation.

```yaml
permittedNumberOfCallsInHalfOpenState: 1
```

maps to the controlled recovery probe from V2.

This is the reason the homemade implementations were valuable.

---

## 19. Relationship With Other Resilience Patterns

Circuit Breaker is not a replacement for Timeout, Retry, or Idempotency.

They solve different problems.

```text
Timeout
    ↓
Don't wait forever

Retry
    ↓
Try again when failure may be transient

Idempotency
    ↓
Make repeated operations safe

Circuit Breaker
    ↓
Stop repeatedly calling an unhealthy dependency
```

A realistic service may eventually combine them:

```text
Client
  │
  ▼
Order Service
  │
  ├── Timeout
  │
  ├── Retry
  │
  ├── Circuit Breaker
  │
  ▼
Payment Service
```

The ordering and interaction between these mechanisms will be studied separately.

---

## 20. Current Status

Completed:

- [x] Add Resilience4j to Spring Boot 4.1.1
- [x] Configure Spring AOP integration
- [x] Apply `@CircuitBreaker`
- [x] Configure failure-rate threshold
- [x] Configure sliding window
- [x] Configure minimum number of calls
- [x] Configure OPEN wait duration
- [x] Configure HALF_OPEN permitted calls
- [x] Implement fallback
- [x] Simulate dependency failure
- [x] Observe failure recording
- [x] Observe CLOSED → OPEN
- [x] Observe OPEN request rejection
- [x] Observe OPEN → HALF_OPEN
- [x] Test failed HALF_OPEN recovery
- [x] Test successful HALF_OPEN recovery
- [x] Observe Resilience4j events
- [x] Compare Resilience4j with homemade V1/V2/V3

Not yet covered:

- [ ] Slow-call detection
- [ ] Time-based sliding windows
- [ ] Exception classification
- [ ] Metrics
- [ ] Resilience4j event consumers
- [ ] Real remote Payment Service
- [ ] Timeout + Retry + Circuit Breaker interaction
- [ ] Production configuration considerations

---

## 21. Next Step

The next experiment is **slow-call detection**.

A dependency does not need to fail outright to become unhealthy.

For example:

```text
Payment request
      │
      │ 3 seconds
      ▼
Payment succeeds
```

Technically:

```text
SUCCESS
```

but the dependency may still be degrading the system.

Resilience4j can detect this using:

```yaml
slowCallDurationThreshold
slowCallRateThreshold
```

This connects directly to the Timeout concept studied earlier:

```text
Timeout
  ↓
Limit how long one request waits

Slow-call detection
  ↓
Recognize that a dependency is becoming too slow

Circuit Breaker
  ↓
Stop sending traffic when the dependency becomes unhealthy
```

The next lab will deliberately slow down `PaymentService` and observe the Circuit Breaker reacting to slow calls.

The slow-call experiment is documented separately:

👉 [Slow-Call Detection Lab](./slow-call/Slow-Call-Detection.md)

---

## Final Takeaway

The most important thing learned in this lab is not the annotation:

```java
@CircuitBreaker
```

It is the behavior behind it.

We implemented the behavior manually first, then verified that Resilience4j provides the same core state machine in a production-oriented library:

```text
CLOSED
   ↓
OPEN
   ↓
HALF_OPEN
   ↓
CLOSED / OPEN
```

We also observed that an OPEN Circuit Breaker does something fundamentally different from simply handling an error:

```text
Without Circuit Breaker:

Request → Payment Service → Failure
Request → Payment Service → Failure
Request → Payment Service → Failure
Request → Payment Service → Failure
...

With Circuit Breaker:

Request → Payment Service → Failure
Request → Payment Service → Failure
Request → Payment Service → Failure
                         ↓
                       OPEN
                         ↓
Future requests ──────── X
                         │
                 Payment Service
                 is not called
```

That is the essence of Circuit Breaker protection.
