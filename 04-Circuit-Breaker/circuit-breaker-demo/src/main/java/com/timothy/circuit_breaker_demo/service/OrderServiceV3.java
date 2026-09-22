package com.timothy.circuit_breaker_demo.service;

import java.time.Duration;

import org.springframework.stereotype.Service;

@Service
public class OrderServiceV3 {

    private final PaymentService paymentService;

    private final CircuitBreakerV3 circuitBreaker = new CircuitBreakerV3(
            10,
            0.5,
            Duration.ofSeconds(10));

    public OrderServiceV3(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    public String createOrder() {

        // Ask the circuit breaker if we are allowed
        // to call the payment service.
        if (!circuitBreaker.allowRequest()) {

            return "Payment service unavailable - request rejected by circuit breaker";
        }

        try {

            String paymentResult = paymentService.processPayment();

            // Payment succeeded
            circuitBreaker.recordSuccess();

            return "Order created: " + paymentResult;

        } catch (Exception e) {

            // Payment failed
            circuitBreaker.recordFailure();

            return "Payment failed";
        }
    }
}