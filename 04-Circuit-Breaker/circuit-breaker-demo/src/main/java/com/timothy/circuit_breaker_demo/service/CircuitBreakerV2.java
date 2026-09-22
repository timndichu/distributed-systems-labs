package com.timothy.circuit_breaker_demo.service;

import java.time.Duration;
import java.time.Instant;

public class CircuitBreakerV2 {

    public enum State {
        CLOSED,
        OPEN,
        HALF_OPEN
    }

    private State state = State.CLOSED;

    private int failureCount = 0;

    private final int failureThreshold;
    private final Duration openDuration;

    private Instant openedAt;
    private boolean halfOpenProbeInProgress = false;

    public CircuitBreakerV2(int failureThreshold, Duration openDuration) {
        this.failureThreshold = failureThreshold;
        this.openDuration = openDuration;
    }

    public synchronized boolean allowRequest() {

        // CLOSED: allow requests normally
        if (state == State.CLOSED) {
            return true;
        }

        // OPEN: reject requests until the wait period expires
        if (state == State.OPEN) {

            Duration elapsed = Duration.between(
                    openedAt,
                    Instant.now());

            if (elapsed.compareTo(openDuration) >= 0) {

                state = State.HALF_OPEN;
                halfOpenProbeInProgress = false;

                System.out.println(
                        "[CircuitBreaker] OPEN -> HALF_OPEN");

                return true;
            }

            return false;
        }

        // HALF_OPEN
        if (state == State.HALF_OPEN) {

            if (!halfOpenProbeInProgress) {

                halfOpenProbeInProgress = true;

                System.out.println(
                        "[CircuitBreaker] HALF_OPEN probe CLAIMED");

                return true;
            }

            return false;
        }

        return false;
    }

    public synchronized void recordSuccess() {

        failureCount = 0;

        if (state == State.HALF_OPEN) {

            state = State.CLOSED;

            halfOpenProbeInProgress = false;

            System.out.println(
                    "[CircuitBreaker] HALF_OPEN -> CLOSED");

        } else {

            halfOpenProbeInProgress = false;
        }
    }

    public synchronized void recordFailure() {

        halfOpenProbeInProgress = false;

        // A failed HALF_OPEN probe means the dependency
        // has not recovered.
        if (state == State.HALF_OPEN) {

            state = State.OPEN;

            openedAt = Instant.now();

            System.out.println(
                    "[CircuitBreaker] HALF_OPEN -> OPEN");

            return;
        }

        // Normal CLOSED-state failure
        failureCount++;

        if (failureCount >= failureThreshold) {

            state = State.OPEN;

            openedAt = Instant.now();

            System.out.println(
                    "[CircuitBreaker] CLOSED -> OPEN");
        }
    }

    public State getState() {
        return state;
    }

    public int getFailureCount() {
        return failureCount;
    }
}