// ── Pipeline Database Layer ──────────────────────────────────────────────────
// PostgreSQL persistence for DSOP pipeline runs, gates, findings, reviews, audit
// Uses CNPG (CloudNativePG) operator-managed PostgreSQL cluster

const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    console.error("Unexpected database pool error:", err.message);
  });
} else {
  console.warn("[db] DATABASE_URL not set — pipeline database features disabled");
}

// ── Schema Migration ────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY DEFAULT ('run-' || replace(gen_random_uuid()::text, '-', '')),
  app_name TEXT NOT NULL,
  git_url TEXT,
  branch TEXT DEFAULT 'main',
  image_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'git',
  team TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_url TEXT,
  deploy_build_id TEXT,
  security_exceptions JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS pipeline_gates (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  gate_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  summary TEXT,
  tool TEXT,
  report_url TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  raw_output JSONB,
  job_name TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_findings (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  gate_id INTEGER REFERENCES pipeline_gates(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  disposition TEXT,
  mitigation TEXT,
  mitigated_by TEXT,
  mitigated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_reviews (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  reviewer TEXT NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  reviewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_audit_log (
  id SERIAL PRIMARY KEY,
  run_id TEXT REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT,
  detail TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_team ON pipeline_runs(team);
CREATE INDEX IF NOT EXISTS idx_runs_created ON pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gates_run ON pipeline_gates(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_run ON pipeline_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_gate ON pipeline_findings(gate_id);
CREATE INDEX IF NOT EXISTS idx_reviews_run ON pipeline_reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON pipeline_audit_log(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON pipeline_audit_log(created_at DESC);

-- Migration: add security_exceptions column if missing
DO $$ BEGIN
  ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS security_exceptions JSONB DEFAULT '[]'::jsonb;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Migration: add job_name column to pipeline_gates if missing
DO $$ BEGIN
  ALTER TABLE pipeline_gates ADD COLUMN IF NOT EXISTS job_name TEXT;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Migration: add metadata JSONB column for storing security context, port overrides, etc.
DO $$ BEGIN
  ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Migration: add port column for storing the detected/overridden container port
DO $$ BEGIN
  ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS port INTEGER;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Admin audit log — separate from pipeline audit log, tracks admin actions (user/tenant CRUD)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_type TEXT,
  target_name TEXT,
  detail TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);

-- Setup wizard completion tracking
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

// ── Init with retry ─────────────────────────────────────────────────────────

async function initDb() {
  if (!pool) {
    console.warn("[db] Skipping database initialization — DATABASE_URL not configured");
    return;
  }
  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query(SCHEMA_SQL);
        console.log("[db] Pipeline database schema initialized");
        return;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(`[db] Init attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ── Query Helpers ───────────────────────────────────────────────────────────

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

// ── Pipeline Runs ───────────────────────────────────────────────────────────

async function createRun(data) {
  const { rows } = await query(
    `INSERT INTO pipeline_runs (app_name, git_url, branch, image_url, source_type, team, classification, contact, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.appName,
      data.gitUrl || null,
      data.branch || "main",
      data.imageUrl || null,
      data.sourceType || "git",
      data.team,
      data.classification || "UNCLASSIFIED",
      data.contact || null,
      data.createdBy || null,
    ]
  );
  return rows[0];
}

async function getRun(id) {
  const { rows: runs } = await query("SELECT * FROM pipeline_runs WHERE id = $1", [id]);
  if (!runs.length) return null;

  const run = runs[0];

  const [gates, findings, reviews, audit] = await Promise.all([
    query("SELECT * FROM pipeline_gates WHERE run_id = $1 ORDER BY gate_order", [id]),
    query("SELECT * FROM pipeline_findings WHERE run_id = $1 ORDER BY id", [id]),
    query("SELECT * FROM pipeline_reviews WHERE run_id = $1 ORDER BY reviewed_at DESC", [id]),
    query("SELECT * FROM pipeline_audit_log WHERE run_id = $1 ORDER BY created_at DESC", [id]),
  ]);

  return {
    ...run,
    gates: gates.rows,
    findings: findings.rows,
    reviews: reviews.rows,
    audit_log: audit.rows,
  };
}

async function listRuns(filters = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (filters.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(filters.status);
  }
  if (filters.team) {
    conditions.push(`team = $${paramIdx++}`);
    params.push(filters.team);
  }
  if (filters.since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(filters.since);
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const limit = Math.min(parseInt(filters.limit) || 50, 200);
  const offset = parseInt(filters.offset) || 0;

  const { rows } = await query(
    `SELECT * FROM pipeline_runs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*) as total FROM pipeline_runs ${where}`,
    params
  );

  return { runs: rows, total: parseInt(countRows[0].total), limit, offset };
}

async function updateRunStatus(id, status, extras = {}) {
  const setClauses = ["status = $2", "updated_at = NOW()"];
  const params = [id, status];
  let paramIdx = 3;

  for (const [key, value] of Object.entries(extras)) {
    // Only allow known columns
    const allowedColumns = ["deployed_url", "deploy_build_id"];
    const snakeKey = key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
    if (allowedColumns.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIdx++}`);
      params.push(value);
    }
  }

  const { rows } = await query(
    `UPDATE pipeline_runs SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

// ── Pipeline Gates ──────────────────────────────────────────────────────────

async function createGate(runId, gate) {
  const { rows } = await query(
    `INSERT INTO pipeline_gates (run_id, gate_name, short_name, gate_order, status, tool)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [runId, gate.gateName, gate.shortName, gate.gateOrder, gate.status || "pending", gate.tool || null]
  );
  return rows[0];
}

async function updateGate(gateId, updates) {
  const setClauses = [];
  const params = [gateId];
  let paramIdx = 2;

  const allowedFields = ["status", "progress", "summary", "tool", "report_url", "started_at", "completed_at", "raw_output", "job_name"];

  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
    if (allowedFields.includes(snakeKey)) {
      if (snakeKey === "raw_output") {
        setClauses.push(`${snakeKey} = $${paramIdx++}::jsonb`);
        params.push(typeof value === "string" ? value : JSON.stringify(value));
      } else {
        setClauses.push(`${snakeKey} = $${paramIdx++}`);
        params.push(value);
      }
    }
  }

  if (!setClauses.length) return null;

  const { rows } = await query(
    `UPDATE pipeline_gates SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

// ── Pipeline Findings ───────────────────────────────────────────────────────

async function createFinding(data) {
  const { rows } = await query(
    `INSERT INTO pipeline_findings (run_id, gate_id, severity, title, description, location)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.runId, data.gateId || null, data.severity, data.title, data.description || null, data.location || null]
  );
  return rows[0];
}

async function updateFinding(findingId, updates, runId) {
  const setClauses = [];
  const params = [findingId];
  let paramIdx = 2;

  const allowedFields = ["disposition", "mitigation", "mitigated_by", "mitigated_at"];

  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
    if (allowedFields.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIdx++}`);
      params.push(value);
    }
  }

  if (!setClauses.length) return null;

  // L-3: Validate finding belongs to the specified run
  let whereClause = "WHERE id = $1";
  if (runId) {
    whereClause += ` AND run_id = $${paramIdx++}`;
    params.push(runId);
  }

  const { rows } = await query(
    `UPDATE pipeline_findings SET ${setClauses.join(", ")} ${whereClause} RETURNING *`,
    params
  );
  return rows[0] || null;
}

// ── Pipeline Reviews ────────────────────────────────────────────────────────

async function createReview(data) {
  const { rows } = await query(
    `INSERT INTO pipeline_reviews (run_id, reviewer, decision, comment)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.runId, data.reviewer, data.decision, data.comment || null]
  );
  return rows[0];
}

// ── Audit Log ───────────────────────────────────────────────────────────────

async function auditLog(runId, action, actor, detail, metadata) {
  const { rows } = await query(
    `INSERT INTO pipeline_audit_log (run_id, action, actor, detail, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [runId, action, actor || null, detail || null, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0];
}

// ── Stats ───────────────────────────────────────────────────────────────────

async function getStats() {
  const [totalResult, byStatusResult, approvalResult, avgTimeResult] = await Promise.all([
    query("SELECT COUNT(*) as total FROM pipeline_runs"),
    query("SELECT status, COUNT(*) as count FROM pipeline_runs GROUP BY status ORDER BY count DESC"),
    query(`SELECT
             COUNT(*) FILTER (WHERE status = 'approved' OR status = 'deployed') as approved,
             COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
             COUNT(*) as total
           FROM pipeline_runs WHERE status IN ('approved', 'rejected', 'deployed')`),
    query(`SELECT AVG(EXTRACT(EPOCH FROM (r.reviewed_at - p.created_at))) as avg_seconds
           FROM pipeline_reviews r
           JOIN pipeline_runs p ON r.run_id = p.id
           WHERE r.decision = 'approved'`),
  ]);

  const total = parseInt(totalResult.rows[0].total);
  const byStatus = {};
  byStatusResult.rows.forEach((r) => { byStatus[r.status] = parseInt(r.count); });

  const approvalData = approvalResult.rows[0];
  const approvalRate = parseInt(approvalData.total) > 0
    ? (parseInt(approvalData.approved) / parseInt(approvalData.total) * 100).toFixed(1)
    : null;

  const avgReviewSeconds = avgTimeResult.rows[0].avg_seconds
    ? Math.round(parseFloat(avgTimeResult.rows[0].avg_seconds))
    : null;

  return {
    totalRuns: total,
    byStatus,
    approvalRate: approvalRate ? `${approvalRate}%` : "N/A",
    avgReviewTimeSeconds: avgReviewSeconds,
    avgReviewTimeHuman: avgReviewSeconds
      ? avgReviewSeconds < 3600
        ? `${Math.round(avgReviewSeconds / 60)}m`
        : `${(avgReviewSeconds / 3600).toFixed(1)}h`
      : "N/A",
  };
}

// ── Compliance Package ──────────────────────────────────────────────────────

async function getRunPackage(id) {
  const run = await getRun(id);
  if (!run) return null;

  // Organize findings by gate
  const findingsByGate = {};
  for (const f of run.findings) {
    const gateId = f.gate_id || "ungated";
    if (!findingsByGate[gateId]) findingsByGate[gateId] = [];
    findingsByGate[gateId].push(f);
  }

  // Summary stats
  const findingSummary = {
    total: run.findings.length,
    critical: run.findings.filter((f) => f.severity === "critical").length,
    high: run.findings.filter((f) => f.severity === "high").length,
    medium: run.findings.filter((f) => f.severity === "medium").length,
    low: run.findings.filter((f) => f.severity === "low").length,
    info: run.findings.filter((f) => f.severity === "info").length,
    mitigated: run.findings.filter((f) => f.disposition).length,
    unmitigated: run.findings.filter((f) => !f.disposition && (f.severity === "critical" || f.severity === "high")).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    application: {
      name: run.app_name,
      team: run.team,
      classification: run.classification,
      contact: run.contact,
      gitUrl: run.git_url,
      branch: run.branch,
      imageUrl: run.image_url,
      sourceType: run.source_type,
    },
    run: {
      id: run.id,
      status: run.status,
      createdBy: run.created_by,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      deployedUrl: run.deployed_url,
    },
    gates: run.gates.map((g) => ({
      name: g.gate_name,
      shortName: g.short_name,
      order: g.gate_order,
      status: g.status,
      tool: g.tool,
      summary: g.summary,
      startedAt: g.started_at,
      completedAt: g.completed_at,
      findings: findingsByGate[g.id] || [],
    })),
    findingSummary,
    findings: run.findings,
    reviews: run.reviews,
    auditTrail: run.audit_log,
  };
}

// ── Active Runs (for crash recovery) ──────────────────────────────────────

async function getActiveRuns(team) {
  if (!pool) return [];
  const statuses = ['pending', 'scanning', 'review_pending', 'approved', 'deploying'];
  let sql = "SELECT * FROM pipeline_runs WHERE status = ANY($1) ORDER BY created_at DESC";
  const params = [statuses];
  if (team) {
    sql = "SELECT * FROM pipeline_runs WHERE status = ANY($1) AND team = $2 ORDER BY created_at DESC";
    params.push(team);
  }
  const { rows: runs } = await query(sql, params);
  if (runs.length > 0) {
    const runIds = runs.map(r => r.id);
    const { rows: allGates } = await query(
      "SELECT id, run_id, gate_name, short_name, gate_order, status, progress, summary, tool, completed_at FROM pipeline_gates WHERE run_id = ANY($1) ORDER BY gate_order",
      [runIds]
    );
    const gatesByRun = {};
    for (const g of allGates) {
      if (!gatesByRun[g.run_id]) gatesByRun[g.run_id] = [];
      gatesByRun[g.run_id].push(g);
    }
    for (const run of runs) {
      run.gates = gatesByRun[run.id] || [];
    }
  }
  return runs;
}

// ── Admin Audit Log ────────────────────────────────────────────────────────

async function adminAuditLog(action, actor, targetType, targetName, detail, metadata) {
  if (!pool) return null;
  const { rows } = await query(
    `INSERT INTO admin_audit_log (action, actor, target_type, target_name, detail, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [action, actor, targetType || null, targetName || null, detail || null, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0];
}

async function listAdminAuditLog(filters) {
  if (!pool) return { entries: [], total: 0 };
  const limit = Math.min(parseInt(filters.limit) || 50, 200);
  const offset = parseInt(filters.offset) || 0;
  let where = [];
  let params = [];
  let idx = 1;

  if (filters.action) {
    where.push(`action = $${idx++}`);
    params.push(filters.action);
  }
  if (filters.actor) {
    where.push(`actor ILIKE $${idx++}`);
    params.push(`%${filters.actor}%`);
  }
  if (filters.targetType) {
    where.push(`target_type = $${idx++}`);
    params.push(filters.targetType);
  }

  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
  const countResult = await query(`SELECT COUNT(*) as total FROM admin_audit_log ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].total);

  const dataParams = [...params, limit, offset];
  const result = await query(
    `SELECT * FROM admin_audit_log ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    dataParams
  );

  return { entries: result.rows, total, limit, offset };
}

// ── Platform Settings ─────────────────────────────────────────────────────

async function getSetting(key) {
  if (!pool) return null;
  const { rows } = await query("SELECT value FROM platform_settings WHERE key = $1", [key]);
  return rows.length > 0 ? rows[0].value : null;
}

async function setSetting(key, value) {
  if (!pool) return;
  await query(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

module.exports = {
  initDb,
  createRun,
  getRun,
  listRuns,
  updateRunStatus,
  createGate,
  updateGate,
  createFinding,
  updateFinding,
  createReview,
  auditLog,
  adminAuditLog,
  listAdminAuditLog,
  getStats,
  getRunPackage,
  getActiveRuns,
  getSetting,
  setSetting,
  pool,
};
