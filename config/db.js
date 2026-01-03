import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306), // 🔥 CRITICAL FIX
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test connection safely
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
