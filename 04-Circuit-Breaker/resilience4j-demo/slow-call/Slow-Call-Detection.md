# Resilience4j Circuit Breaker — Slow-Call Detection Lab

## 1. Overview

This lab extends the Resilience4j Circuit Breaker experiment by exploring an important failure mode:

> A dependency does not have to fail to become unhealthy.

A downstream service can continue returning successful responses while becoming so slow that it consumes threads, connections, and other resources.

```text
Client
  |
  v
Order Service
  |
  v
Payment Service
  |
  |---- 3 seconds ----> SUCCESS
```

Technically the payment request succeeded. From the perspective of the overall system, repeatedly waiting 3 seconds for a dependency may still be a serious problem.

Resilience4j supports **slow-call detection**, allowing the Circuit Breaker to open when too many calls take longer than an acceptable duration.

---

## 2. Relationship to Timeouts

Slow-call detection is closely related to the Timeout concept studied earlier.

### Timeout

A timeout answers:

> "How long are we willing to wait for this individual request?"

```text
Request
   |
   |---- waiting ---->
   |
   X Timeout
```

The individual request is stopped after the configured limit.

### Slow-call detection

Slow-call detection answers:

> "Are too many requests to this dependency taking too long?"

```text
Request 1 ── 3s ── SUCCESS
Request 2 ── 3s ── SUCCESS
Request 3 ── 3s ── SUCCESS
...
```

The requests technically succeed, but the Circuit Breaker can recognize the dependency as unhealthy based on latency.

```text
Timeout
   ↓
Protect one request

Slow-call detection
   ↓
Recognize excessive dependency latency

Circuit Breaker
   ↓
Stop sending traffic when the dependency becomes unhealthy
```

---

## 3. Configuration

The experiment used:

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

        slowCallDurationThreshold: 2s
        slowCallRateThreshold: 50
```

### `slowCallDurationThreshold`

```yaml
slowCallDurationThreshold: 2s
```

A call taking longer than 2 seconds is classified as a **slow call**.

Slow does not mean failed.

For example:

```text
Duration: 3003 ms
Result: SUCCESS
Classification: SLOW CALL
```

### `slowCallRateThreshold`

```yaml
slowCallRateThreshold: 50
```

If at least 50% of calls in the configured window are slow, the Circuit Breaker can open.

With:

```yaml
slidingWindowSize: 10
minimumNumberOfCalls: 10
```

10 calls were used before evaluating the rate.

If all 10 calls are slow:

```text
Slow calls = 10
Total calls = 10

Slow-call rate = 100%
```

Since:

```text
100% >= 50%
```

the Circuit Breaker opens.

---

## 4. Making PaymentService Slow

The delay was made configurable rather than hard-coded.

`PaymentService.java`:

```java
package com.timothy.resilience4j_demo.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    private boolean available = true;

    @Value("${payment.delay:0}")
    private long delay;

    public String processPayment() {

        System.out.println("[PaymentService] processPayment() CALLED");

        if (delay > 0) {
            System.out.println(
                    "[PaymentService] Delaying for " + delay + " ms");

            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();

                throw new RuntimeException(
                        "Payment processing interrupted", e);
            }
        }

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

This gives two independent dimensions:

```text
Payment Service
       |
       +---- available/unavailable
       |
       +---- fast/slow
```

So a service can be:

```text
AVAILABLE + FAST
AVAILABLE + SLOW
UNAVAILABLE
```

---

## 5. Slow-Call Profile

A separate Spring profile was used for the experiment.

`application-slow-call.yml`:

```yaml
payment:
  delay: 3000

resilience4j:
  circuitbreaker:
    instances:
      paymentService:
        slidingWindowSize: 10
        minimumNumberOfCalls: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 10s
        permittedNumberOfCallsInHalfOpenState: 1
        slowCallDurationThreshold: 2s
        slowCallRateThreshold: 50
```

The important relationship is:

```text
Payment delay        = 3000 ms
Slow-call threshold  = 2000 ms
```

Therefore every successful payment should be classified as slow.

---

## 6. Starting the Experiment

The slow-call profile was started with:

```powershell
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=slow-call"
```

The quoted argument is important in PowerShell because the unquoted form can be interpreted incorrectly by Maven.

---

## 7. First Experiment — One Slow Successful Call

A single request was measured:

```powershell
Measure-Command {
    Invoke-RestMethod -Method POST http://localhost:8080/orders
}
```

The service logged approximately:

```text
[PaymentService] processPayment() CALLED
[PaymentService] Delaying for 3000 ms
[PaymentService] SUCCESS
```

Resilience4j recorded:

```text
CircuitBreaker 'paymentService' succeeded
Elapsed time: 3003 ms
```

The important observation:

```text
Payment result: SUCCESS
Elapsed time: ~3003 ms
Slow threshold: 2000 ms
```

