const http = require("http");

const processedPayments = new Map();

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

    // Check whether we have already processed this operation
    if (processedPayments.has(idempotencyKey)) {
      console.log("♻️ Duplicate request detected");
      console.log("📦 Returning previously stored result");

      const previousResult = processedPayments.get(idempotencyKey);

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(JSON.stringify(previousResult));

      return;
    }

    console.log("🆕 New payment request");
    console.log("⏳ Processing payment...");

    setTimeout(() => {
      const paymentResult = {
        success: true,
        paymentId: `payment-${Date.now()}`,
        message: "Payment processed",
      };

      processedPayments.set(idempotencyKey, paymentResult);

      console.log("✅ Payment processed");
      console.log("💾 Result stored against idempotency key");

      console.log(processedPayments);

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