package com.timothy.bulkheads_demo.controller;

import org.springframework.web.bind.annotation.*;

import com.timothy.bulkheads_demo.service.OrderService;

@RestController
@RequestMapping("/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public String createOrder() {

        return orderService.createOrder();
    }
}