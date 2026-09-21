require("dotenv").config();

const { Pool } = require("pg");


const POSTGRESPASS = process.env.POSTGRESPASS;

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "idempotency_lab",
  user: "postgres",
  password: POSTGRESPASS,
});

module.exports = pool;