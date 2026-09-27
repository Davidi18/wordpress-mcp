#!/usr/bin/env node
// WordPress MCP Server v3.0.0 - PostgreSQL Integration + ENV Fallback
// Now reads clients from Agency OS database!
// Includes: Posts, Pages, Media, Comments, Users, Taxonomy, Site Info
// Multi-Client Support with dynamic PostgreSQL loading

import http from 'http';
import { parseToolsets, filterTools, toolsetOf } from './toolsets.js';
import { TOOL_HANDLERS, NOT_HANDLED } from './handlers/index.js';
import { createAuditLog } from './audit-log.js';
import { tools } from './tool-definitions/index.js';
import { SERVER_INSTRUCTIONS } from './server-instructions.js';
import {
  DATABASE_URL,
  pgClient,
  initDatabase,
  extractDomain,
  getClientConfig,
  getAllClientConfigs,
  detectClientByDomain
} from './clients.js';
import {
  requireApiKey,
  readBodyWithLimit,
  redactForLog,
  fetchWithRetry,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_FETCH_MAX_RETRIES
} from './mcp-hardening.js';

const PORT = parseInt(process.env.PORT || '8080');
const API_KEY = process.env.API_KEY;

// Durable log of every write tool call (table mcp_audit_log). Needs DATABASE_URL;
// MCP_AUDIT_LOG=off disables it. Never blocks or fails a tool call.
const auditLog = createAuditLog({ getDb: initDatabase, enabled: process.env.MCP_AUDIT_LOG !== 'off' });
// Retention: entries older than MCP_AUDIT_RETENTION_DAYS (default 90; 0 keeps
// everything) are deleted at startup and then once a day.
const AUDIT_RETENTION_DAYS = process.env.MCP_AUDIT_RETENTION_DAYS ?? '90';
auditLog.prune(AUDIT_RETENTION_DAYS);
setInterval(() => auditLog.prune(AUDIT_RETENTION_DAYS), 24 * 60 * 60 * 1000).unref();

// Initialize with first available client for validation
const initConfig = await getClientConfig();
const WP_API_URL = initConfig.url;
const WP_API_USERNAME = initConfig.username;
const WP_API_PASSWORD = initConfig.password;

if (!WP_API_URL || !WP_API_USERNAME || !WP_API_PASSWORD) {
  console.error('❌ No WordPress clients configured!');
  console.error('   Either configure DATABASE_URL for Agency OS connection');
  console.error('   Or set WP_API_URL, WP_API_USERNAME, WP_API_PASSWORD in ENV');
  process.exit(1);
}

const baseURL = WP_API_URL.replace(/\/+$/, '');
const wpApiBase = baseURL.includes('/wp-json') ? baseURL : `${baseURL}/wp-json`;
const authHeader = 'Basic ' + Buffer.from(`${WP_API_USERNAME}:${WP_API_PASSWORD}`).toString('base64');
const WC_KEY = initConfig.wc_key;
const WC_SECRET = initConfig.wc_secret;

console.log(`🚀 Default Client: ${initConfig.name} (${initConfig.source})`);
if (WC_KEY) console.log(`🛒 WooCommerce: Credentials configured`);

function normalizeRequestOptions(options = {}) {
  const normalized = { ...options };

  // Several tools pass plain objects as `body`. Native fetch sends those as
  // "[object Object]", which WordPress then rejects as invalid JSON. Keep
  // pre-stringified JSON, buffers, streams and form payloads untouched.
  if (
    normalized.body &&
    typeof normalized.body === 'object' &&
    !(normalized.body instanceof URLSearchParams) &&
    !(typeof FormData !== 'undefined' && normalized.body instanceof FormData) &&
    !(typeof Blob !== 'undefined' && normalized.body instanceof Blob) &&
    !Buffer.isBuffer(normalized.body)
  ) {
    normalized.body = JSON.stringify(normalized.body);
  }

  return normalized;
}

// Pull per-request retry/timeout overrides out of the options bag so they reach
// fetchWithRetry's third argument instead of being passed to fetch() as unknown
// init fields. Callers that omit these get fetchWithRetry's defaults (30s, 3x).
function splitRetryOptions(options = {}) {
  const { timeoutMs, maxRetries, retryBaseMs, ...fetchInit } = options;
  const retryConfig = {};
  if (timeoutMs !== undefined) retryConfig.timeoutMs = timeoutMs;
  if (maxRetries !== undefined) retryConfig.maxRetries = maxRetries;
  if (retryBaseMs !== undefined) retryConfig.retryBaseMs = retryBaseMs;
  return { retryConfig, fetchInit };
}

