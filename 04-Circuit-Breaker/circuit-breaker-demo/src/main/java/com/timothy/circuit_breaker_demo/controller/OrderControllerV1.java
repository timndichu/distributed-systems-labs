package com.timothy.circuit_breaker_demo.controller;

import com.timothy.circuit_breaker_demo.service.OrderServiceV1;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders/v1")
public class OrderControllerV1 {

    private final OrderServiceV1 orderService;

    public OrderControllerV1(OrderServiceV1 orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public String createOrder() {

        return orderService.createOrder();
    }
}