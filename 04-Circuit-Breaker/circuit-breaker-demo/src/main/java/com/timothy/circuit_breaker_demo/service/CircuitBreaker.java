package com.timothy.circuit_breaker_demo.service;

import java.time.Duration;
import java.time.Instant;

public class CircuitBreaker {

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

    public CircuitBreaker(int failureThreshold, Duration openDuration) {
        this.failureThreshold = failureThreshold;
        this.openDuration = openDuration;
    }

    public boolean allowRequest() {

        // CLOSED: allow requests normally
        if (state == State.CLOSED) {
            return true;
        }

        // OPEN: reject requests until the wait period expires
        if (state == State.OPEN) {

            Duration elapsed = Duration.between(
                    openedAt,
                    Instant.now()
            );

            if (elapsed.compareTo(openDuration) >= 0) {

                state = State.HALF_OPEN;

                return true;
            }

            return false;
        }

        // HALF_OPEN
        return true;
    }

    public void recordSuccess() {

        failureCount = 0;

        state = State.CLOSED;
    }

    public void recordFailure() {

        failureCount++;

        if (failureCount >= failureThreshold) {

            state = State.OPEN;

            openedAt = Instant.now();
        }
    }

    public State getState() {
        return state;
    }

    public int getFailureCount() {
        return failureCount;
    }
}