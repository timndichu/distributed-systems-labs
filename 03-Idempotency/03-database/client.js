const http = require("http");

const IDEMPOTENCY_KEY = "order-payment-123";

function sendPayment(port, instance) {
  return new Promise((resolve, reject) => {
    console.log(`\n📤 Sending request to ${instance}`);

    const request = http.request(
      {
        hostname: "localhost",
        port,
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
          console.log(`📨 ${instance} response:`);
          console.log(`HTTP ${response.statusCode}`);
          console.log(body);

          resolve();
        });
      }
    );

    request.on("error", reject);

    request.end();
  });
}

async function run() {
  await Promise.all([
    sendPayment(3001, "Payment Service 1"),
    sendPayment(3002, "Payment Service 2"),
  ]);
}

run();