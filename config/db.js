import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_PORT:", process.env.DB_PORT);

const pool = mysql.createPool({
  host: process.env.DB_HOST,        // MUST be mysql.railway.internal
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT), // MUST be 3306
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test connection immediately
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log("✅ Connected to MySQL Database");
    conn.release();
  } catch (err) {
    console.error("❌ Database connection failed:", err);
  }
})();

export default pool;
