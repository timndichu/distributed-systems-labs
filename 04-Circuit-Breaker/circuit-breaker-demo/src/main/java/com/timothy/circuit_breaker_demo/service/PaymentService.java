package com.timothy.circuit_breaker_demo.service;

import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    private boolean available = true;

    public String processPayment() {

        if (!available) {
            throw new RuntimeException("Payment service is unavailable");
        }

        return "Payment successful";
    }

    public void setAvailable(boolean available) {
        this.available = available;
    }

    public boolean isAvailable() {
        return available;
    }
}