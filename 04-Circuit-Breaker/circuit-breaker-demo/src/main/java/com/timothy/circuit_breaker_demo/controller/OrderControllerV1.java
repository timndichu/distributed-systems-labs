package com.timothy.circuit_breaker_demo.controller;

import com.timothy.circuit_breaker_demo.service.OrderService;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders/v1")
public class OrderControllerV1 {

    private final OrderService orderService;

    public OrderControllerV1(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public String createOrder() {

        return orderService.createOrder();
    }
}