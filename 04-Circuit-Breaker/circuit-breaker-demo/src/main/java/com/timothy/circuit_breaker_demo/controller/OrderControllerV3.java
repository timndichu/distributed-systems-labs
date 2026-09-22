package com.timothy.circuit_breaker_demo.controller;

import com.timothy.circuit_breaker_demo.service.OrderServiceV3;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders/v3")
public class OrderControllerV3 {

    private final OrderServiceV3 orderService;

    public OrderControllerV3(OrderServiceV3 orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public String createOrder() {

        return orderService.createOrder();
    }
}