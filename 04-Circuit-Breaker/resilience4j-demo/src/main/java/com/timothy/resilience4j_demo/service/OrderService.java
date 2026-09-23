package com.timothy.resilience4j_demo.service;

import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import org.springframework.stereotype.Service;

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

    public String paymentFallback(Exception e) {

        return "Payment service unavailable - "
                + "request rejected by circuit breaker";
    }
}