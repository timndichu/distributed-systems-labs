const http = require("http");

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/payments") {
    console.log("💰 Payment request received");
    console.log("⏳ Processing payment...");

    setTimeout(() => {
      console.log("✅ Payment processed");

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          success: true,
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