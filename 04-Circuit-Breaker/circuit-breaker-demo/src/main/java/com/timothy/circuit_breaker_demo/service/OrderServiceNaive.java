package com.timothy.circuit_breaker_demo.service;

import org.springframework.stereotype.Service;

@Service
public class OrderServiceNaive {

    private final PaymentService paymentService;

    public OrderServiceNaive(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    public String createOrder() {

        String paymentResult = paymentService.processPayment();

        return "Order created: " + paymentResult;
    }
}