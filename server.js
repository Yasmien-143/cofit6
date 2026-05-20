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
let db = null;

async function initDb() {
  try {
    if (!process.env.DB_HOST) {
      console.log("❌ DB not configured");
      return;
    }

    db = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || "cofit1",
      waitForConnections: true,
      connectionLimit: 5,
    });

    await db.query("SELECT 1");
    console.log("✅ DB connected");
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
    db = null;
  }
}

// =====================
// SAFE JSON PARSE
// =====================
function safeParse(val, fallback) {
  try {
    if (!val) return fallback;
    return typeof val === "string" ? JSON.parse(val) : val;
  } catch {
    return fallback;
  }
}

// =====================
// HEALTH
// =====================
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// =====================
// DB STATUS
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
// BOOTSTRAP (READ DATA)
// =====================
app.get("/api/bootstrap", async (_req, res) => {
  if (!db) {
    return res.status(503).json({ error: "DB not connected" });
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM app_state WHERE id = 1"
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No data found" });
    }

    const row = rows[0];

    res.json({
      members: safeParse(row.members, []),
      trainers: safeParse(row.trainers, []),
      payments: safeParse(row.payments, []),
      sessions: safeParse(row.sessions, []),
      settings: safeParse(row.settings, {}),
      admin: safeParse(row.admin, {}),
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// SYNC (SAVE DATA TO DB) ⭐ IMPORTANT
// =====================
app.post("/api/sync", async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: "DB not connected" });
  }

  try {
    const {
      members = [],
      trainers = [],
      payments = [],
      sessions = [],
      settings = {},
      admin = {},
    } = req.body || {};

    await db.query(
      `UPDATE app_state SET
        members = ?,
        trainers = ?,
        payments = ?,
        sessions = ?,
        settings = ?,
        admin = ?
      WHERE id = 1`,
      [
        JSON.stringify(members),
        JSON.stringify(trainers),
        JSON.stringify(payments),
        JSON.stringify(sessions),
        JSON.stringify(settings),
        JSON.stringify(admin),
      ]
    );

    res.json({ ok: true, message: "Data saved to database" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================
// STATIC FRONTEND
// =====================
app.use(express.static(path.join(__dirname, "dist")));

app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// =====================
// START SERVER
// =====================
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});
