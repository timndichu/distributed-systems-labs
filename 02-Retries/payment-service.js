const http = require("http");

let paymentCount = 0;

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/payments") {
    paymentCount++;

    const currentPayment = paymentCount;

    console.log(`\n💰 Payment request received`);
    console.log(`🆔 Payment operation #${currentPayment}`);
    console.log(`⏳ Processing payment...`);

    setTimeout(() => {
      console.log(`✅ Payment #${currentPayment} processed`);

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          success: true,
          paymentId: currentPayment,
          message: "Payment processed",
        })
      );
    }, 5000);

    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3001, () => {
  console.log("💰 Payment Service running on port 3001");
});