Therefore:

```text
SUCCESS
   +
> 2 seconds
   ↓
SLOW CALL
```

A slow call is not necessarily an error.

---

## 8. Second Experiment — Ten Slow Calls

Enough slow requests were then sent to fill the configured sliding window.

Configuration:

```yaml
slidingWindowSize: 10
minimumNumberOfCalls: 10
slowCallDurationThreshold: 2s
slowCallRateThreshold: 50
```

Each request took roughly 3 seconds and returned successfully:

```text
Call 1   SUCCESS   SLOW
Call 2   SUCCESS   SLOW
Call 3   SUCCESS   SLOW
Call 4   SUCCESS   SLOW
Call 5   SUCCESS   SLOW
Call 6   SUCCESS   SLOW
Call 7   SUCCESS   SLOW
Call 8   SUCCESS   SLOW
Call 9   SUCCESS   SLOW
Call 10  SUCCESS   SLOW
```

The resulting rate:

```text
10 slow calls
---------------- = 100%
10 total calls
```

Configured threshold:

```text
50%
```

Therefore:

```text
100% >= 50%
```

and Resilience4j opened the Circuit Breaker.

Observed log:

```text
CircuitBreaker 'paymentService' changed state from CLOSED to OPEN
```

---

## 9. The Most Important Observation

The Payment Service was not returning errors.

It was returning:

```text
SUCCESS
```

Yet the Circuit Breaker still opened.

The flow was:

```text
Request
   |
   v
Payment Service
   |
   | 3 seconds
   v
SUCCESS
   |
   v
Resilience4j
   |
   | Call classified as SLOW
   v
Sliding Window
   |
   | Too many slow calls
   v
OPEN
```

The Circuit Breaker can therefore protect the system against **degraded latency**, not only explicit failures.

---

## 10. What Happens After the Circuit Opens?

Once the Circuit Breaker entered `OPEN`, subsequent requests were no longer sent to `PaymentService`.

Resilience4j logged:

```text
Event NOT_PERMITTED published
```

The request path changed from:

```text
Order
  ↓
PaymentService
  ↓
3 second wait
  ↓
SUCCESS
```

to:

```text
Order
  ↓
Circuit Breaker
  ↓
OPEN
  ↓
NOT_PERMITTED
  ↓
Fallback
```

The Payment Service was protected from additional traffic while the Circuit Breaker considered it unhealthy.

---

## 11. Failure-Based vs Slow-Call-Based Opening

### Failure-based

```text
Payment request
      |
      v
Payment Service
      |
      X
   FAILURE
      |
      v
Failure rate increases
      |
      v
Circuit opens
```

### Slow-call-based

```text
Payment request
      |
      v
Payment Service
      |
      | 3 seconds
      v
   SUCCESS
      |
      v
Classified as SLOW
      |
      v
Slow-call rate increases
      |
      v
Circuit opens
```

The final state transition is the same:

```text
CLOSED → OPEN
```

The reason is different.

---

## 12. Failure Rate vs Slow-Call Rate

Resilience4j can consider both dimensions:

```yaml
failureRateThreshold: 50
slowCallRateThreshold: 50
```

A dependency can become unhealthy because of:

### Explicit failures

```text
ERROR
ERROR
ERROR
SUCCESS
...
```

or because of:

### Excessive latency

```text
SLOW
SLOW
SLOW
SUCCESS
...
```

Or both:

```text
ERROR
SLOW
ERROR
SLOW
SUCCESS
...
```

This gives the Circuit Breaker a broader view of dependency health.

---

## 13. Why Sliding Windows Matter

The Circuit Breaker evaluates a configured window rather than every request that has ever happened.

In this experiment:

```yaml
slidingWindowSize: 10
```

Conceptually:

```text
[ SLOW ][ SLOW ][ SLOW ][ SLOW ][ SLOW ]
[ SLOW ][ SLOW ][ SLOW ][ SLOW ][ SLOW ]
```

As new calls arrive, older results eventually leave the window.

This lets the Circuit Breaker react to the **recent behavior** of the dependency rather than permanently remembering historical problems.

---

## 14. Why `minimumNumberOfCalls` Matters

The experiment also used:

```yaml
minimumNumberOfCalls: 10
```

This prevents a decision from being based on too little data.

For example, with only one request:

```text
1 slow call
1 total call

Slow rate = 100%
```

A minimum-call requirement makes the decision less sensitive to a single request and gives the Circuit Breaker enough observations before evaluating the rate.

---

## 15. Slow Calls Are Not the Same as Timeouts

These concepts should remain distinct.

### Slow call

The request completes:

```text
Request
  |
  |---- 3 seconds ---->
  |
 SUCCESS
```

The Circuit Breaker can classify it as slow.

