import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import pool from "./config/db.js";   // 🔥 PostgreSQL pool import
import authRoutes from "./routes/auth.routes.js";

dotenv.config();

const app = express();
 
app.use(cors());
app.use(express.json());
 
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      success: true,
      time: result.rows[0],
    });
  } catch (error) {
    console.error("DB Test Error:", error);
    res.status(500).json({
      success: false,
      message: "DB connection failed",
    });
  }
});
 
app.use("/api/auth", authRoutes);
 
app.listen(5000, async () => {
  try {
    await pool.connect(); // 🔥 ensure DB connected
    console.log("✅ PostgreSQL Connected");
    console.log("🚀 Server running on port 5000");
  } catch (err) {
    console.error("❌ DB Connection Error:", err);
  }
});