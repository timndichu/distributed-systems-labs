package com.timothy.resilience4j_demo.service;

import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    private boolean available = true;

    public String processPayment() {

        System.out.println("[PaymentService] processPayment() CALLED");

        if (!available) {
            System.out.println("[PaymentService] FAILING");
            throw new RuntimeException("Payment service is unavailable");
        }

        System.out.println("[PaymentService] SUCCESS");

        return "Payment successful";
    }

    public void setAvailable(boolean available) {
        this.available = available;
    }

    public boolean isAvailable() {
        return available;
    }
}