function previewText(text, max = 500) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parseWordPressJsonOrThrow({ text, response, url, clientName = 'default' }) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    const contentType = response.headers?.get?.('content-type') || 'unknown';
    const preview = previewText(text);
    throw new Error(
      `Invalid JSON from WordPress REST for client "${clientName}" ` +
      `(status ${response.status}, content-type ${contentType}, url ${url}): ${preview}`
    );
  }
}

function isSafeRoutingMethod(method) {
  return method === 'initialize' || method === 'tools/list' || (method && method.startsWith('notifications/'));
}

// Tools that never touch a WordPress site, so they need no client routing.
const SITE_INDEPENDENT_TOOLS = new Set(['wp_audit_log']);

async function requireExplicitClientRouting(args, method, toolName) {
  if (isSafeRoutingMethod(method)) return;
  if (SITE_INDEPENDENT_TOOLS.has(toolName)) return;
  if (args && (args.client || args.site_url)) return;

  const clients = await getAllClientConfigs();
  if (clients.length <= 1) return;

  const available = clients
    .map(c => `${c.id}${c.domain ? ` (${c.domain})` : ''}`)
    .join(', ');

  throw new Error(
    'Client routing required for WordPress MCP tools/call. ' +
    'Pass a client argument such as client="caio-co-il", or use a client-specific Hermes profile with ' +
    'mcp_servers.wordpress.default_arguments.client configured. ' +
    `Available clients: [${available}]`
  );
}

