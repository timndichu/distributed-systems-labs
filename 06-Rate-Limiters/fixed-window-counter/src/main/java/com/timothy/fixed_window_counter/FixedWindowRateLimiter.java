package com.timothy.fixed_window_counter;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Implements a fixed-window rate limiter that restricts the number
 * of requests a client can make within a predefined time window.
 *
 * <p>
 * Each client has an independent request counter. The counter
 * resets automatically when the current fixed time window changes.
 *
 * <p>
 * For example, with a limit of 5 requests and a window of
 * 10 seconds, each client can make up to 5 requests per 10-second
 * window. Any additional requests within that window are rejected.
 *
 * <p>
 * This implementation is thread-safe for concurrent requests
 * from multiple clients and uses in-memory storage. It is intended
 * for a single application instance, not a distributed deployment.
 */

@SpringBootApplication
public class FixedWindowRateLimiter {

	private final int maxRequests; 

	private final long windowSizeMillis;

	/**
	 * Stores the current window and request count for each client.
	 *
	 * <p>
	 * The client ID is the map key, while the associated Window
	 * object holds that client's counter and current window ID.
	 *
	 * <p>
	 * ConcurrentHashMap.compute() is used to update each client's
	 * state atomically, preventing concurrent requests from
	 * exceeding the configured limit.
	 */
	private final ConcurrentHashMap<String, Window> clients = new ConcurrentHashMap<>();

	/**
     * Creates a fixed-window rate limiter.
     *
     * @param maxRequests maximum requests allowed per client
     *                    during each window
     * @param windowSizeMillis duration of each window in milliseconds
     * @throws IllegalArgumentException if either value is not positive
     */
    public FixedWindowRateLimiter(
            int maxRequests,
            long windowSizeMillis
    ) {
        if (maxRequests <= 0 || windowSizeMillis <= 0) {
            throw new IllegalArgumentException(
                    "Limit and window must be positive"
            );
        }

        this.maxRequests = maxRequests;
        this.windowSizeMillis = windowSizeMillis;
    }

	/**
	 * Determines whether a request from the specified client
	 * should be allowed.
	 *
	 * <p>
	 * The current fixed window is calculated using the current
	 * epoch time divided by the configured window duration.
	 * This means windows are aligned to the epoch rather than
	 * starting when a client first makes a request.
	 *
	 * <p>
	 * If the client has no recorded state, or its stored window
	 * has expired, a new window is initialized with a count of zero.
	 * The request is then allowed if the counter is below the limit.
	 *
	 * @param clientId unique identifier for the requesting client
	 * @return true if the request is allowed, false otherwise
	 * @throws IllegalArgumentException if clientId is null or blank
	 */
	public boolean allowRequest(String clientId) {
		if (clientId == null || clientId.isBlank()) {
			throw new IllegalArgumentException(
					"Client ID cannot be blank");
		}

		// Calculate which fixed window the current time belongs to.
		long currentWindow = System.currentTimeMillis() / windowSizeMillis;

		/*
		 * compute() returns the updated map value, but we also need
		 * to know whether this particular request was accepted.
		 * AtomicBoolean lets the mapping function communicate that
		 * decision back to the calling method.
		 */
		AtomicBoolean allowed = new AtomicBoolean(false);

		/*
		 * compute() performs the update atomically for this client ID.
		 * Concurrent requests for the same client are serialized
		 * during this update, while requests for different clients
		 * can be processed independently.
		 */
		clients.compute(clientId, (id, window) -> {

			/*
			 * Start a new window if this client has never made
			 * a request or its previous window has expired.
			 */
			if (window == null ||
					window.windowId != currentWindow) {
				window = new Window(currentWindow);
			}

			// Only accept the request if the client is below its limit.
			if (window.requestCount < maxRequests) {
				window.requestCount++;
				allowed.set(true);
			}

			/*
			 * Always return the current window so that its state
			 * remains stored, even when the request is rejected.
			 */
			return window;
		});

		return allowed.get();
	}

	/**
	 * Holds the rate-limiting state for one client in one window.
	 *
	 * <p>
	 * This is an internal implementation detail of the limiter.
	 * Instances are updated only inside the atomic map computation
	 * for their corresponding client ID.
	 */
	private static class Window {

		/**
		 * Identifier of the fixed time window this counter belongs to.
		 */
		private final long windowId;

		/**
		 * Number of accepted requests in this window.
		 */
		private int requestCount;

		/**
		 * Creates a new window with an initial request count of zero.
		 *
		 * @param windowId identifier of the current fixed window
		 */
		private Window(long windowId) {
			this.windowId = windowId;
			this.requestCount = 0;
		}
	}
}