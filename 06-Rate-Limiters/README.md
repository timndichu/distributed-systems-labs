# Rate Limiters

This lab explores different rate-limiting algorithms used in distributed systems to control request traffic, protect services from overload, and ensure fair resource usage.

## Algorithms

1. **Fixed Window Counter**  
   Limits the number of requests allowed within a fixed time window.

2. **Leaky Bucket**  
   Processes requests at a steady rate to smooth out traffic bursts.

3. **Sliding Window**  
   Tracks requests over a rolling time period to provide more consistent rate limiting.

4. **Token Bucket**  
   Uses replenishing tokens to control request rates while allowing limited bursts.

## Objectives

- Understand how different rate-limiting algorithms work.
- Implement and test each algorithm.
- Compare their behavior under different traffic patterns.
- Explore how rate limiting can be applied in distributed systems.