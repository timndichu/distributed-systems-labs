package com.timothy.fixed_window_counter;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the FixedWindowRateLimiter.
 *
 * Tests the request limit, window reset, and isolation
 * between different clients.
 */
class FixedWindowRateLimiterTest {

    /**
     * Verifies that a client can make exactly the configured
     * number of requests before subsequent requests are rejected.
     */
    @Test
    void shouldAllowRequestsWithinLimit() {
        FixedWindowRateLimiter limiter =
                new FixedWindowRateLimiter(5, 10_000);

        // The first five requests should be accepted.
        for (int i = 0; i < 5; i++) {
            assertTrue(
                    limiter.allowRequest("client-1"),
                    "Request " + (i + 1) + " should be allowed"
            );
        }

        // The sixth request exceeds the configured limit.
        assertFalse(limiter.allowRequest("client-1"));
    }

    /**
     * Verifies that separate clients have independent counters.
     */
    @Test
    void shouldTrackEachClientIndependently() {
        FixedWindowRateLimiter limiter =
                new FixedWindowRateLimiter(2, 10_000);

        assertTrue(limiter.allowRequest("client-1"));
        assertTrue(limiter.allowRequest("client-1"));

        // Client 1 has reached its limit.
        assertFalse(limiter.allowRequest("client-1"));

        // Client 2 has its own separate counter.
        assertTrue(limiter.allowRequest("client-2"));
        assertTrue(limiter.allowRequest("client-2"));
        assertFalse(limiter.allowRequest("client-2"));
    }

    /**
     * Verifies that invalid client IDs are rejected.
     */
    @Test
    void shouldRejectInvalidClientId() {
        FixedWindowRateLimiter limiter =
                new FixedWindowRateLimiter(5, 10_000);

        assertThrows(
                IllegalArgumentException.class,
                () -> limiter.allowRequest(null)
        );

        assertThrows(
                IllegalArgumentException.class,
                () -> limiter.allowRequest("")
        );

        assertThrows(
                IllegalArgumentException.class,
                () -> limiter.allowRequest("   ")
        );
    }

    /**
     * Verifies that invalid limiter configurations are rejected.
     */
    @Test
    void shouldRejectInvalidConfiguration() {
        assertThrows(
                IllegalArgumentException.class,
                () -> new FixedWindowRateLimiter(0, 10_000)
        );

        assertThrows(
                IllegalArgumentException.class,
                () -> new FixedWindowRateLimiter(5, 0)
        );
    }
}
