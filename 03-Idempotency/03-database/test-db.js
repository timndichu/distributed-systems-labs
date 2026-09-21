const pool = require("./db");

async function testDatabase() {
  try {
    const result = await pool.query("SELECT current_database()");

    console.log("Connected to:", result.rows[0].current_database);
  } catch (error) {
    console.error("Database connection failed:");
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

testDatabase();