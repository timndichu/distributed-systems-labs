package com.timothy.resilience4j_demo.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    private boolean available = true;

    @Value("${payment.delay:0}")
    private long delay;

    public String processPayment() {

        System.out.println("[PaymentService] processPayment() CALLED");

        // added for V2 - Testing delay in processing time
         if (delay > 0) {
            System.out.println(
                    "[PaymentService] Delaying for " + delay + " ms");

            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException(
                        "Payment processing interrupted", e);
            }
        }

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