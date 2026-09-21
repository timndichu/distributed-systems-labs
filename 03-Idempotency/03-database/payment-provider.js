const http = require("http");

const PORT = 4000;

// Simulates the payment provider's own durable state
const payments = new Map();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
  });

  res.end(JSON.stringify(data));
}

async function handlePayment(req, res) {
  const idempotencyKey = req.headers["idempotency-key"];

  console.log("\n=================================");
  console.log("💳 PAYMENT PROVIDER");
  console.log(`🔑 Idempotency-Key: ${idempotencyKey}`);
  console.log("=================================");

  if (!idempotencyKey) {
    sendJson(res, 400, {
      success: false,
      message: "Idempotency-Key is required",
    });

    return;
  }

  // Provider already processed this payment
  if (payments.has(idempotencyKey)) {
    console.log("♻️ Payment already exists");

    const existingPayment = payments.get(idempotencyKey);

    sendJson(res, 200, existingPayment);

    return;
  }

  console.log("🆕 New payment");

  await new Promise((resolve) => {
    setTimeout(resolve, 3000);
  });

  const payment = {
    success: true,
    paymentId: `provider-payment-${Date.now()}`,
    message: "Payment processed by provider",
  };

  // Provider records the payment
  payments.set(idempotencyKey, payment);

  console.log("💰 Payment completed");
  console.log("💾 Provider stored payment");

  sendJson(res, 200, payment);
}

function handlePaymentStatus(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const idempotencyKey = url.searchParams.get("idempotencyKey");

  console.log("\n🔎 Payment status lookup");
  console.log(`🔑 Idempotency-Key: ${idempotencyKey}`);

  if (!payments.has(idempotencyKey)) {
    sendJson(res, 404, {
      success: false,
      message: "Payment not found",
    });

    return;
  }

  const payment = payments.get(idempotencyKey);

  sendJson(res, 200, payment);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/payments") {
    await handlePayment(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/payments/status")) {
    handlePaymentStatus(req, res);
    return;
  }

  sendJson(res, 404, {
    success: false,
    message: "Not found",
  });
});

server.listen(PORT, () => {
  console.log(`💳 Payment Provider running on port ${PORT}`);
});