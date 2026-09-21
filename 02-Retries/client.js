const http = require("http");

const request = http.request(
  {
    hostname: "localhost",
    port: 3000,
    path: "/orders",
    method: "POST",
  },
  (res) => {
    let body = "";

    res.on("data", (chunk) => {
      body += chunk;
    });

    res.on("end", () => {
      console.log("\n📨 Response from Order Service:");
      console.log(body);
    });
  }
);

request.on("error", (error) => {
  console.log("❌ Request failed:", error.message);
});

request.end();