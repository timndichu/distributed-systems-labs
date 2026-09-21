const http = require("http");

function makePaymentRequest(attempt) {
  return new Promise((resolve, reject) => {
    console.log(`💳 Attempt ${attempt}: Sending payment request`);

    const paymentRequest = http.request(
      {
        hostname: "localhost",
        port: 3001,
        path: "/payments",
        method: "POST",
        timeout: 2000,
      },
      (paymentResponse) => {
        let body = "";

        paymentResponse.on("data", (chunk) => {
          body += chunk;
        });

        paymentResponse.on("end", () => {
          resolve(JSON.parse(body));
        });
      }
    );

    paymentRequest.on("timeout", () => {
      console.log(`⏰ Attempt ${attempt}: Request timed out`);

      paymentRequest.destroy();

      reject(new Error("TIMEOUT"));
    });

    paymentRequest.on("error", (error) => {
      reject(error);
    });

    paymentRequest.end();
  });
}

async function processPayment() {
  try {
    return await makePaymentRequest(1);
  } catch (error) {
    if (error.message !== "TIMEOUT") {
      throw error;
    }

    console.log("🔄 Retrying payment...\n");

    return await makePaymentRequest(2);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/orders") {
    console.log("\n📦 Order received");

    try {
      const payment = await processPayment();

      console.log("✅ Payment completed successfully");

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          orderCreated: true,
          payment,
        })
      );
    } catch (error) {
      console.log("❌ Payment failed:", error.message);

      res.writeHead(504, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          orderCreated: false,
          message: "Payment service unavailable",
        })
      );
    }

    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3000, () => {
  console.log("📦 Order Service running on port 3000");
});