async function wpRequest(endpoint, options = {}) {
  let url = `${wpApiBase}${endpoint}`;

  // WooCommerce endpoints use consumer key/secret authentication
  if (endpoint.startsWith('/wc/')) {
    if (!WC_KEY || !WC_SECRET) {
      throw new Error(
        `WooCommerce credentials not configured. Add WC_CONSUMER_KEY and WC_CONSUMER_SECRET to your environment.`
      );
    }
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}consumer_key=${WC_KEY}&consumer_secret=${WC_SECRET}`;
  }

  // Debug logging
  console.log(`🌐 wpRequest URL: ${url.replace(/consumer_secret=[^&]+/, 'consumer_secret=***')}`);

  const requestOptions = normalizeRequestOptions(options);
  const { retryConfig, fetchInit } = splitRetryOptions(requestOptions);

  const response = await fetchWithRetry(url, {
    ...fetchInit,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      ...fetchInit.headers
    }
  }, retryConfig);

  const text = await response.text();
  const data = parseWordPressJsonOrThrow({ text, response, url, clientName: initConfig.name || 'default' });

  if (!response.ok) {
    throw new Error(`WordPress API error (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}
// Tag the default requester so module probes can key their cache by client
// without threading a clientKey through every write callsite.
wpRequest.clientKey = 'default';

// Create wpRequest for specific client
function createWpRequestForClient(clientConfig) {
  const baseURL = clientConfig.url.replace(/\/+$/, '');
  const wpApiBase = baseURL.includes('/wp-json') ? baseURL : `${baseURL}/wp-json`;
  const authHeader = 'Basic ' + Buffer.from(`${clientConfig.username}:${clientConfig.password}`).toString('base64');

  const clientReq = async function(endpoint, options = {}) {
    let url = `${wpApiBase}${endpoint}`;

    // WooCommerce endpoints use consumer key/secret authentication
    if (endpoint.startsWith('/wc/')) {
      if (!clientConfig.wc_key || !clientConfig.wc_secret) {
        throw new Error(
          `WooCommerce credentials not configured for this client. ` +
          `Add ${clientConfig.name === 'default' ? 'WC_CONSUMER_KEY and WC_CONSUMER_SECRET' : `CLIENT${clientConfig.name.replace('client', '').toUpperCase()}_WC_CONSUMER_KEY and CLIENT${clientConfig.name.replace('client', '').toUpperCase()}_WC_CONSUMER_SECRET`} to your environment.`
        );
      }
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}consumer_key=${clientConfig.wc_key}&consumer_secret=${clientConfig.wc_secret}`;
    }

    // Debug logging
    console.log(`🌐 wpRequestForClient [${clientConfig.name}] URL: ${url.replace(/consumer_secret=[^&]+/, 'consumer_secret=***')}`);

    const requestOptions = normalizeRequestOptions(options);
    const { retryConfig, fetchInit } = splitRetryOptions(requestOptions);

    const response = await fetchWithRetry(url, {
      ...fetchInit,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...fetchInit.headers
      }
    }, retryConfig);

    const text = await response.text();
    const data = parseWordPressJsonOrThrow({ text, response, url, clientName: clientConfig.name || 'unknown' });

    if (!response.ok) {
      throw new Error(`WordPress API error (${response.status}): ${JSON.stringify(data)}`);
    }

    return data;
  };
  clientReq.clientKey = clientConfig?.name || 'default';
  return clientReq;
}

// Universal search function - finds ANY content type in WordPress
async function findContent(searchParams, clientConfig) {
  const { slug, url, search, id } = searchParams;
  const wpRequestForClient = createWpRequestForClient(clientConfig);

  // If searching by ID, try direct lookup
  if (id) {
    // Try posts by ID
    try {
      const post = await wpRequestForClient(`/wp/v2/posts/${id}`);
      if (post) {
        return {
          found: true,
          type: 'post',
          id: post.id,
          title: post.title.rendered,
          slug: post.slug,
          content: post.content.rendered,
          excerpt: post.excerpt?.rendered,
          url: post.link,
          date: post.date,
          status: post.status
        };
      }
    } catch (error) {
      // Not a post, try pages
    }

    // Try pages by ID
    try {
      const page = await wpRequestForClient(`/wp/v2/pages/${id}`);
      if (page) {
        return {
          found: true,
          type: 'page',
          id: page.id,
          title: page.title.rendered,
          slug: page.slug,
          content: page.content.rendered,
          url: page.link,
          date: page.date,
          status: page.status
        };
      }
    } catch (error) {
      // Not found by ID
    }
  }

  // Extract search term
  let searchSlug = slug;
  if (url) {
    const urlParts = url.split('/').filter(p => p);
    searchSlug = urlParts[urlParts.length - 1];
  }

  // STEP 1: Check if it's a special page (homepage, blog, privacy policy)
  if (searchSlug && !search) {
    try {
      const settings = await wpRequestForClient('/wp/v2/settings');

      // Check homepage
      if (settings.show_on_front === 'page' && settings.page_on_front) {
        try {
          const homepage = await wpRequestForClient(`/wp/v2/pages/${settings.page_on_front}`);
          if (homepage && (homepage.slug === searchSlug || searchSlug === 'home' || searchSlug === 'homepage')) {
            return {
              found: true,
              type: 'page',
              specialType: 'homepage',
              id: homepage.id,
              title: homepage.title.rendered,
              slug: homepage.slug,
              content: homepage.content.rendered,
              url: homepage.link,
              date: homepage.date,
              status: homepage.status,
              isSpecialPage: true
            };
          }
        } catch (e) {}
      }

      // Check blog page
      if (settings.page_for_posts) {
        try {
          const blogPage = await wpRequestForClient(`/wp/v2/pages/${settings.page_for_posts}`);
          if (blogPage && (blogPage.slug === searchSlug || searchSlug === 'blog')) {
            return {
              found: true,
              type: 'page',
              specialType: 'blog_page',
              id: blogPage.id,
              title: blogPage.title.rendered,
              slug: blogPage.slug,
              content: blogPage.content.rendered,
              url: blogPage.link,
              date: blogPage.date,
              status: blogPage.status,
              isSpecialPage: true
            };
          }
        } catch (e) {}
      }

      // Check privacy policy page
      if (settings.wp_page_for_privacy_policy) {
        try {
          const privacyPage = await wpRequestForClient(`/wp/v2/pages/${settings.wp_page_for_privacy_policy}`);
          if (privacyPage && (privacyPage.slug === searchSlug || searchSlug === 'privacy' || searchSlug === 'privacy-policy')) {
            return {
              found: true,
              type: 'page',
              specialType: 'privacy_policy',
              id: privacyPage.id,
              title: privacyPage.title.rendered,
              slug: privacyPage.slug,
              content: privacyPage.content.rendered,
              url: privacyPage.link,
              date: privacyPage.date,
              status: privacyPage.status,
              isSpecialPage: true
            };
          }
        } catch (e) {}
      }
    } catch (error) {
      console.error('Error checking special pages:', error.message);
    }
  }

  // STEP 2: Search in standard posts and pages
  let params = new URLSearchParams({ per_page: '1' });

  if (searchSlug) {
    params.append('slug', searchSlug);
  } else if (search) {
    params.append('search', search);
  }

  // Try posts
  try {
    const posts = await wpRequestForClient(`/wp/v2/posts?${params}`);
    if (posts && posts.length > 0) {
      const post = posts[0];
      return {
        found: true,
        type: 'post',
        id: post.id,
        title: post.title.rendered,
        slug: post.slug,
        content: post.content.rendered,
        excerpt: post.excerpt?.rendered,
        url: post.link,
        date: post.date,
        status: post.status
      };
    }
  } catch (error) {
    console.error('Error searching posts:', error.message);
  }

  // Try pages
  try {
    const pages = await wpRequestForClient(`/wp/v2/pages?${params}`);
    if (pages && pages.length > 0) {
      const page = pages[0];
      return {
        found: true,
        type: 'page',
        id: page.id,
        title: page.title.rendered,
        slug: page.slug,
        content: page.content.rendered,
        url: page.link,
        date: page.date,
        status: page.status
      };
    }
  } catch (error) {
    console.error('Error searching pages:', error.message);
  }

  // Not found
  return {
    found: false,
    message: 'Content not found in posts, pages, or special pages',
    searchParams: { slug: searchSlug, search, id }
  };
}

async function executeTool(name, args, clientConfig = null) {
  const wpReq = clientConfig ? createWpRequestForClient(clientConfig) : wpRequest;
  const currentAuthHeader = clientConfig 
    ? 'Basic ' + Buffer.from(`${clientConfig.username}:${clientConfig.password}`).toString('base64')
    : authHeader;

  // Handlers live in handlers/<toolset>.js; each returns NOT_HANDLED for tool
  // names it doesn't own.
  const ctx = { clientConfig, wpReq, currentAuthHeader, auditLog };
  const result = await TOOL_HANDLERS[toolsetOf(name)](name, args, ctx);
  if (result !== NOT_HANDLED) return result;
  throw new Error(`Unknown tool: ${name}`);
}

// HTTP Server
// Session map for SSE transport (by sessionId and by remoteAddress as fallback)
const sseSessions = new Map();
const sseByIp = new Map();

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    const clients = await getAllClientConfigs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'healthy',
      version: '3.0.0',
      clients: clients.length,
      source: clients[0]?.source || 'none',
      database: pgClient ? 'connected' : 'disconnected'
    }));
  }

  // List clients endpoint
  if (req.method === 'GET' && req.url === '/api/clients') {
    try {
      const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
      if (API_KEY && apiKey !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized: Invalid API Key' }));
      }

      const clients = await getAllClientConfigs();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ clients, count: clients.length }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: error.message }));
    }
  }

  // Handle GET /api/find endpoint
  if (req.method === 'GET' && req.url.startsWith('/api/find')) {
    try {
      const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
      if (API_KEY && apiKey !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized: Invalid API Key' }));
      }

      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const params = Object.fromEntries(urlObj.searchParams);
      const { slug, url, search, id, client } = params;

      if (!slug && !url && !search && !id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Missing search parameter. Provide one of: id, slug, url, or search'
        }));
      }

      let detectedClient = client;
      if (!detectedClient && url) {
        detectedClient = await detectClientByDomain(url);
        if (detectedClient) {
          console.log(`🔍 Auto-detected client from URL domain: ${detectedClient}`);
        }
      }

      const clientConfig = await getClientConfig(detectedClient);

      if (!clientConfig.url || !clientConfig.username || !clientConfig.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: `Invalid client configuration for: ${client || 'default'}`
        }));
      }

      const result = await findContent({ id, slug, url, search }, clientConfig);

      const responseData = {
        ...result,
        _meta: {
          client: clientConfig.name,
          source: clientConfig.source,
          autoDetected: !client && !!detectedClient
        }
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(responseData, null, 2));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }));
    }
  }

  // Handle GET /api/site-data endpoint
  if (req.method === 'GET' && req.url.startsWith('/api/site-data')) {
    try {
      const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
      if (API_KEY && apiKey !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized: Invalid API Key' }));
      }

      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const params = Object.fromEntries(urlObj.searchParams);
      const { client } = params;

      const clientConfig = await getClientConfig(client);

      if (!clientConfig.url || !clientConfig.username || !clientConfig.password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: `Invalid client configuration for: ${client || 'default'}`
        }));
      }

      const [siteInfo, specialPages] = await Promise.all([
        executeTool('wp_get_site_info', {}, clientConfig),
        executeTool('wp_get_special_pages', {}, clientConfig)
      ]);

      const responseData = {
        site: siteInfo,
        pages: specialPages,
        _meta: {
          client: clientConfig.name,
          source: clientConfig.source,
          endpoint: '/api/site-data',
          timestamp: new Date().toISOString()
        }
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(responseData, null, 2));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }));
    }
  }

  // GET /mcp — SSE fallback (mcporter uses this as fallback transport)
  if (req.method === 'GET' && (req.url === '/mcp' || req.url.startsWith('/mcp?'))) {
    if (!requireApiKey(req, res, API_KEY)) return;
    const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Mcp-Session-Id': sessionId
    });
    // Echo the query (e.g. ?toolsets=) so the client's POSTs keep the same selection.
    res.write(`event: endpoint\ndata: ${req.url}\n\n`);
    sseSessions.set(sessionId, res);
    const remoteIp = req.socket.remoteAddress;
    sseByIp.set(remoteIp, res);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseSessions.delete(sessionId);
      if (sseByIp.get(remoteIp) === res) sseByIp.delete(remoteIp);
    });
    return;
  }

  // Handle POST /mcp endpoint (MCP protocol)
  const mcpUrl = new URL(req.url, 'http://localhost');
  if (req.method !== 'POST' || mcpUrl.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Not found',
      endpoints: [
        'GET /health',
        'GET /api/clients',
        'GET /api/find?slug=...&client=...',
        'GET /api/site-data?client=...',
        'GET /mcp (SSE fallback)',
        'POST /mcp'
      ]
    }));
  }

  // Enforce auth before parsing the body — covers initialize/tools/list/tools/call
  if (!requireApiKey(req, res, API_KEY)) return;

  // Hoisted so the outer catch can route errors through the same response
  // channel as success. Otherwise a thrown error during tools/call (e.g.
  // requireExplicitClientRouting, getClientConfig "Client not found") is
  // written to the POST body as application/json, while the MCP client is
  // listening on the SSE stream for a response with the original id — it
  // never sees the error and times out (120s).
  const acceptsSSE = (req.headers['accept'] || '').includes('text/event-stream');
  const mcpSessionId = req.headers['mcp-session-id'];
  const remoteIp = req.socket.remoteAddress;
  const sseStream = (mcpSessionId && sseSessions.get(mcpSessionId)) || sseByIp.get(remoteIp) || null;
  let requestId = null;

  // Send JSON-RPC payload via SSE stream or direct response, matching the
  // success path so error and result share the same transport.
  function sendJsonRpc(payload) {
    const jsonResult = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (res.headersSent || res.writableEnded) return;
    if (sseStream) {
      sseStream.write(`data: ${jsonResult}\n\n`);
      res.writeHead(202);
      res.end();
    } else if (acceptsSSE) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${jsonResult}\n\n`);
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(jsonResult);
    }
  }

  try {
    let body;
    try {
      body = await readBodyWithLimit(req, DEFAULT_MAX_BODY_BYTES);
    } catch (err) {
      const status = err.statusCode || 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: status === 413 ? -32002 : -32700, message: err.message }
      }));
    }
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Empty request body' }));
    }

    const { method, params, id } = body;
    requestId = id;

    const sendResult = sendJsonRpc;

    // Acknowledge notifications silently (no response needed per MCP spec)
    if (method && method.startsWith('notifications/')) {
      res.writeHead(202);
      res.end();
      return;
    }

    if (method === 'initialize') {
      return sendResult(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'WordPress MCP Server',
            version: '3.2.0',
            description: `WordPress + Elementor control plane — ${tools.length} tools (content, WooCommerce, plugins, SEO, and surgical Elementor editing) with PostgreSQL multi-client management (Agency OS).`
          },
          instructions: SERVER_INSTRUCTIONS
        }
      }));
    }

    if (method === 'ping') {
      return sendResult(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {}
      }));
    }

    if (method === 'tools/list') {
      const selected = parseToolsets(mcpUrl.searchParams.get('toolsets') ?? process.env.MCP_TOOLSETS);
      return sendResult(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { tools: filterTools(tools, selected) }
      }));
    }

    if (method === 'tools/call') {
      const { name, arguments: rawArgs } = params;
      const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

      // Flatten nested arguments before routing checks. Some MCP clients wrap
      // tool arguments under an extra `arguments` object.
      if (args.arguments && typeof args.arguments === 'object') {
        Object.assign(args, args.arguments);
        delete args.arguments;
      }

      await requireExplicitClientRouting(args, method, name);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🪵 TOOL CALL:', name);
      console.log('📦 ARGS:', JSON.stringify(redactForLog(args), null, 2));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Handle client parameter for multi-site
      let clientConfig = null;
      // Support site_url as alias for client. Prefer DB/domain detection over
      // naive slug conversion so www/subpath URLs still route correctly.
      if (args.site_url && !args.client) {
        const detectedClient = await detectClientByDomain(args.site_url);
        if (detectedClient) {
          args.client = detectedClient;
        } else {
          const domain = extractDomain(args.site_url);
          args.client = domain.replace(/\./g, '-'); // caio.co.il → caio-co-il
        }
        delete args.site_url;
      }
      if (args.client) {
        clientConfig = await getClientConfig(args.client);
        delete args.client; // Remove from args after extracting
      }

      // Normalize ID fields
      if (args && typeof args === 'object') {
        if (args.id && !args.ID) args.ID = String(args.id);
        if (args.ID && typeof args.ID !== 'string') args.ID = String(args.ID);
        if (args.postType && !args.post_type) args.post_type = args.postType;
        if (args.type && !args.post_type) args.post_type = args.type;
      }

      const startedAt = Date.now();
      const auditBase = {
        tool: name,
        client: clientConfig?.name ?? initConfig.name ?? 'default',
        site: clientConfig?.url ?? initConfig.url ?? null,
        user_agent: req.headers['user-agent'],
        args
      };
      let result;
      try {
        result = await executeTool(name, args || {}, clientConfig);
      } catch (toolError) {
        auditLog.record({ ...auditBase, error: toolError.message, duration_ms: Date.now() - startedAt });
        throw toolError;
      }
      auditLog.record({ ...auditBase, result, duration_ms: Date.now() - startedAt });

      return sendResult(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          data: result  // Structured data for programmatic access
        }
      }));
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' }
    }));

  } catch (error) {
    // Route errors through the same channel as success (SSE if the client is
    // listening there) and echo the original JSON-RPC id, so MCP clients can
    // correlate and surface the error instead of waiting for a response on
    // the SSE stream that never arrives.
    sendJsonRpc({
      jsonrpc: '2.0',
      id: requestId ?? null,
      error: { code: -32603, message: error.message }
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WordPress MCP Server v3.0.0 listening on :${PORT}`);
  console.log(`📡 MCP Protocol: POST /mcp`);
  console.log(`🔍 HTTP API: GET /api/find?slug=...&client=...`);
  console.log(`📋 Clients: GET /api/clients`);
  console.log(`🔐 API Key: ${API_KEY ? 'Enabled ✅ (enforced on /mcp + /api/*)' : 'Disabled ⚠️'}`);
  console.log(`📏 Max body: ${(DEFAULT_MAX_BODY_BYTES / 1024 / 1024).toFixed(0)} MB`);
  console.log(`⏱️  WP fetch: ${DEFAULT_FETCH_TIMEOUT_MS}ms timeout, ${DEFAULT_FETCH_MAX_RETRIES}x retry on 429/5xx (GET only)`);
  console.log(`🗄️  Database: ${DATABASE_URL ? 'Configured' : 'Not configured (ENV fallback)'}`);
  console.log(`🛠️  Available MCP tools: ${tools.length}`);
});

process.on('SIGTERM', () => {
  if (pgClient) pgClient.end();
  server.close(() => process.exit(0));
});
