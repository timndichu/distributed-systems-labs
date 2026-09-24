package com.timothy.bulkheads_demo.controller;

import org.springframework.web.bind.annotation.*;

import com.timothy.bulkheads_demo.service.PaymentService;

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