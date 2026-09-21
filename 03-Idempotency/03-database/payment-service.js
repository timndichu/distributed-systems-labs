const http = require("http");
const pool = require("./db");

const PORT = process.env.PORT || 3001;
const INSTANCE = process.env.INSTANCE || "payment-service-1";

async function handlePayment(req, res) {
  const idempotencyKey = req.headers["idempotency-key"];

  console.log("\n=================================");
  console.log(`💰 ${INSTANCE}`);
  console.log(`🔑 Idempotency-Key: ${idempotencyKey}`);
  console.log("=================================");

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

  try {
    // Try to atomically claim the idempotency key
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

    // Another instance already claimed this key
    if (insertResult.rowCount === 0) {
      console.log("♻️ Idempotency key already exists");

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

      if (existingPayment.status === "PROCESSING") {
        console.log("🚫 Payment already being processed");

        res.writeHead(409, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: false,
            message: "Payment is already being processed",
          })
        );

        return;
      }

      if (existingPayment.status === "COMPLETED") {
        console.log("✅ Payment already completed");
        console.log("📦 Returning stored result");

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(JSON.stringify(existingPayment.result));

        return;
      }
    }

    // We successfully claimed the idempotency key
    console.log("🔒 Idempotency key successfully claimed");
    console.log("📊 Status: PROCESSING");
    console.log("⏳ Processing payment...");

    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });

    const paymentResult = {
      success: true,
      paymentId: `payment-${Date.now()}`,
      message: "Payment processed",
      processedBy: INSTANCE,
    };

    // Store the completed result
    await pool.query(
      `
      UPDATE idempotency_keys
      SET
        status = 'COMPLETED',
        result = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE idempotency_key = $2;
      `,
      [paymentResult, idempotencyKey]
    );

    console.log("✅ Payment processed");
    console.log("💾 Result stored in database");
    console.log("📊 Status: COMPLETED");

    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(JSON.stringify(paymentResult));
  } catch (error) {
    console.error("❌ Error:", error);

    res.writeHead(500, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        success: false,
        message: "Internal server error",
      })
    );
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
  console.log(`💰 ${INSTANCE} running on port ${PORT}`);
});