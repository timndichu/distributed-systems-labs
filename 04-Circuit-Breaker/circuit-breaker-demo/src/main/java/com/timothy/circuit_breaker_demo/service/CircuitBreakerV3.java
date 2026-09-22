package com.timothy.circuit_breaker_demo.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;

public class CircuitBreakerV3 {

    public enum State {
        CLOSED,
        OPEN,
        HALF_OPEN
    }

    private State state = State.CLOSED;

    private final int windowSize;
    private final double failureRateThreshold;
    private final Duration openDuration;

    private final Deque<Boolean> results = new ArrayDeque<>();

    private Instant openedAt;

    private boolean halfOpenProbeInProgress = false;

    public CircuitBreakerV3(
            int windowSize,
            double failureRateThreshold,
            Duration openDuration) {

        this.windowSize = windowSize;
        this.failureRateThreshold = failureRateThreshold;
        this.openDuration = openDuration;
    }

    public synchronized boolean allowRequest() {

        if (state == State.CLOSED) {
            return true;
        }

        if (state == State.OPEN) {

            Duration elapsed = Duration.between(
                    openedAt,
                    Instant.now());

            if (elapsed.compareTo(openDuration) >= 0) {

                state = State.HALF_OPEN;
                halfOpenProbeInProgress = false;

                System.out.println(
                        "[CircuitBreaker] OPEN -> HALF_OPEN");

            } else {

                return false;
            }
        }

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

        if (state == State.HALF_OPEN) {

            state = State.CLOSED;

            results.clear();

            halfOpenProbeInProgress = false;

            System.out.println(
                    "[CircuitBreaker] HALF_OPEN -> CLOSED");

            return;
        }

        recordResult(true);

        evaluateFailureRate();
    }

    public synchronized void recordFailure() {

        if (state == State.HALF_OPEN) {

            state = State.OPEN;

            openedAt = Instant.now();

            halfOpenProbeInProgress = false;

            System.out.println(
                    "[CircuitBreaker] HALF_OPEN -> OPEN");

            return;
        }

        recordResult(false);

        evaluateFailureRate();
    }

    private void recordResult(boolean success) {

        if (results.size() == windowSize) {
            results.removeFirst();
        }

        results.addLast(success);
    }

    private void evaluateFailureRate() {

        if (results.size() < windowSize) {
            return;
        }

        long failures = results.stream()
                .filter(result -> !result)
                .count();

        double failureRate =
                (double) failures / results.size();

        System.out.println(
                "[CircuitBreaker] Failure rate: "
                        + (failureRate * 100) + "%");

        if (failureRate >= failureRateThreshold) {

            state = State.OPEN;

            openedAt = Instant.now();

            System.out.println(
                    "[CircuitBreaker] CLOSED -> OPEN");
        }
    }

    public synchronized State getState() {
        return state;
    }

    public synchronized double getFailureRate() {

        if (results.isEmpty()) {
            return 0.0;
        }

        long failures = results.stream()
                .filter(result -> !result)
                .count();

        return (double) failures / results.size();
    }
}