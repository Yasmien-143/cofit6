import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ======================
// Middleware
// ======================
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

// ======================
// DB Pool
// ======================
let dbPool = null;

// ======================
// Helpers
// ======================
function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? value
    : {};
}

// ======================
// Initialize Database
// ======================
async function initDb() {
  const {
    DB_HOST,
    DB_PORT,
    DB_USER,
    DB_PASSWORD,
    DB_NAME = 'cofit1',
    DB_SSL = 'true',
  } = process.env;

  if (!DB_HOST || !DB_PORT || !DB_USER || !DB_PASSWORD) {
    throw new Error('Missing DB environment variables');
  }

  dbPool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl:
      DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
  });

  // Create table
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY,
      members JSON NOT NULL,
      trainers JSON NOT NULL,
      payments JSON NOT NULL,
      sessions JSON NOT NULL,
      settings JSON NOT NULL,
      admin JSON NOT NULL,
      version BIGINT DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Create default admin password hash
  const passwordHash = await bcrypt.hash('adminpassword', 10);

  // Insert initial row if missing
  await dbPool.query(
    `
    INSERT IGNORE INTO app_state (
      id,
      members,
      trainers,
      payments,
      sessions,
      settings,
      admin
    )
    VALUES (
      1,
      JSON_ARRAY(),
      JSON_ARRAY(),
      JSON_ARRAY(),
      JSON_ARRAY(),
      JSON_OBJECT(),
      JSON_OBJECT(
        'email', 'admin@cofit.com',
        'passwordHash', ?
      )
    )
    `,
    [passwordHash]
  );

  console.log('Database initialized');
}

// ======================
// Static Frontend
// ======================
app.use(express.static(path.join(__dirname, 'dist')));

// ======================
// Health Check
// ======================
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ======================
// DB Status
// ======================
app.get('/api/db-status', async (_req, res) => {
  if (!dbPool) {
    return res.status(503).json({
      connected: false,
      reason: 'Database not configured',
    });
  }

  try {
    const [rows] = await dbPool.query(
      'SELECT 1 AS ok'
    );

    return res.json({
      connected: true,
      result: rows,
    });
  } catch (error) {
    return res.status(500).json({
      connected: false,
      error: error.message,
    });
  }
});

// ======================
// Bootstrap App State
// ======================
app.get('/api/bootstrap', async (_req, res) => {
  if (!dbPool) {
    return res.status(503).json({
      error: 'Database not configured',
    });
  }

  try {
    const [rows] = await dbPool.query(
      'SELECT * FROM app_state WHERE id = 1 LIMIT 1'
    );

    if (!rows.length) {
      return res.status(404).json({
        error: 'State not found',
      });
    }

    const row = rows[0];

    return res.json({
      members:
        typeof row.members === 'string'
          ? JSON.parse(row.members)
          : row.members,

      trainers:
        typeof row.trainers === 'string'
          ? JSON.parse(row.trainers)
          : row.trainers,

      payments:
        typeof row.payments === 'string'
          ? JSON.parse(row.payments)
          : row.payments,

      sessions:
        typeof row.sessions === 'string'
          ? JSON.parse(row.sessions)
          : row.sessions,

      settings:
        typeof row.settings === 'string'
          ? JSON.parse(row.settings)
          : row.settings,

      admin:
        typeof row.admin === 'string'
          ? JSON.parse(row.admin)
          : row.admin,

      version: row.version,
      updated_at: row.updated_at,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// ======================
// Sync App State
// ======================
app.post('/api/sync', async (req, res) => {
  if (!dbPool) {
    return res.status(503).json({
      error: 'Database not configured',
    });
  }

  try {
    const payload = req.body || {};

    const members = safeArray(payload.members);
    const trainers = safeArray(payload.trainers);
    const payments = safeArray(payload.payments);
    const sessions = safeArray(payload.sessions);
    const settings = safeObject(payload.settings);
    const admin = safeObject(payload.admin);

    const clientVersion =
      typeof payload.version === 'number'
        ? payload.version
        : 0;

    // Check current version
    const [rows] = await dbPool.query(
      'SELECT version FROM app_state WHERE id = 1 LIMIT 1'
    );

    const currentVersion = rows[0]?.version || 0;

    // Prevent overwrite conflicts
    if (clientVersion !== currentVersion) {
      return res.status(409).json({
        error: 'Version conflict',
        currentVersion,
      });
    }

    // Save state
    await dbPool.query(
      `
      UPDATE app_state
      SET
        members = ?,
        trainers = ?,
        payments = ?,
        sessions = ?,
        settings = ?,
        admin = ?,
        version = version + 1
      WHERE id = 1
      `,
      [
        JSON.stringify(members),
        JSON.stringify(trainers),
        JSON.stringify(payments),
        JSON.stringify(sessions),
        JSON.stringify(settings),
        JSON.stringify(admin),
      ]
    );

    return res.json({
      ok: true,
      newVersion: currentVersion + 1,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// ======================
// Login Endpoint
// ======================
app.post('/api/login', async (req, res) => {
  if (!dbPool) {
    return res.status(503).json({
      error: 'Database not configured',
    });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password required',
      });
    }

    const [rows] = await dbPool.query(
      'SELECT admin FROM app_state WHERE id = 1 LIMIT 1'
    );

    if (!rows.length) {
      return res.status(404).json({
        error: 'Admin not found',
      });
    }

    const admin =
      typeof rows[0].admin === 'string'
        ? JSON.parse(rows[0].admin)
        : rows[0].admin;

    const validEmail = email === admin.email;

    const validPassword = await bcrypt.compare(
      password,
      admin.passwordHash
    );

    if (!validEmail || !validPassword) {
      return res.status(401).json({
        error: 'Invalid credentials',
      });
    }

    return res.json({
      ok: true,
      user: {
        email: admin.email,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
});

// ======================
// SPA Fallback
// ======================
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(
    path.join(__dirname, 'dist', 'index.html')
  );
});

// ======================
// Graceful Shutdown
// ======================
async function shutdown() {
  console.log('Shutting down server...');

  try {
    if (dbPool) {
      await dbPool.end();
      console.log('Database pool closed');
    }

    process.exit(0);
  } catch (error) {
    console.error('Shutdown error:', error);
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ======================
// Start Server
// ======================
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Server running on http://localhost:${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      'Failed to initialize server:',
      error
    );
    process.exit(1);
  });