### Timeout

The request exceeds the allowed waiting period:

```text
Request
  |
  |---- waiting ---->
  |
  X TIMEOUT
```

A system can use both:

```text
                 ┌──────────────┐
Request ────────>│   Timeout    │
                 └──────┬───────┘
                        │
                        v
                 ┌──────────────┐
                 │ Circuit      │
                 │ Breaker      │
                 └──────────────┘
```

They solve related but different problems.

---

## 16. Why Slow-Call Detection Is Useful

Imagine a payment provider that normally responds in:

```text
200 ms
```

but starts degrading:

```text
500 ms
800 ms
1.2 s
2.5 s
3 s
5 s
```

The provider may still return successful responses.

But the application may begin experiencing:

- requests staying active longer
- more threads being occupied
- connection pools remaining busy
- increased request latency
- queue buildup
- increased resource consumption
- eventually, cascading timeouts

Slow-call detection provides an earlier signal:

```text
Dependency latency increases
        ↓
More calls become slow
        ↓
Slow-call rate crosses threshold
        ↓
Circuit opens
        ↓
Traffic stops reaching dependency
```

The goal is to prevent sustained latency degradation from consuming resources indefinitely.

---

## 17. Production Consideration

The values used in this lab are intentionally simple:

```yaml
slowCallDurationThreshold: 2s
slowCallRateThreshold: 50
slidingWindowSize: 10
minimumNumberOfCalls: 10
```

Production thresholds should be based on the actual dependency's latency characteristics and business requirements.

A 2-second response may be unacceptable for one API but normal for another.

Circuit Breaker thresholds should therefore be configured around observed service behavior rather than arbitrary numbers.

---

## 18. What We Learned

Initially:

```text
Circuit Breaker
      |
      v
Detect failures
```

Now:

```text
Circuit Breaker
      |
      +---- Failure rate
      |
      +---- Slow-call rate
```

The broader model is:

```text
                 Dependency
                     |
          ┌──────────┴──────────┐
          |                     |
       FAILURES              LATENCY
          |                     |
          v                     v
   Failure rate           Slow-call rate
          |                     |
          └──────────┬──────────┘
                     |
                     v
              Circuit Breaker
                     |
          ┌──────────┴──────────┐
          |                     |
       CLOSED                 OPEN
                                 |
                                 v
                           Fail fast
```

---

## 19. Final State Machine

```text
                    failures / slow calls
                           |
                           v
                      ┌─────────┐
                      │ CLOSED  │
                      └────┬────┘
                           |
                    threshold exceeded
                           |
                           v
                      ┌─────────┐
                      │  OPEN   │
                      └────┬────┘
                           |
                    wait duration
                           |
                           v
                    ┌────────────┐
                    │ HALF_OPEN  │
                    └─────┬──────┘
                          /                          /                     success     failure
                    /                              v             v
               CLOSED           OPEN
```

The transition out of `CLOSED` can now be caused by either:

```text
too many failures
```

or:

```text
too many slow calls
```

---

## 20. Key Takeaways

### 1. Success does not always mean healthy

```text
SUCCESS + high latency
```

can still indicate dependency degradation.

### 2. Slow-call detection is different from timeout

```text
Timeout
→ limits how long an individual request waits.

Slow-call detection
→ detects a pattern of excessive latency.

Circuit Breaker
→ stops traffic when dependency health deteriorates.
```

### 3. Sliding windows make decisions about recent behavior

The Circuit Breaker evaluates a bounded set of recent calls instead of the entire history.

### 4. Minimum calls prevent premature decisions

The Circuit Breaker should have enough observations before calculating a rate.

### 5. OPEN means fail fast

After opening:

```text
Request
   ↓
Circuit Breaker
   ↓
NOT_PERMITTED
   ↓
Fallback
```

The downstream service is not called.

---

## 21. Circuit Breaker Lab Status

At this point the Circuit Breaker lab has covered:

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

## 22. Next Step

The Circuit Breaker concept is now sufficiently explored for this lab.

The next practical exercise is to combine the resilience patterns studied so far:

```text
Timeout
   +
Retry
   +
Idempotency
   +
Circuit Breaker
```

The goal will be to understand how these mechanisms interact rather than treating them as isolated patterns.

---

## Final Takeaway

The biggest lesson from the slow-call experiment is:

> A dependency can be technically successful and still be unhealthy for the system.

A Circuit Breaker can detect that degradation:

```text
Successful but slow calls
          ↓
Slow-call rate increases
          ↓
Threshold exceeded
          ↓
Circuit opens
          ↓
Future requests fail fast
```

That is an important step beyond simply detecting errors.

The Circuit Breaker is not only asking:

> "Is the dependency failing?"

It can also ask:

> "Is the dependency taking too long often enough that continuing to call it is becoming harmful?"
