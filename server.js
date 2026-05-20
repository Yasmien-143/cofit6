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
// DB (optional safe init)
// =====================
let db;

async function initDb() {
  if (!process.env.DB_HOST) return;

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
// API TEST
// =====================
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// =====================
// Serve Vite build
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
