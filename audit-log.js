// audit-log.js
// Durable record of every write an agent makes through the server, stored in
// the same PostgreSQL the client list comes from (table mcp_audit_log).
//
// Guarantees and limits:
//   - Logging never blocks or fails a tool call: inserts are fire-and-forget
//     and errors are only printed.
//   - Read-only tools are not logged (see isWriteTool).
//   - `previous_state` holds what the tool itself captured before writing
//     (Elementor/page-state tools return one; ACF writes return the previous
//     values of the fields they changed). Other writes log args + result only.
//   - Secrets are redacted by key name; strings are capped, huge values are
//     replaced by a size marker so one Elementor blob can't bloat the table.

const READ_RE = /^(wp|wc)_(elementor_|rankmath_|yoast_)?(get|list|search|find|check|capabilities|guidelines|download)(_|$)|^wp_(search|audit_log|refresh_clients)$/;

export function isWriteTool(name) {
  return !READ_RE.test(name);
}

const SECRET_KEY_RE = /pass(word)?|secret|token|api[_-]?key|authorization|app[_-]?password|consumer[_-]?(key|secret)/i;
const BINARY_KEY_RE = /base64|zip|file_data|binary/i;
const MAX_STRING = 20000;
const MAX_JSON_BYTES = 1_000_000;

export function sanitizeForAudit(value, depth = 0, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 12) return '<max-depth>';
  if (typeof value === 'string') {
    if (BINARY_KEY_RE.test(key) && value.length > 256) return `<binary:${value.length} chars>`;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…<+${value.length - MAX_STRING}>` : value;
  }
  if (Array.isArray(value)) return value.map(v => sanitizeForAudit(v, depth + 1, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? '<redacted>' : sanitizeForAudit(v, depth + 1, k);
    }
    return out;
  }
  return value;
}

function toJsonb(value) {
  if (value === undefined) return null;
  const json = JSON.stringify(sanitizeForAudit(value));
  if (json === undefined) return null;
  if (json.length > MAX_JSON_BYTES) return JSON.stringify({ omitted: `too large (${json.length} bytes)` });
  return json;
}

export function extractPreviousState(result) {
  if (!result || typeof result !== 'object') return undefined;
  if (result.previous_state !== undefined) return result.previous_state;
  const acf = result.acf_update;
  if (acf?.previous) return { acf: acf.previous };
  if (Array.isArray(result.results)) {
    const perPost = result.results
      .filter(r => r?.acf?.previous)
      .map(r => ({ id: r.id, acf: r.acf.previous }));
    if (perPost.length) return perPost;
  }
  return undefined;
}

export function targetOf(args = {}) {
  const id = args.id ?? args.ID ?? args.page_id ?? args.post_id;
  const ids = args.ids ?? args.post_ids;
  let target = null;
  if (id !== undefined && id !== null) target = String(id);
  else if (Array.isArray(ids)) target = ids.join(',');
  return { target_id: target, post_type: args.post_type ?? null };
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client TEXT,
    site TEXT,
    tool TEXT NOT NULL,
    target_id TEXT,
    post_type TEXT,
    success BOOLEAN NOT NULL,
    error TEXT,
    duration_ms INTEGER,
    user_agent TEXT,
    args JSONB,
    result JSONB,
    previous_state JSONB
  );
  CREATE INDEX IF NOT EXISTS mcp_audit_log_client_time ON mcp_audit_log (client, created_at DESC);
  CREATE INDEX IF NOT EXISTS mcp_audit_log_target ON mcp_audit_log (target_id);
`;

// getDb: async () => pg Pool | null. enabled=false turns the logger into a no-op.
const SCHEMA_RETRY_MS = 5 * 60 * 1000;

export function createAuditLog({ getDb, enabled = true, log = console, now = Date.now } = {}) {
  let ready = null;
  let schemaFailedAt = 0;
  let schemaError = '';

  async function db() {
    const pool = await getDb();
    if (!pool) return null;
    // If the table can't be created (e.g. the DB role lacks CREATE), don't
    // retry — and log — on every single write; back off for a few minutes.
    if (schemaFailedAt && now() - schemaFailedAt < SCHEMA_RETRY_MS) {
      throw new Error(`Audit table mcp_audit_log unavailable — creating it failed: ${schemaError}. Grant the DB role CREATE on the schema, or create the table manually (see README).`);
    }
    if (!ready) {
      ready = pool.query(SCHEMA_SQL).then(() => { schemaFailedAt = 0; }).catch(err => {
        ready = null;
        schemaFailedAt = now();
        schemaError = err.message;
        throw err;
      });
    }
    await ready;
    return pool;
  }

  async function record(entry) {
    if (!enabled || !isWriteTool(entry.tool)) return;
    try {
      const pool = await db();
      if (!pool) return;
      const { target_id, post_type } = targetOf(entry.args);
      await pool.query(
        `INSERT INTO mcp_audit_log
           (client, site, tool, target_id, post_type, success, error, duration_ms, user_agent, args, result, previous_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          entry.client ?? null,
          entry.site ?? null,
          entry.tool,
          target_id,
          post_type,
          !entry.error,
          entry.error ? String(entry.error).slice(0, 4000) : null,
          entry.duration_ms ?? null,
          entry.user_agent ? String(entry.user_agent).slice(0, 300) : null,
          toJsonb(entry.args),
          entry.error ? null : toJsonb(entry.result),
          toJsonb(extractPreviousState(entry.result))
        ]
      );
    } catch (err) {
      if (!/^Audit table mcp_audit_log unavailable/.test(err.message)) {
        log.error?.(`⚠️ audit log write failed (${entry.tool}): ${err.message}`);
      }
    }
  }

  async function query({ client, tool, target_id, since, failed_only, limit = 50 } = {}) {
    const pool = await db();
    if (!pool) {
      throw new Error('Audit log unavailable: DATABASE_URL is not configured or the database is unreachable.');
    }
    const where = [];
    const params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (client) add('client ILIKE ?', `%${client}%`);
    if (tool) add('tool = ?', tool);
    if (target_id !== undefined && target_id !== null) add('target_id = ?', String(target_id));
    if (since) add('created_at >= ?', since);
    if (failed_only) where.push('success = false');
    params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
    const { rows } = await pool.query(
      `SELECT id, created_at, client, site, tool, target_id, post_type, success, error, duration_ms, args, previous_state
         FROM mcp_audit_log
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return rows;
  }

  return { record, query };
}
