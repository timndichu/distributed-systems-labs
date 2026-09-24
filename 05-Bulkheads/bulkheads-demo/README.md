# Lab 05: Bulkheads

## What is a Bulkhead?

A bulkhead is a mechanism that isolates a part of a system and limits how much work or how many concurrent requests it can handle. This helps prevent one overloaded or failing component from consuming resources needed by the rest of the system.

In our lab, the semaphore bulkhead allowed at most two concurrent requests into the payment operation. The other three requests were rejected immediately with 503 Service Unavailable.

Key distinction: a bulkhead usually limits concurrent in-flight work or resource use—not simply the total number of requests over time. That latter behavior is what a rate limiter controls.

## Overview

This lab explores the **Bulkhead pattern** and how it protects a service from being overwhelmed by concurrent requests to a slow or failing downstream dependency.

The demo uses Spring Boot and Resilience4j. An order endpoint calls a simulated payment service that takes five seconds to respond. A semaphore bulkhead limits how many requests can enter that payment operation at the same time.

## Learning objectives

- Understand how bulkhead isolation limits concurrent work.
- Configure a Resilience4j semaphore bulkhead.
- Observe what happens when incoming requests exceed the configured limit.
- Return a clear `503 Service Unavailable` response when the bulkhead is full.
- Log expected overload rejections as warnings instead of noisy stack traces.

## Tech stack

- Java
- Spring Boot
- Resilience4j
- Maven

## How it works

The order service calls the payment service. The payment service simulates a slow downstream dependency by sleeping for **5 seconds**.

The payment operation is protected by a semaphore bulkhead configured with:

| Setting | Value |
|---|---:|
| Bulkhead type | Semaphore |
| Maximum concurrent calls | 2 |
| Maximum wait duration | 0 |

With this configuration, at most two calls can execute the protected payment operation concurrently. Additional calls are rejected immediately instead of waiting for a slot.

```text
Client requests
      |
      v
  Order endpoint
      |
      v
 Semaphore bulkhead
   /          \
2 slots      Full
   |           |
   v           v
Payment      Reject request
service      with HTTP 503
(5 seconds)
````

## Configuration

The slow-call profile is configured in `application-slow-call.yml`:

YAML

```
payment:
  delay: 5000

resilience4j:
  bulkhead:
    instances:
      payment:
        maxConcurrentCalls: 2
        maxWaitDuration: 0
```

The order service uses the Resilience4j `@Bulkhead` annotation with semaphore mode on the payment operation.

## Error handling and logging

Bulkhead rejections are expected when the service reaches its concurrency limit. The global exception handler catches `BulkheadFullException` and:

* Logs a concise `WARN` message without a stack trace.

* Returns HTTP `503 Service Unavailable`.

* Provides a friendly response message asking the client to try again later.

Unexpected exceptions are handled separately, logged at `ERROR` level with the exception details, and returned as a generic HTTP `500 Internal Server Error`.

This keeps normal overload behavior distinct from unexpected application errors.

## Running the lab

From the `bulkheads-demo` directory, start the application with the slow-call profile:

PowerShell

```
.\mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=slow-call"
```

The application runs on port `8080`.

## Experiment: send concurrent requests

Send five concurrent requests to the order endpoint:

PowerShell

```
$jobs = 1..5 | ForEach-Object {
    Start-Job -ArgumentList $_ -ScriptBlock {
        param($i)

        $start = Get-Date

        try {
            Invoke-RestMethod -Method POST `
                -Uri "http://localhost:8080/orders" | Out-Null

            $status = "SUCCESS"
        }
        catch {
            $status = "FAILED"
            $message = $_.Exception.Message
        }

        $elapsed = (Get-Date) - $start

        [PSCustomObject]@{
            Request = $i
            Status  = $status
            Seconds = [math]::Round($elapsed.TotalSeconds, 2)
            Error   = $message
        }
    }
}

$results = $jobs | Receive-Job -Wait
$jobs | Remove-Job
$results | Sort-Object Request | Format-Table -AutoSize
```

## Observed results

Five requests were sent concurrently. Two were admitted by the bulkhead and completed after the simulated five-second payment delay. The other three were rejected quickly.

|
Request

|

Result

|

Approx. elapsed time

|
| --- | --- | --- |
|

1

|

Success

|

5.21 s

|
|

2

|

Success

|

5.15 s

|
|

3

|

Rejected — HTTP 503

|

0.09 s

|
|

4

|

Rejected — HTTP 503

|

0.03 s

|
|

5

|

Rejected — HTTP 503

|

0.03 s

|

The server logs showed three concise warning messages for the rejected requests and two successful payment completions.

## Key takeaways

1. Bulkheads limit concurrency. The configured limit was two simultaneous payment operations.

2. Excess work was rejected quickly. With `maxWaitDuration: 0`, rejected requests did not wait for a free slot.

3. Overload is handled explicitly. The API returned `503 Service Unavailable` instead of exposing an unhandled exception as a `500`.

4. Expected failures should be logged appropriately. Bulkhead rejections were logged as warnings, while unexpected errors remain error-level events with stack traces.

5. Bulkheads are different from rate limiters. A bulkhead limits simultaneous in-flight work; a rate limiter controls how many requests may be made over a period of time.

## Conclusion

The experiment demonstrated how a semaphore bulkhead can isolate a slow downstream operation from excess concurrent requests. With a limit of two, only two of the five simultaneous requests reached the simulated payment service; the remaining three were rejected promptly with HTTP `503`.

Next lab: Rate Limiting — controlling request volume over time.
