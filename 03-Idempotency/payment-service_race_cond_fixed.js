const http = require("http");

const payments = new Map();

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/payments") {
    const idempotencyKey = req.headers["idempotency-key"];

    console.log("\n💰 Payment request received");
    console.log(`🔑 Idempotency-Key: ${idempotencyKey}`);

    if (!idempotencyKey) {
      res.writeHead(400, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          success: false,
          message: "Idempotency-Key is required",
        })
      );

      return;
    }

    // Check whether this logical operation already exists
    const existingPayment = payments.get(idempotencyKey);

    if (existingPayment) {
      console.log("♻️ Existing idempotency record found");
      console.log(`📊 Status: ${existingPayment.status}`);

      // The original request is still processing
      if (existingPayment.status === "PROCESSING") {
        console.log("⏳ Payment is already being processed");
        console.log("🚫 NOT starting another payment");

        res.writeHead(409, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: false,
            message: "Payment is already being processed",
          })
        );

        return;
      }

      // The original request has completed
      if (existingPayment.status === "COMPLETED") {
        console.log("✅ Payment already completed");
        console.log("📦 Returning stored result");

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(JSON.stringify(existingPayment.result));

        return;
      }
    }

    /*
     * IMPORTANT:
     *
     * Reserve the idempotency key BEFORE processing.
     *
     * This closes the race-condition window.
     */
    payments.set(idempotencyKey, {
      status: "PROCESSING",
    });

    console.log("🆕 New payment request");
    console.log("🔒 Idempotency key reserved");
    console.log("📊 Status: PROCESSING");
    console.log("⏳ Processing payment...");

    setTimeout(() => {
      const paymentResult = {
        success: true,
        paymentId: `payment-${Date.now()}`,
        message: "Payment processed",
      };

      payments.set(idempotencyKey, {
        status: "COMPLETED",
        result: paymentResult,
      });

      console.log("✅ Payment processed");
      console.log("💾 Result stored");
      console.log("📊 Status: COMPLETED");

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(JSON.stringify(paymentResult));
    }, 5000);

    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3001, () => {
  console.log("💰 Payment Service running on port 3001");
});