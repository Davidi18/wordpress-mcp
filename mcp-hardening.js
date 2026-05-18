// mcp-hardening.js
// Auth, body-size limits, log redaction, and fetch retry/timeout helpers.

export const DEFAULT_MAX_BODY_BYTES = parseInt(process.env.MCP_MAX_BODY_BYTES || '52428800', 10); // 50 MB
export const DEFAULT_FETCH_TIMEOUT_MS = parseInt(process.env.WP_FETCH_TIMEOUT_MS || '30000', 10); // 30 s
export const DEFAULT_FETCH_MAX_RETRIES = parseInt(process.env.WP_FETCH_MAX_RETRIES || '3', 10);

const SENSITIVE_KEY_RE = /pass(word)?|secret|token|api[_-]?key|authorization|app[_-]?password|consumer[_-]?(key|secret)/i;
const BASE64ISH_KEYS = /content|base64|file|data|attachment|image|media|payload/i;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function extractApiKey(req) {
  const headerKey = req.headers['x-api-key'];
  if (headerKey) return headerKey;
  const auth = req.headers['authorization'];
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

// Returns true if the request is authorized (or auth is disabled). Sends a
// 401 and returns false otherwise. Caller should `return` when false.
export function requireApiKey(req, res, expected) {
  if (!expected) return true; // auth disabled
  const presented = extractApiKey(req);
  if (presented && presented === expected) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32001, message: 'Unauthorized: missing or invalid API key' }
  }));
  return false;
}

// Buffer the request body with a hard cap. Throws an Error with `.statusCode`
// on overflow or invalid JSON so the caller can map it cleanly to HTTP.
export async function readBodyWithLimit(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const declared = parseInt(req.headers['content-length'] || '0', 10);
  if (declared && declared > maxBytes) {
    const err = new Error(`Request body too large: ${declared} bytes (max ${maxBytes})`);
    err.statusCode = 413;
    throw err;
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      req.destroy();
      const err = new Error(`Request body exceeded max size of ${maxBytes} bytes`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }

  if (received === 0) return null;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error('Invalid JSON in request body');
    err.statusCode = 400;
    throw err;
  }
}

// Redact a value for logging: strip secret-named fields, truncate long
// strings (which often carry base64 payloads). Bounded recursion depth.
export function redactForLog(value, { maxStringLen = 200, depth = 0, maxDepth = 6, parentKey = '' } = {}) {
  if (value === null || value === undefined) return value;
  if (depth > maxDepth) return '<max-depth>';

  if (typeof value === 'string') {
    if (parentKey && BASE64ISH_KEYS.test(parentKey) && value.length > maxStringLen) {
      return `<redacted:${value.length} chars>`;
    }
    if (value.length > maxStringLen) {
      return value.slice(0, maxStringLen) + `…<+${value.length - maxStringLen}>`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(v => redactForLog(v, { maxStringLen, depth: depth + 1, maxDepth, parentKey }));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '<redacted>';
      } else {
        out[k] = redactForLog(v, { maxStringLen, depth: depth + 1, maxDepth, parentKey: k });
      }
    }
    return out;
  }

  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// fetch wrapper with: (a) abort-based timeout, (b) retry on transient
// 429/5xx for safe methods only (GET/HEAD/OPTIONS). Write verbs are never
// auto-retried — no idempotency tokens in this codebase.
export async function fetchWithRetry(url, init = {}, {
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  maxRetries = DEFAULT_FETCH_MAX_RETRIES,
  retryBaseMs = 1000
} = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const safe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const attempts = safe ? maxRetries : 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (safe && RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
        const wait = retryAfter > 0 ? retryAfter * 1000 : retryBaseMs * Math.pow(2, attempt - 1);
        await sleep(wait);
        continue;
      }
      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const isTimeout = err.name === 'AbortError';
      // Network/timeout errors are only retried for safe methods.
      if (!safe || attempt >= attempts) {
        if (isTimeout) {
          const wrap = new Error(`fetch timed out after ${timeoutMs}ms: ${url}`);
          wrap.cause = err;
          throw wrap;
        }
        throw err;
      }
      await sleep(retryBaseMs * Math.pow(2, attempt - 1));
    }
  }
  throw lastError || new Error('fetchWithRetry: exhausted attempts');
}
