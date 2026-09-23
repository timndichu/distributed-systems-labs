package com.timothy.resilience4j_demo.controller;

import com.timothy.resilience4j_demo.service.PaymentService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/payment")
public class PaymentController {

    private final PaymentService paymentService;

    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @PostMapping("/availability/{available}")
    public String setAvailability(
            @PathVariable boolean available) {

        paymentService.setAvailable(available);

        return available
                ? "Payment service is now AVAILABLE"
                : "Payment service is now UNAVAILABLE";
    }
}