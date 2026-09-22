package com.timothy.circuit_breaker_demo.controller;

import com.timothy.circuit_breaker_demo.service.OrderServiceV2;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders/v2")
public class OrderControllerV2 {

    private final OrderServiceV2 orderService;

    public OrderControllerV2(OrderServiceV2 orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public String createOrder() {

        return orderService.createOrder();
    }
}