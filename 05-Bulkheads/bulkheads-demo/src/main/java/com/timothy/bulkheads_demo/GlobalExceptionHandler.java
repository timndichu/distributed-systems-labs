package com.timothy.bulkheads_demo;

import io.github.resilience4j.bulkhead.BulkheadFullException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BulkheadFullException.class)
    public ResponseEntity<Map<String, Object>> handleBulkheadFull(
            BulkheadFullException ex) {

        log.warn("Request rejected: payment bulkhead is full");

        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of(
                        "timestamp", Instant.now().toString(),
                        "status", 503,
                        "error", "Service Unavailable",
                        "message", "Payment service is busy. Please try again later."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpected(
            Exception ex) {

        log.error("Unexpected error while processing request", ex);

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of(
                        "timestamp", Instant.now().toString(),
                        "status", 500,
                        "error", "Internal Server Error",
                        "message", "An unexpected error occurred."));
    }
}
