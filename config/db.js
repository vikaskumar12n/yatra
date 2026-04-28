// import pkg from "pg";
// import dotenv from "dotenv";

// dotenv.config();

// const { Pool } = pkg;

// // LOCAL DB
// const localPool = new Pool({
//   host: process.env.DB_HOST,
//   port: process.env.DB_PORT,
//   database: process.env.DB_NAME,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASS,
// });

// // AWS DB
// const awsPool = new Pool({
//   host: process.env.LIVE_DB_HOST,
//   port: process.env.DB_PORT,
//   database: process.env.DB_NAME,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASS,
// });

// // test (optional)
// localPool.on("connect", () => console.log("✅ Local DB Ready"));
// awsPool.on("connect", () => console.log("✅ AWS DB Ready"));

// export { localPool, awsPool };

import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

// LOCAL DB
const localPool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

// AWS DB
const awsPool = new Pool({
  host: process.env.LIVE_DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

// 🔥 MAIN SWITCH
const pool =
  process.env.DB_MODE === "aws"
    ? awsPool
    : localPool;

console.log("🔥 Using DB:", process.env.DB_MODE);

export default pool;