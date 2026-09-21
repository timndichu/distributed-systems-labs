const http = require("http");
const pool = require("./db");

const PORT = 3001;

async function handlePayment(req, res) {
  const idempotencyKey = req.headers["idempotency-key"];

  console.log("\n=================================");
  console.log("💥 CRASH SIMULATION SERVICE");
  console.log(`🔑 Idempotency-Key: ${idempotencyKey}`);
  console.log("=================================");

  try {
    const insertResult = await pool.query(
      `
      INSERT INTO idempotency_keys (
        idempotency_key,
        status
      )
      VALUES ($1, 'PROCESSING')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *;
      `,
      [idempotencyKey]
    );

    if (insertResult.rowCount === 0) {
      const existingResult = await pool.query(
        `
        SELECT *
        FROM idempotency_keys
        WHERE idempotency_key = $1;
        `,
        [idempotencyKey]
      );

      const existingPayment = existingResult.rows[0];

      console.log(`📊 Existing status: ${existingPayment.status}`);

      res.writeHead(409, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          success: false,
          message: `Payment is ${existingPayment.status}`,
        })
      );

      return;
    }

    console.log("🔒 Idempotency key claimed");
    console.log("📊 Status: PROCESSING");

    console.log("⏳ Processing payment...");

    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });

    const paymentResult = {
      success: true,
      paymentId: `payment-${Date.now()}`,
      message: "Payment processed",
    };

    // Simulate payment succeeding
    console.log("\n💰 PAYMENT SUCCESSFUL");
    console.log(paymentResult);

    // 💥 Crash before updating DB (marking COMPLETED)
    console.log("\n💥 SERVICE CRASHING...");
    process.exit(1);
  } catch (error) {
    console.error(error);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/payments") {
    await handlePayment(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`💥 Crash simulation service running on port ${PORT}`);
});