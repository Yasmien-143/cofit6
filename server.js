import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// =====================
// DB CONNECTION
// =====================
let db;

async function initDb() {
  if (!process.env.DB_HOST) {
    console.log("DB not configured");
    return;
  }

  db = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "cofit1",
    waitForConnections: true,
    connectionLimit: 5,
  });

  console.log("DB connected");
}

// =====================
// HEALTH CHECK
// =====================
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// =====================
// DB STATUS (IMPORTANT)
// =====================
app.get("/api/db-status", async (_req, res) => {
  if (!db) {
    return res.status(503).json({
      connected: false,
      error: "DB not initialized",
    });
  }

  try {
    const [rows] = await db.query("SELECT 1 AS ok");
    res.json({ connected: true, result: rows });
  } catch (err) {
    res.status(500).json({
      connected: false,
      error: err.message,
    });
  }
});

// =====================
// BOOTSTRAP (FIX YOUR FRONTEND CALL)
// =====================
app.get("/api/bootstrap", async (_req, res) => {
  if (!db) {
    return res.status(503).json({
      error: "DB not configured",
    });
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM app_state WHERE id = 1"
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No state found" });
    }

    const row = rows[0];

    res.json({
      members: JSON.parse(row.members || "[]"),
      trainers: JSON.parse(row.trainers || "[]"),
      payments: JSON.parse(row.payments || "[]"),
      sessions: JSON.parse(row.sessions || "[]"),
      settings: JSON.parse(row.settings || "{}"),
      admin: JSON.parse(row.admin || "{}"),
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// =====================
// STATIC FRONTEND
// =====================
app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// =====================
// START SERVER
// =====================
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Server failed:", err);
  });
