const http = require("http");

const IDEMPOTENCY_KEY = "order-payment-123";

function sendPayment() {
  return new Promise((resolve, reject) => {
    console.log("\n📤 Sending payment request");

    const request = http.request(
      {
        hostname: "localhost",
        port: 3001,
        path: "/payments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
        },
      },
      (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          console.log(`📨 Response: HTTP ${response.statusCode}`);
          console.log(body);

          resolve();
        });
      }
    );

    request.on("error", reject);

    request.end();
  });
}

sendPayment();