/** This service will:

1. Claim the idempotency key.
2. Call the payment provider.
3. Simulate a crash after the provider succeeds.
4. Restart.
5. Detect the stale PROCESSING record.
6. Ask the provider what happened.
7. Recover the result.
8. Mark our database COMPLETED.
*/

const http = require("http");
const pool = require("./db");

const PORT = 3001;
const PAYMENT_PROVIDER_PORT = 4000;

async function getPaymentStatus(idempotencyKey) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "localhost",
        port: PAYMENT_PROVIDER_PORT,
        path: `/payments/status?idempotencyKey=${encodeURIComponent(
          idempotencyKey
        )}`,
        method: "GET",
      },
      (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode === 404) {
            resolve(null);
            return;
          }

          resolve(JSON.parse(body));
        });
      }
    );

    request.on("error", reject);

    request.end();
  });
}

async function makePayment(idempotencyKey) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "localhost",
        port: PAYMENT_PROVIDER_PORT,
        path: "/payments",
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      },
      (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          resolve(JSON.parse(body));
        });
      }
    );

    request.on("error", reject);

    request.end();
  });
}

async function handlePayment(req, res) {
  const idempotencyKey = req.headers["idempotency-key"];

  console.log("\n=================================");
  console.log("🏦 PAYMENT SERVICE");
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
      console.log("♻️ Existing idempotency record");

      const result = await pool.query(
        `
        SELECT *
        FROM idempotency_keys
        WHERE idempotency_key = $1;
        `,
        [idempotencyKey]
      );

      const existing = result.rows[0];

      console.log(`📊 Status: ${existing.status}`);

      if (existing.status === "COMPLETED") {
        console.log("✅ Already completed");

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(JSON.stringify(existing.result));

        return;
      }

      if (existing.status === "PROCESSING") {
        console.log("⚠️ Found PROCESSING record");
        console.log("🔎 Checking payment provider...");

        const providerPayment = await getPaymentStatus(idempotencyKey);

        if (providerPayment) {
          console.log("💰 Provider confirms payment exists");
          console.log("♻️ Recovering payment result");

          await pool.query(
            `
            UPDATE idempotency_keys
            SET
              status = 'COMPLETED',
              result = $1,
              updated_at = CURRENT_TIMESTAMP
            WHERE idempotency_key = $2;
            `,
            [providerPayment, idempotencyKey]
          );

          console.log("✅ Idempotency record recovered");

          res.writeHead(200, {
            "Content-Type": "application/json",
          });

          res.end(JSON.stringify(providerPayment));

          return;
        }

        console.log("❓ Provider has no record of payment");

        res.writeHead(409, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: false,
            message: "Payment outcome is still uncertain",
          })
        );

        return;
      }
    }

    console.log("🔒 Idempotency key claimed");
    console.log("📊 Status: PROCESSING");

    console.log("💳 Calling payment provider...");

    const paymentResult = await makePayment(idempotencyKey);

    console.log("💰 Provider returned:");
    console.log(paymentResult);

    /*
     * IMPORTANT:
     *
     * We deliberately crash here.
     *
     * The provider has completed the payment,
     * but our database still says PROCESSING.
     */

    console.log("\n💥 SIMULATING SERVICE CRASH");

    process.exit(1);
  } catch (error) {
    console.error("❌ Error:", error);
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
  console.log(`🏦 Recovery payment service running on ${PORT}`);
});