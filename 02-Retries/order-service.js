const http = require("http");

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/orders") {
    console.log("📦 Order received");

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
          console.log("💳 Payment response received");

          res.writeHead(200, {
            "Content-Type": "application/json",
          });

          res.end(
            JSON.stringify({
              orderCreated: true,
              payment: JSON.parse(body),
            })
          );
        });
      }
    );

    paymentRequest.on("timeout", () => {
      console.log("⏰ PAYMENT REQUEST TIMED OUT");

      paymentRequest.destroy();

      res.writeHead(504, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          success: false,
          message: "Payment service timed out",
        })
      );
    });

    paymentRequest.on("error", (error) => {
      console.log("❌ Payment request error:", error.message);
    });

    paymentRequest.end();

    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3000, () => {
  console.log("📦 Order Service running on port 3000");
});