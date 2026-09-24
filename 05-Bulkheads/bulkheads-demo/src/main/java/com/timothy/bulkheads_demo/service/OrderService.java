package com.timothy.bulkheads_demo.service;

import io.github.resilience4j.bulkhead.annotation.Bulkhead;
// import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    private final PaymentService paymentService;

    public OrderService(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

     @Bulkhead(
        name = "payment",
        type = Bulkhead.Type.SEMAPHORE
    )
    public String createOrder() {

        String paymentResult =
                paymentService.processPayment();

        return "Order created: " + paymentResult;
    }

    // public String paymentFallback(Exception e) {

    //     return "Payment service unavailable - "
    //             + "request rejected by circuit breaker";
    // }
}