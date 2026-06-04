#!/usr/bin/env node
// WordPress MCP Server v3.0.0 - PostgreSQL Integration + ENV Fallback
// Now reads clients from Agency OS database!
// Includes: Posts, Pages, Media, Comments, Users, Taxonomy, Site Info
// Multi-Client Support with dynamic PostgreSQL loading

import http from 'http';
import fs from 'fs';
import pg from 'pg';
import { BLOCKS_MANIFEST, listBlocks, getBlock, parseElementorData, spliceBlock } from './elementor-blocks-library.js';
import { buildGuidelines } from './elementor-guidelines.js';
import { applyReplaceText, walkElementorReplace } from './elementor-replace-text.js';
import {
  findElementById,
  patchElementById,
  duplicateElementById,
  insertElement,
  normalizeWidget,
  summarizeTree
} from './elementor-tree.js';
import { ELEMENTOR_META_KEYS, SEO_META_KEYS, POST_NON_TAX_FIELDS } from './wp-meta-keys.js';
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

// PostgreSQL Configuration (Agency OS via Tailscale)
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@100.98.146.89:5432/postgres';

// Client cache (refreshes every 5 minutes)
let clientCache = null;
let clientCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// PostgreSQL client
let pgClient = null;

async function initDatabase() {
  if (pgClient) return pgClient;
  
  try {
    const { Pool } = pg;
    pgClient = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    
    // Test connection
    await pgClient.query('SELECT 1');
    console.log('✅ PostgreSQL connected (Agency OS)');
    return pgClient;
  } catch (error) {
    console.error('⚠️ PostgreSQL connection failed:', error.message);
    console.log('📋 Falling back to ENV configuration');
    pgClient = null;
    return null;
  }
}

// Load clients from PostgreSQL
async function loadClientsFromDB() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (clientCache && (now - clientCacheTime) < CACHE_TTL) {
    return clientCache;
  }
  
  const db = await initDatabase();
  if (!db) return null;
  
  try {
    const result = await db.query(`
      SELECT 
        id,
        name,
        wordpress_url,
        wordpress_username,
        wordpress_app_password,
        wordpress_client_id,
        status
      FROM clients 
      WHERE wordpress_url IS NOT NULL 
        AND wordpress_url != ''
        AND wordpress_username IS NOT NULL
        AND wordpress_app_password IS NOT NULL
        AND (deleted_at IS NULL)
        AND (is_wordpress_paused IS NULL OR is_wordpress_paused = false)
      ORDER BY name
    `);
    
    clientCache = result.rows;
    clientCacheTime = now;
    console.log(`📦 Loaded ${clientCache.length} WordPress clients from database`);
    return clientCache;
  } catch (error) {
    console.error('❌ Error loading clients from DB:', error.message);
    return null;
  }
}

// Force refresh cache (useful after updates)
function invalidateClientCache() {
  clientCache = null;
  clientCacheTime = 0;
  console.log('🔄 Client cache invalidated');
}

// Extract domain from URL
function extractDomain(url) {
  try {
    // Add protocol if missing
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch (e) {
    return url.replace('www.', '').split('/')[0];
  }
}

// Get client config - tries DB first, then ENV fallback with domain matching
async function getClientConfig(clientId = null) {
  // Try database first
  const dbClients = await loadClientsFromDB();
  
  if (dbClients && dbClients.length > 0) {
    let client;
    if (!clientId || clientId === 'default') {
      client = dbClients[0];
    } else {
      // Match by: wordpress_client_id, name slug, or domain from wordpress_url
      const searchId = clientId.toLowerCase();
      client = dbClients.find(c => {
        // Match by wordpress_client_id
        if (c.wordpress_client_id && c.wordpress_client_id === searchId) return true;
        // Match by name slug (e.g. "shukeat", "kedma-solar")
        if (c.name.toLowerCase().replace(/\s+/g, '-') === searchId) return true;
        // Match by domain extracted from wordpress_url (e.g. "shukeat.co.il")
        if (c.wordpress_url) {
          const domain = extractDomain(c.wordpress_url);
          if (domain === searchId) return true;
          // Also match domain slug (e.g. "shukeat-co-il")
          if (domain.replace(/\./g, '-') === searchId) return true;
        }
        return false;
      });
    }
    if (client) {
      let wpUrl = client.wordpress_url.replace(/\/+$/, '');
      if (!wpUrl.startsWith('http://') && !wpUrl.startsWith('https://')) {
        wpUrl = 'https://' + wpUrl;
      }
      return {
        url: wpUrl,
        username: client.wordpress_username,
        password: client.wordpress_app_password,
        name: client.name,
        source: 'database'
      };
    }
    // If clientId specified but not found in DB, throw error with available clients
    if (clientId && clientId !== 'default') {
      const available = dbClients.map(c => c.wordpress_client_id || extractDomain(c.wordpress_url) || c.name).join(', ');
      throw new Error(`Client not found: "${clientId}". Available: [${available}]`);
    }
  }
  
  // Fallback to ENV configuration
  console.log('📋 Using ENV fallback for client config');
  
  // Build list of all ENV clients first
  const envClients = [];
  
  // Default client
  if (process.env.WP_API_URL) {
    envClients.push({
      id: 'default',
      url: process.env.WP_API_URL,
      username: process.env.WP_API_USERNAME,
      password: process.env.WP_API_PASSWORD,
      wc_key: process.env.WC_CONSUMER_KEY,
      wc_secret: process.env.WC_CONSUMER_SECRET,
      domain: extractDomain(process.env.WP_API_URL)
    });
  }

  // CLIENT1 through CLIENT20
  for (let i = 1; i <= 20; i++) {
    const prefix = `CLIENT${i}`;
    const url = process.env[`${prefix}_WP_API_URL`];
    if (url) {
      envClients.push({
        id: `client${i}`,
        url: url,
        username: process.env[`${prefix}_WP_API_USERNAME`],
        password: process.env[`${prefix}_WP_API_PASSWORD`],
        wc_key: process.env[`${prefix}_WC_CONSUMER_KEY`],
        wc_secret: process.env[`${prefix}_WC_CONSUMER_SECRET`],
        domain: extractDomain(url)
      });
    }
  }
  
  // If no clientId specified, return default
  if (!clientId || clientId === 'default') {
    const defaultClient = envClients.find(c => c.id === 'default') || envClients[0];
    return {
      url: defaultClient?.url,
      username: defaultClient?.username,
      password: defaultClient?.password,
      wc_key: defaultClient?.wc_key,
      wc_secret: defaultClient?.wc_secret,
      name: 'default',
      source: 'env'
    };
  }
  
  // Try to match by ID first (client1, client2, etc.)
  let matched = envClients.find(c => c.id === clientId.toLowerCase());
  
  // If not found, try to match by domain
  if (!matched) {
    const searchDomain = clientId.replace(/-/g, '.'); // yahavrubin-com -> yahavrubin.com
    matched = envClients.find(c => {
      if (!c.domain) return false;
      return c.domain === searchDomain || 
             c.domain.includes(searchDomain.split('.')[0]) ||
             searchDomain.includes(c.domain.split('.')[0]);
    });
    
    if (matched) {
      console.log(`✅ Matched "${clientId}" to ${matched.domain} (${matched.id})`);
    }
  }
  
  // Return matched client
  if (matched) {
    return {
      url: matched.url,
      username: matched.username,
      password: matched.password,
      wc_key: matched.wc_key,
      wc_secret: matched.wc_secret,
      name: matched.id,
      source: 'env'
    };
  }
  
  // No match found - throw detailed error
  const availableClients = envClients.map(c => `${c.id} (${c.domain})`).join(', ');
  throw new Error(
    `Client not found: "${clientId}". ` +
    `Available clients: [${availableClients}]. ` +
    `Tip: Use exact ID (e.g., "client5") or domain format (e.g., "yahavrubin-com" or "yahavrubin.com")`
  );
}

// Get all available client configurations
async function getAllClientConfigs() {
  const configs = [];
  
  // Try database first
  const dbClients = await loadClientsFromDB();
  
  if (dbClients && dbClients.length > 0) {
    for (const client of dbClients) {
      configs.push({
        id: client.wordpress_client_id || client.name.toLowerCase().replace(/\s+/g, '-'),
        name: client.name,
        domain: extractDomain(client.wordpress_url),
        status: client.status,
        source: 'database'
      });
    }
    return configs;
  }
  
  // Fallback to ENV
  if (process.env.WP_API_URL) {
    configs.push({
      id: 'default',
      name: 'Default',
      domain: extractDomain(process.env.WP_API_URL),
      source: 'env'
    });
  }

  // Check for CLIENT1 through CLIENT20
  for (let i = 1; i <= 20; i++) {
    const clientId = `client${i}`;
    const prefix = `CLIENT${i}`;
    const url = process.env[`${prefix}_WP_API_URL`];

    if (url) {
      configs.push({
        id: clientId,
        name: `Client ${i}`,
        domain: extractDomain(url),
        source: 'env'
      });
    }
  }

  return configs;
}

// Detect client by domain from URL
async function detectClientByDomain(urlString) {
  const domain = extractDomain(urlString);
  if (!domain) return null;

  const allConfigs = await getAllClientConfigs();

  // Find matching client by domain
  for (const { id, domain: clientDomain } of allConfigs) {
    if (clientDomain && clientDomain.includes(domain) || domain.includes(clientDomain)) {
      return id;
    }
  }

  return null;
}

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

async function requireExplicitClientRouting(args, method) {
  if (isSafeRoutingMethod(method)) return;
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

  const response = await fetchWithRetry(url, {
    ...requestOptions,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      ...requestOptions.headers
    }
  });

  const text = await response.text();
  const data = parseWordPressJsonOrThrow({ text, response, url, clientName: initConfig.name || 'default' });

  if (!response.ok) {
    throw new Error(`WordPress API error (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

// Create wpRequest for specific client
function createWpRequestForClient(clientConfig) {
  const baseURL = clientConfig.url.replace(/\/+$/, '');
  const wpApiBase = baseURL.includes('/wp-json') ? baseURL : `${baseURL}/wp-json`;
  const authHeader = 'Basic ' + Buffer.from(`${clientConfig.username}:${clientConfig.password}`).toString('base64');

  return async function(endpoint, options = {}) {
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

    const response = await fetchWithRetry(url, {
      ...requestOptions,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...requestOptions.headers
      }
    });

    const text = await response.text();
    const data = parseWordPressJsonOrThrow({ text, response, url, clientName: clientConfig.name || 'unknown' });

    if (!response.ok) {
      throw new Error(`WordPress API error (${response.status}): ${JSON.stringify(data)}`);
    }

    return data;
  };
}

// Extract a normalized, restore-able state object from a page fetched via
// /wp/v2/pages/{id}?context=edit. Used by wp_publish_draft_over and
// wp_replace_text to return `previous_state`, and by wp_get_page_state /
// wp_restore_page_state as the canonical state shape.
function extractPageState(page) {
  if (!page || typeof page !== 'object') return null;
  const meta = {};
  for (const key of [...ELEMENTOR_META_KEYS, ...SEO_META_KEYS]) {
    if (page.meta && page.meta[key] !== undefined) meta[key] = page.meta[key];
  }
  // Normalize _elementor_data to a string (Elementor stores it as a JSON
  // string in postmeta; some REST consumers return it parsed).
  if (meta._elementor_data !== undefined && typeof meta._elementor_data !== 'string') {
    meta._elementor_data = meta._elementor_data == null ? '' : JSON.stringify(meta._elementor_data);
  }
  return {
    post_id: page.id,
    title: page.title?.raw ?? page.title?.rendered ?? '',
    content: page.content?.raw ?? page.content?.rendered ?? '',
    excerpt: page.excerpt?.raw ?? '',
    status: page.status ?? '',
    template: page.template ?? '',
    menu_order: typeof page.menu_order === 'number' ? page.menu_order : 0,
    featured_media: page.featured_media ?? null,
    meta
  };
}

// Build a /wp/v2/pages/{id} POST payload from a normalized state object.
// Skips empty/null meta values so they don't overwrite live fields with blanks.
function statePayload(state) {
  const payload = {
    title: state.title ?? '',
    content: state.content ?? '',
    excerpt: state.excerpt ?? ''
  };
  if (state.template !== undefined && state.template !== null) payload.template = state.template;
  if (typeof state.menu_order === 'number') payload.menu_order = state.menu_order;
  if (state.featured_media != null) payload.featured_media = state.featured_media;
  if (state.meta && typeof state.meta === 'object') {
    const meta = {};
    for (const [k, v] of Object.entries(state.meta)) {
      if (v === '' || v === null) continue;
      meta[k] = (k === '_elementor_data' && typeof v !== 'string') ? JSON.stringify(v) : v;
    }
    if (Object.keys(meta).length > 0) payload.meta = meta;
  }
  return payload;
}

// Write `_elementor_data` through the privileged Agency OS route when it's
// installed, falling back to the core REST meta write otherwise.
//
// Why this exists: `_elementor_data` is a `_`-prefixed (protected) postmeta key
// that Elementor does NOT register for REST writes. Core REST therefore rejects
// attempts to set it via /wp/v2/pages/{id} ("rest_cannot_update" /
// "rest_protected_meta") even though reads succeed. The mu-plugin route does a
// direct `update_post_meta` behind an `edit_post` capability check, so writes
// land reliably. If the route isn't present we degrade to the old core write so
// nothing breaks on sites that haven't installed the bridge.
async function writeElementorData(wpReq, pageId, data) {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    const res = await wpReq('/agency-os/v1/elementor-data', {
      method: 'POST',
      body: { post_id: pageId, elementor_data: serialized }
    });
    return { via: 'privileged', bytes: res?.bytes ?? serialized.length };
  } catch (error) {
    // Only fall back when the route itself is absent (rest_no_route). A plain
    // 404 from the route means "post not found" — a real error we must surface,
    // not a missing endpoint, so we don't mask it with a core write attempt.
    const notInstalled = /rest_no_route/.test(error.message);
    if (notInstalled) {
      await wpReq(`/wp/v2/pages/${pageId}`, {
        method: 'POST',
        body: { meta: { _elementor_data: serialized } }
      });
      return { via: 'core', bytes: serialized.length };
    }
    throw error;
  }
}

// POST a page update, routing any `_elementor_data` in the payload through the
// privileged route while sending every other field (title, content, excerpt,
// SEO meta, …) via core REST. `body` is the full /wp/v2/pages/{id} payload.
async function updatePageRouted(wpReq, pageId, body) {
  const payload = { ...body };
  let elementor;
  if (payload.meta && payload.meta._elementor_data !== undefined) {
    elementor = payload.meta._elementor_data;
    const { _elementor_data, ...restMeta } = payload.meta;
    if (Object.keys(restMeta).length > 0) payload.meta = restMeta;
    else delete payload.meta;
  }
  if (Object.keys(payload).length > 0) {
    await wpReq(`/wp/v2/pages/${pageId}`, { method: 'POST', body: payload });
  }
  if (elementor !== undefined) {
    return await writeElementorData(wpReq, pageId, elementor);
  }
  return null;
}

const tools = [
  // POSTS (5 endpoints)
  {
    name: 'wp_get_posts',
    description: 'Get WordPress posts with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of posts to retrieve (max 100)', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        status: { type: 'string', description: 'Post status (publish, draft, etc)', default: 'publish' },
        author: { type: 'number', description: 'Author ID' },
        categories: { type: 'string', description: 'Category IDs (comma-separated)' }
      }
    }
  },
  {
    name: 'wp_get_post',
    description: 'Get a specific WordPress post by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_post',
    description: 'Create a new WordPress post',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title', required: true },
        content: { type: 'string', description: 'Post content (HTML)', required: true },
        status: { type: 'string', description: 'Post status (publish, draft, pending)', default: 'draft' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        categories: { type: 'array', items: { type: 'number' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'wp_update_post',
    description: 'Update an existing WordPress post',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post ID', required: true },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        status: { type: 'string', description: 'Post status' },
        excerpt: { type: 'string', description: 'Post excerpt' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_post',
    description: 'Delete a WordPress post',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post ID', required: true },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },

  // PAGES (5 endpoints)
  {
    name: 'wp_get_pages',
    description: 'Get WordPress pages',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of pages to retrieve', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        status: { type: 'string', description: 'Page status', default: 'publish' }
      }
    }
  },
  {
    name: 'wp_get_page',
    description: 'Get a specific WordPress page by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_page',
    description: 'Create a new WordPress page',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title', required: true },
        content: { type: 'string', description: 'Page content (HTML)', required: true },
        status: { type: 'string', description: 'Page status (publish, draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Page excerpt' },
        parent: { type: 'number', description: 'Parent page ID' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'wp_update_page',
    description: 'Update an existing WordPress page',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content (HTML)' },
        status: { type: 'string', description: 'Page status' },
        excerpt: { type: 'string', description: 'Page excerpt. Pass an empty string "" to clear the existing excerpt.' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_page',
    description: 'Delete a WordPress page',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },

  // MEDIA (5 endpoints)
  {
    name: 'wp_get_media',
    description: 'Get WordPress media files',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of media items', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        media_type: { type: 'string', description: 'Media type (image, video, etc)' }
      }
    }
  },
  {
    name: 'wp_get_media_item',
    description: 'Get a specific media item by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Media ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_upload_media',
    description: 'Upload media file (base64 encoded)',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name', required: true },
        base64_content: { type: 'string', description: 'Base64 encoded file content', required: true },
        title: { type: 'string', description: 'Media title' },
        alt_text: { type: 'string', description: 'Alt text for images' }
      },
      required: ['filename', 'base64_content']
    }
  },
  {
    name: 'wp_update_media',
    description: 'Update media item metadata (title, alt text, caption, description)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Media ID', required: true },
        title: { type: 'string', description: 'Media title' },
        alt_text: { type: 'string', description: 'Alternative text for images' },
        caption: { type: 'string', description: 'Media caption' },
        description: { type: 'string', description: 'Media description' },
        post: { type: 'number', description: 'Post ID to attach media to' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_media',
    description: 'Delete a media item',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Media ID', required: true },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },

  // COMMENTS (5 endpoints)
  {
    name: 'wp_get_comments',
    description: 'Get WordPress comments',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of comments', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        post: { type: 'number', description: 'Limit to specific post ID' },
        status: { type: 'string', description: 'Comment status (approve, hold, spam)', default: 'approve' },
        search: { type: 'string', description: 'Search term' }
      }
    }
  },
  {
    name: 'wp_get_comment',
    description: 'Get a specific comment by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Comment ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_comment',
    description: 'Create a new comment on a post',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'number', description: 'Post ID', required: true },
        content: { type: 'string', description: 'Comment content', required: true },
        author_name: { type: 'string', description: 'Comment author name' },
        author_email: { type: 'string', description: 'Comment author email' },
        parent: { type: 'number', description: 'Parent comment ID for replies' }
      },
      required: ['post', 'content']
    }
  },
  {
    name: 'wp_update_comment',
    description: 'Update an existing comment',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Comment ID', required: true },
        content: { type: 'string', description: 'Comment content' },
        status: { type: 'string', description: 'Comment status (approve, hold, spam, trash)' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_comment',
    description: 'Delete a comment',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Comment ID', required: true },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },

  // USERS (3 endpoints)
  {
    name: 'wp_get_users',
    description: 'Get WordPress users',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of users', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        roles: { type: 'string', description: 'Filter by role (admin, editor, author, etc)' }
      }
    }
  },
  {
    name: 'wp_get_user',
    description: 'Get a specific user by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'User ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_get_current_user',
    description: 'Get information about the currently authenticated user',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // CUSTOM POST TYPES (3 endpoints)
  {
    name: 'wp_get_custom_posts',
    description: 'Get posts from a custom post type',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: { type: 'string', description: 'Custom post type slug', required: true },
        per_page: { type: 'number', description: 'Number of posts', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        status: { type: 'string', description: 'Post status', default: 'publish' }
      },
      required: ['post_type']
    }
  },
  {
    name: 'wp_get_custom_post',
    description: 'Get a specific custom post by ID',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: { type: 'string', description: 'Custom post type slug', required: true },
        id: { type: 'number', description: 'Post ID', required: true }
      },
      required: ['post_type', 'id']
    }
  },
  {
    name: 'wp_create_custom_post',
    description: 'Create a new custom post',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: { type: 'string', description: 'Custom post type slug' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content' },
        status: { type: 'string', description: 'Post status', default: 'draft' },
        slug: { type: 'string', description: 'Post slug/permalink' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        featured_media: { type: 'number', description: 'Featured image ID' },
        meta: { type: 'object', description: 'Custom meta fields (key-value pairs)' }
      },
      required: ['post_type', 'title', 'content']
    }
  },
  {
    name: 'wp_update_custom_post',
    description: 'Update an existing custom post type entry (product, experience, etc). Supports Yoast SEO via yoast_title/yoast_desc/yoast_canonical.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'WordPress site URL' },
        post_type: { type: 'string', description: 'Custom post type slug (e.g. product, experiences)' },
        id: { type: 'number', description: 'Post ID to update' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        status: { type: 'string', description: 'Post status' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        meta: { type: 'object', description: 'Raw meta fields (key-value)' },
        yoast_title: { type: 'string', description: 'Yoast SEO title (yoast_wpseo_title)' },
        yoast_desc: { type: 'string', description: 'Yoast SEO meta description (yoast_wpseo_metadesc)' },
        yoast_canonical: { type: 'string', description: 'Yoast canonical URL (yoast_wpseo_canonical)' }
      },
      required: ['post_type', 'id']
    }
  },

  // TAXONOMY (6 endpoints)
  {
    name: 'wp_get_categories',
    description: 'Get WordPress categories',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of categories', default: 100 }
      }
    }
  },
  {
    name: 'wp_get_tags',
    description: 'Get WordPress tags',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of tags', default: 100 }
      }
    }
  },
  {
    name: 'wp_create_category',
    description: 'Create a new category',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name', required: true },
        description: { type: 'string', description: 'Category description' },
        parent: { type: 'number', description: 'Parent category ID' },
        slug: { type: 'string', description: 'Category slug' }
      },
      required: ['name']
    }
  },
  {
    name: 'wp_create_tag',
    description: 'Create a new tag',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name', required: true },
        description: { type: 'string', description: 'Tag description' },
        slug: { type: 'string', description: 'Tag slug' }
      },
      required: ['name']
    }
  },
  {
    name: 'wp_update_category',
    description: 'Update an existing category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID', required: true },
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string', description: 'Category description' },
        parent: { type: 'number', description: 'Parent category ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_category',
    description: 'Delete a category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID', required: true },
        force: { type: 'boolean', description: 'Force deletion', default: false }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_update_tag',
    description: 'Update an existing tag',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Tag ID', required: true },
        name: { type: 'string', description: 'Tag name' },
        description: { type: 'string', description: 'Tag description' },
        slug: { type: 'string', description: 'Tag slug' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_tag',
    description: 'Delete a tag (tags are non-hierarchical so deletion is immediate; the force flag is accepted for symmetry with wp_delete_category but WP requires force=true).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Tag ID', required: true },
        force: { type: 'boolean', description: 'Required by WP REST for tag deletion', default: true }
      },
      required: ['id']
    }
  },

  // SITE INFO (3 endpoints)
  {
    name: 'wp_get_site_info',
    description: 'Get WordPress site information and settings including special page IDs',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wp_get_special_pages',
    description: 'Get special WordPress page IDs (homepage, blog page, privacy policy, etc.) with full page details',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wp_get_post_types',
    description: 'Get all available post types',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // CLIENT MANAGEMENT (new!)
  {
    name: 'wp_list_clients',
    description: 'List all available WordPress clients from database',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wp_refresh_clients',
    description: 'Force refresh the client cache from database',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // FILE OPERATIONS
  {
    name: 'wp_create_file',
    description: 'Create a file on the WordPress server (restricted to allowed directories: wp-content/mu-plugins/, wp-content/uploads/)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from WP root (e.g., "wp-content/mu-plugins/file.php")', required: true },
        content: { type: 'string', description: 'File content', required: true },
        overwrite: { type: 'boolean', description: 'Overwrite if file exists', default: true }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'wp_bootstrap_file_api',
    description: 'Automatically setup File API: checks if installed, installs Code Snippets if needed, creates bootstrap snippet - fully automatic!',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Force reinstall even if File API exists', default: false }
      }
    }
  },
  {
    name: 'wp_check_file_api',
    description: 'Check if the File API endpoint is available on a WordPress site',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // CODE SNIPPETS (7 endpoints) — wraps the Code Snippets plugin REST API
  // (/code-snippets/v1/snippets). Lets you manage PHP/JS/CSS snippets directly,
  // e.g. install a guard snippet without shipping an mu-plugin.
  {
    name: 'wp_list_snippets',
    description: 'List Code Snippets registered on the site (requires the "Code Snippets" plugin). Returns id, name, scope, active state, and tags for each snippet. Use this to discover existing snippets before creating or editing one.',
    inputSchema: {
      type: 'object',
      properties: {
        active_only: { type: 'boolean', description: 'Only return active snippets', default: false }
      }
    }
  },
  {
    name: 'wp_get_snippet',
    description: 'Get a single Code Snippet by ID, including its full code body, scope, priority and active state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Snippet ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_snippet',
    description: 'Create a new Code Snippet. IMPORTANT: provide `code` WITHOUT the opening <?php tag (Code Snippets adds it). Use `scope` to control where it runs: "global" (everywhere), "admin", "front-end", "single-use" (run once then deactivate), "content" (shortcode), or "head-content"/"footer-content" (raw markup). Set `active: true` to enable immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Snippet name', required: true },
        code: { type: 'string', description: 'Snippet body WITHOUT the opening <?php tag', required: true },
        desc: { type: 'string', description: 'Snippet description' },
        scope: { type: 'string', description: 'Execution scope: global, admin, front-end, single-use, content, head-content, footer-content', default: 'global' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to attach to the snippet' },
        priority: { type: 'number', description: 'Execution priority (lower runs earlier)', default: 10 },
        active: { type: 'boolean', description: 'Activate the snippet immediately', default: false }
      },
      required: ['name', 'code']
    }
  },
  {
    name: 'wp_update_snippet',
    description: 'Update an existing Code Snippet by ID. Only the fields you pass are changed. Provide `code` WITHOUT the opening <?php tag.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Snippet ID', required: true },
        name: { type: 'string', description: 'Snippet name' },
        code: { type: 'string', description: 'Snippet body WITHOUT the opening <?php tag' },
        desc: { type: 'string', description: 'Snippet description' },
        scope: { type: 'string', description: 'Execution scope: global, admin, front-end, single-use, content, head-content, footer-content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to attach to the snippet' },
        priority: { type: 'number', description: 'Execution priority (lower runs earlier)' },
        active: { type: 'boolean', description: 'Active state of the snippet' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_activate_snippet',
    description: 'Activate a Code Snippet by ID so its code runs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Snippet ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_deactivate_snippet',
    description: 'Deactivate a Code Snippet by ID so its code stops running (without deleting it).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Snippet ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_snippet',
    description: 'Permanently delete a Code Snippet by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Snippet ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_bootstrap_elementor_writer',
    description: 'Install the privileged Elementor write route (agency-os/v1/elementor-data) as an ACTIVE Code Snippet — no mu-plugin and no file write required. This is the recommended way to enable reliable _elementor_data writes (core REST refuses to write that protected meta). Idempotent: if the route is already live it does nothing; otherwise it creates/updates a global active snippet that registers the route. Requires the "Code Snippets" plugin.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Reinstall/refresh the snippet even if the route already responds', default: false }
      }
    }
  },

  // PLUGINS (6 endpoints)
  {
    name: 'wp_list_plugins',
    description: 'List all installed WordPress plugins with their status',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status: active, inactive, all', default: 'all' },
        search: { type: 'string', description: 'Search term to filter plugins' }
      }
    }
  },
  {
    name: 'wp_install_plugin',
    description: 'Install a plugin from WordPress.org repository by slug',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Plugin slug from WordPress.org (e.g., "akismet", "contact-form-7")', required: true },
        activate: { type: 'boolean', description: 'Activate plugin after installation', default: false }
      },
      required: ['slug']
    }
  },
  {
    name: 'wp_install_plugin_zip',
    description: 'Install a plugin from a ZIP file URL (requires Plugin Installer API - run wp_bootstrap_plugin_installer first)',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to the plugin ZIP file', required: true },
        activate: { type: 'boolean', description: 'Activate plugin after installation', default: false }
      },
      required: ['url']
    }
  },
  {
    name: 'wp_bootstrap_plugin_installer',
    description: 'Setup the Plugin Installer API endpoint for installing plugins from ZIP URLs',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Force reinstall even if API exists', default: false }
      }
    }
  },
  {
    name: 'wp_activate_plugin',
    description: 'Activate an installed WordPress plugin',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")', required: true }
      },
      required: ['plugin']
    }
  },
  {
    name: 'wp_deactivate_plugin',
    description: 'Deactivate an active WordPress plugin',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")', required: true }
      },
      required: ['plugin']
    }
  },
  {
    name: 'wp_delete_plugin',
    description: 'Delete a WordPress plugin (must be deactivated first)',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")', required: true }
      },
      required: ['plugin']
    }
  },
  {
    name: 'wp_update_plugin',
    description: 'Update a WordPress plugin to the latest version',
    inputSchema: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")', required: true }
      },
      required: ['plugin']
    }
  },

  // WOOCOMMERCE PRODUCTS (requires WooCommerce plugin)
  {
    name: 'wc_list_products',
    description: 'List WooCommerce products with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Products per page (max 100)', default: 20 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        category: { type: 'number', description: 'Category ID to filter by' },
        status: { type: 'string', description: 'Status: publish, draft, pending, private, any', default: 'any' },
        type: { type: 'string', description: 'Product type: simple, grouped, external, variable' },
        sku: { type: 'string', description: 'Search by SKU' },
        featured: { type: 'boolean', description: 'Filter featured products' },
        on_sale: { type: 'boolean', description: 'Filter products on sale' }
      }
    }
  },
  {
    name: 'wc_get_product',
    description: 'Get a single WooCommerce product by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Product ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_create_product',
    description: 'Create a new WooCommerce product',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Product name', required: true },
        type: { type: 'string', description: 'Product type: simple, grouped, external, variable', default: 'simple' },
        status: { type: 'string', description: 'Status: draft, pending, publish, private', default: 'publish' },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        description: { type: 'string', description: 'Full product description' },
        short_description: { type: 'string', description: 'Short description' },
        sku: { type: 'string', description: 'SKU (Stock Keeping Unit)' },
        categories: { type: 'array', description: 'Array of category objects [{id: 1}, {id: 2}]' },
        images: { type: 'array', description: 'Array of image objects [{src: "url"}, {id: 123}]' },
        manage_stock: { type: 'boolean', description: 'Enable stock management' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status: instock, outofstock, onbackorder' },
        weight: { type: 'string', description: 'Product weight' },
        dimensions: { type: 'object', description: 'Dimensions: {length, width, height}' },
        attributes: { type: 'array', description: 'Product attributes array' },
        meta_data: { type: 'array', description: 'Meta data array [{key, value}]' }
      },
      required: ['name']
    }
  },
  {
    name: 'wc_update_product',
    description: 'Update an existing WooCommerce product',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Product ID', required: true },
        name: { type: 'string', description: 'Product name' },
        status: { type: 'string', description: 'Status: draft, pending, publish, private' },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        description: { type: 'string', description: 'Full product description' },
        short_description: { type: 'string', description: 'Short description' },
        sku: { type: 'string', description: 'SKU' },
        categories: { type: 'array', description: 'Array of category objects [{id: 1}]' },
        images: { type: 'array', description: 'Array of image objects [{src: "url"}, {id: 123}]' },
        manage_stock: { type: 'boolean', description: 'Enable stock management' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status: instock, outofstock, onbackorder' },
        featured: { type: 'boolean', description: 'Featured product' },
        meta_data: { type: 'array', description: 'Meta data array [{key, value}]' }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_delete_product',
    description: 'Delete a WooCommerce product',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Product ID', required: true },
        force: { type: 'boolean', description: 'True to permanently delete, false to move to trash', default: false }
      },
      required: ['id']
    }
  },

  // WOOCOMMERCE PRODUCT CATEGORIES
  {
    name: 'wc_list_categories',
    description: 'List WooCommerce product categories',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Categories per page', default: 100 },
        search: { type: 'string', description: 'Search term' },
        parent: { type: 'number', description: 'Parent category ID' },
        hide_empty: { type: 'boolean', description: 'Hide empty categories', default: false }
      }
    }
  },
  {
    name: 'wc_create_category',
    description: 'Create a WooCommerce product category',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name', required: true },
        slug: { type: 'string', description: 'Category slug' },
        parent: { type: 'number', description: 'Parent category ID' },
        description: { type: 'string', description: 'Category description' },
        image: { type: 'object', description: 'Category image {src: "url"} or {id: 123}' }
      },
      required: ['name']
    }
  },
  {
    name: 'wc_update_category',
    description: 'Update a WooCommerce product category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID', required: true },
        name: { type: 'string', description: 'Category name' },
        slug: { type: 'string', description: 'Category slug' },
        parent: { type: 'number', description: 'Parent category ID' },
        description: { type: 'string', description: 'Category description' },
        image: { type: 'object', description: 'Category image {src: "url"} or {id: 123}' }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_delete_category',
    description: 'Delete a WooCommerce product category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID', required: true },
        force: { type: 'boolean', description: 'Force delete (required for categories)', default: true }
      },
      required: ['id']
    }
  },

  // WOOCOMMERCE PRODUCT VARIATIONS (for variable products)
  {
    name: 'wc_list_variations',
    description: 'List variations for a variable product',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID', required: true },
        per_page: { type: 'number', description: 'Variations per page', default: 100 }
      },
      required: ['product_id']
    }
  },
  {
    name: 'wc_create_variation',
    description: 'Create a variation for a variable product',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID', required: true },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        sku: { type: 'string', description: 'SKU' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status: instock, outofstock, onbackorder' },
        attributes: { type: 'array', description: 'Variation attributes [{name: "Color", option: "Red"}]', required: true },
        image: { type: 'object', description: 'Variation image {src: "url"} or {id: 123}' }
      },
      required: ['product_id', 'attributes']
    }
  },
  {
    name: 'wc_update_variation',
    description: 'Update a product variation',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID', required: true },
        variation_id: { type: 'number', description: 'Variation ID', required: true },
        regular_price: { type: 'string', description: 'Regular price' },
        sale_price: { type: 'string', description: 'Sale price' },
        sku: { type: 'string', description: 'SKU' },
        stock_quantity: { type: 'number', description: 'Stock quantity' },
        stock_status: { type: 'string', description: 'Stock status' },
        image: { type: 'object', description: 'Variation image' }
      },
      required: ['product_id', 'variation_id']
    }
  },
  {
    name: 'wc_delete_variation',
    description: 'Delete a product variation',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'number', description: 'Parent product ID', required: true },
        variation_id: { type: 'number', description: 'Variation ID', required: true },
        force: { type: 'boolean', description: 'Force permanent delete', default: true }
      },
      required: ['product_id', 'variation_id']
    }
  },

  // WOOCOMMERCE ORDERS
  {
    name: 'wc_list_orders',
    description: 'List WooCommerce orders',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Orders per page', default: 20 },
        page: { type: 'number', description: 'Page number', default: 1 },
        status: { type: 'string', description: 'Status: pending, processing, on-hold, completed, cancelled, refunded, failed, any' },
        customer: { type: 'number', description: 'Customer ID' },
        product: { type: 'number', description: 'Product ID to filter by' },
        after: { type: 'string', description: 'Orders after date (ISO8601)' },
        before: { type: 'string', description: 'Orders before date (ISO8601)' }
      }
    }
  },
  {
    name: 'wc_get_order',
    description: 'Get a single WooCommerce order',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Order ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wc_update_order',
    description: 'Update a WooCommerce order (status, notes, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Order ID', required: true },
        status: { type: 'string', description: 'Order status' },
        customer_note: { type: 'string', description: 'Note for customer' },
        meta_data: { type: 'array', description: 'Meta data array [{key, value}]' }
      },
      required: ['id']
    }
  },

  // ELEMENTOR (7 endpoints)
  {
    name: 'wp_elementor_get_page',
    description: 'Get a WordPress page with full Elementor data (_elementor_data meta). Returns the complete page object including Elementor widgets/sections.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_get_page_by_slug',
    description: 'Find a page ID by its slug (URL-friendly name)',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The page slug to find', required: true }
      },
      required: ['slug']
    }
  },
  {
    name: 'wp_elementor_create_page',
    description: 'Create a new WordPress page with Elementor data',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title', required: true },
        status: { type: 'string', description: 'Page status (publish, draft, pending, private)', default: 'draft' },
        content: { type: 'string', description: 'Standard WordPress content (optional)' },
        elementor_data: { type: 'string', description: 'Elementor page data as JSON string', required: true }
      },
      required: ['title', 'elementor_data']
    }
  },
  {
    name: 'wp_elementor_update_page',
    description: 'Update an existing page with Elementor data',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        title: { type: 'string', description: 'Page title' },
        status: { type: 'string', description: 'Page status' },
        content: { type: 'string', description: 'Standard WordPress content' },
        elementor_data: { type: 'string', description: 'Elementor page data as JSON string' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_delete_page',
    description: 'Delete a WordPress page (Elementor or regular)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_download_page',
    description: 'Download a page and save it to a local file. Can save full page or only Elementor data.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        file_path: { type: 'string', description: 'Absolute path to save the file', required: true },
        only_elementor_data: { type: 'boolean', description: 'Save only _elementor_data (not full page object)', default: false }
      },
      required: ['id', 'file_path']
    }
  },
  {
    name: 'wp_elementor_update_from_file',
    description: 'Update a page with Elementor data read from a local file',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        elementor_file_path: { type: 'string', description: 'Absolute path to the Elementor data JSON file', required: true },
        title: { type: 'string', description: 'Page title (optional)' },
        status: { type: 'string', description: 'Page status (optional)' },
        content_file_path: { type: 'string', description: 'Absolute path to content file (optional)' }
      },
      required: ['id', 'elementor_file_path']
    }
  },
  {
    name: 'wp_elementor_list_templates',
    description: 'List Elementor templates (saved sections, pages, global widgets) from the Elementor Library',
    inputSchema: {
      type: 'object',
      properties: {
        template_type: { type: 'string', description: 'Filter by type: page, section, global, kit, container' },
        per_page: { type: 'number', description: 'Results per page', default: 20 },
        status: { type: 'string', description: 'Template status (publish, draft)', default: 'publish' }
      }
    }
  },
  {
    name: 'wp_elementor_get_template',
    description: 'Get a specific Elementor template by ID (includes _elementor_data)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Template ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_list_revisions',
    description: 'List revisions for a page — useful for comparing versions or rolling back Elementor changes',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID', required: true },
        per_page: { type: 'number', description: 'Number of revisions to return', default: 10 }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_list_blocks',
    description: 'List curated, professionally-designed Elementor blocks/templates that can be inserted into a page. Use this BEFORE building a layout from scratch — pick a block here and insert it instead of hand-crafting widgets. Categories include: about, contact, homepage, landing-page, pricing, portfolio, coming-soon.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (about, contact, homepage, landing-page, pricing, portfolio, coming-soon)' }
      }
    }
  },
  {
    name: 'wp_elementor_get_block',
    description: 'Get the full Elementor JSON for a curated block by id (returned from wp_elementor_list_blocks). Use this to preview structure before inserting, or to extract sections for a custom composition.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: { type: 'string', description: 'Block id from wp_elementor_list_blocks (e.g. "obfx/contact-us")', required: true }
      },
      required: ['block_id']
    }
  },
  {
    name: 'wp_elementor_capabilities',
    description: 'Discover what Elementor features are available on the site BEFORE building. Returns: elementor_version, elementor_pro (active + version), active_kit_id, container_experiment_likely (heuristic based on version), and detected popular Elementor addon plugins (UAE, Essential Addons, JetEngine, etc.). Use this to decide whether to use Pro-only widgets (form, price-table, slides, posts/loop-grid, popup) or fall back to Free alternatives.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wp_set_static_front_page',
    description: 'Set the WordPress homepage to a specific page (Reading Settings → "A static page"). Returns `previous_state` for rollback. Optionally also sets the "Posts page" (blog listing). Pass page_id:0 to revert to "Your latest posts".',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id to use as homepage. Pass 0 to revert to latest-posts mode.', required: true },
        posts_page_id: { type: 'number', description: 'Optional. Page id for the blog/posts listing.' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'wp_elementor_guidelines',
    description: 'Return the site\'s Elementor design guidelines: color palette, typography, layout constants, and observed common patterns. Use this BEFORE creating/modifying widgets so new content matches the site\'s style instead of using default-ugly values. Pulls from the active Elementor Kit (Site Settings) and optionally analyzes recent pages.',
    inputSchema: {
      type: 'object',
      properties: {
        include_observed: { type: 'boolean', description: 'Also analyze recent pages to surface commonly-used colors/fonts/weights', default: true },
        sample_size: { type: 'number', description: 'Number of recent pages to analyze for observed patterns', default: 10 }
      }
    }
  },
  {
    name: 'wp_elementor_insert_block',
    description: 'Insert a curated block into an existing page. Fetches the block, regenerates element ids to avoid collisions, and appends (or inserts at the given position) into the page _elementor_data. Use this instead of hand-writing widget JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Target page id', required: true },
        block_id: { type: 'string', description: 'Block id from wp_elementor_list_blocks', required: true },
        position: { type: 'string', description: 'Insert position: "end" (default), "start", or a zero-based index as string', default: 'end' }
      },
      required: ['page_id', 'block_id']
    }
  },

  // ── SURGICAL PRIMITIVES — address Elementor elements by id ──
  // Inspect, patch, duplicate, or insert a single element without touching the
  // rest of the page. Mutating tools return `previous_state` for rollback.
  {
    name: 'wp_elementor_get_page_structure',
    description: 'Return a compact navigable summary of a page\'s Elementor tree: every element\'s id, elType, widgetType, and a short text snippet — without the heavy `settings` payload. Use this BEFORE wp_elementor_update_widget / wp_elementor_duplicate_widget so you know which id to act on. Much cheaper than parsing the full _elementor_data.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id', required: true },
        max_snippet_length: { type: 'number', description: 'Max chars per widget snippet (default 80)', default: 80 }
      },
      required: ['page_id']
    }
  },
  {
    name: 'wp_elementor_get_widget_settings',
    description: 'Read the full settings of a single Elementor element by id. Works for any element (widget, column, section, container) — use wp_elementor_get_page_structure first to find the id you need.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id', required: true },
        element_id: { type: 'string', description: 'Element id (8-char hex from get_page_structure)', required: true }
      },
      required: ['page_id', 'element_id']
    }
  },
  {
    name: 'wp_elementor_update_widget',
    description: 'Patch the settings of a single Elementor element (widget, section, column, or container). Default behavior is a SHALLOW merge into existing settings — settings_patch keys overwrite, untouched keys are preserved. Pass replace_settings:true to swap the entire settings object instead. Returns `previous_state` for rollback.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id', required: true },
        element_id: { type: 'string', description: 'Element id', required: true },
        settings_patch: { type: 'object', description: 'Settings to merge (or replace) into the element. Top-level keys overwrite existing same-named keys in the element\'s settings object.', required: true },
        replace_settings: { type: 'boolean', description: 'If true, replace the settings object entirely instead of shallow-merging.', default: false }
      },
      required: ['page_id', 'element_id', 'settings_patch']
    }
  },
  {
    name: 'wp_elementor_duplicate_widget',
    description: 'Duplicate an element (widget, section, column, container) within the same page. Ids are regenerated for the clone and any descendants. Default position is "after" (right after the original, in the same parent). Use this for card-grid patterns: build one card, duplicate N times, then patch each copy.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id', required: true },
        element_id: { type: 'string', description: 'Element id to duplicate', required: true },
        position: { type: 'string', enum: ['after', 'before', 'start', 'end'], description: '"after" / "before" (relative to original, same parent), or "start" / "end" (of the parent container).', default: 'after' }
      },
      required: ['page_id', 'element_id']
    }
  },
  {
    name: 'wp_elementor_insert_widget',
    description: 'Insert a new Elementor element (typically a single widget) into a page at a precise location. Use this for surgical additions: a shortcode mid-page, an HTML widget with scoped CSS next to a target, an extra button in an existing column. For multi-section blocks, prefer wp_elementor_insert_block.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id', required: true },
        widget: {
          type: 'object',
          description: 'Widget config: { widgetType: "shortcode" | "heading" | "button" | ... , settings: {...} }. elType defaults to "widget". Optional `elements: []` for nested children. id is auto-generated.',
          required: true
        },
        position: {
          description: 'Insertion target. Strings "start" / "end" or an integer = root-level position. Object forms: { after_id: "abc12345" } / { before_id: "abc12345" } = sibling of that element; { parent_id: "col1", position: "end"|"start"|N } = inside that parent.',
          required: true
        }
      },
      required: ['page_id', 'widget', 'position']
    }
  },

  // ── CONTROL PLANE (publish-draft-over / replace-text / restore-page-state) ──
  // Pure REST — no plugin installation on the WordPress site required.
  // Stateless: destructive ops return a full `previous_state` in their response
  // so the caller can pass it back to wp_restore_page_state for rollback.
  {
    name: 'wp_publish_draft_over',
    description: 'Promote a draft on top of an existing canonical page: copy title/content/_elementor_data plus (by default) Elementor page settings, featured image, SEO meta (Yoast + RankMath), excerpt, template, and menu_order from the draft into the target page (preserving target id, URL, and status). Verifies the write, then permanently deletes the draft. Returns `previous_state` (the target\'s pre-write state) — hold on to it if you want to roll back via wp_restore_page_state. Use this to ship a redesign without changing the live URL.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'number', description: 'Source draft page id (will be deleted on success)' },
        target_id: { type: 'number', description: 'Live target page id (will be overwritten with draft content)' },
        copy_seo: { type: 'boolean', description: 'Also copy Yoast + RankMath SEO meta keys present on the draft', default: true },
        copy_featured_image: { type: 'boolean', description: 'Also copy featured_media id from draft', default: true },
        copy_taxonomies: { type: 'boolean', description: 'Also copy taxonomy term ids (categories, tags, custom tax) from draft', default: false },
        extra_meta_keys: { type: 'array', items: { type: 'string' }, description: 'Additional postmeta keys to copy from draft.meta (must be registered with show_in_rest)', default: [] }
      },
      required: ['draft_id', 'target_id']
    }
  },
  {
    name: 'wp_replace_text',
    description: 'Bulk find/replace across a page: post_content + Elementor widget text fields (title, editor HTML, button text, descriptions, captions, tab titles, testimonials, etc.). Skips dynamic-tag fields. Defaults to literal case-sensitive match; set regex=true or case_insensitive=true. Use dry_run=true to preview matches without writing. On a real (non-dry) write, returns `previous_state` (the page\'s pre-write state) — hold on to it for rollback via wp_restore_page_state.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'Page id' },
        find: { type: 'string', description: 'String to find (or regex pattern body if regex=true)' },
        replace: { type: 'string', description: 'Replacement string (default empty = deletion)', default: '' },
        regex: { type: 'boolean', description: 'Treat `find` as a JS regex pattern (without delimiters or flags)', default: false },
        case_insensitive: { type: 'boolean', description: 'Match case-insensitively', default: false },
        dry_run: { type: 'boolean', description: 'Report matches without writing', default: false }
      },
      required: ['post_id', 'find']
    }
  },
  {
    name: 'wp_get_page_state',
    description: 'Read a page and return a normalized, restore-able `state` object — exactly the shape that wp_restore_page_state accepts. Use this to capture a baseline before a multi-step edit you want to be able to undo.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'Page id to capture' }
      },
      required: ['post_id']
    }
  },
  {
    name: 'wp_restore_page_state',
    description: 'Write a previously-captured `state` object back onto a page. Restores title, content, excerpt, template, menu_order, featured_media, and the captured meta (Elementor + SEO keys). Verifies _elementor_data byte-length matches the input. Pair with `previous_state` returned by wp_publish_draft_over / wp_replace_text, or with the output of wp_get_page_state.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'Page id to restore onto (authoritative — overrides state.post_id)' },
        state: { type: 'object', description: 'State object: { title, content, excerpt, template, menu_order, featured_media, meta: { ... } }' }
      },
      required: ['post_id', 'state']
    }
  },

  // ── MENUS ──
  {
    name: 'wp_get_menus',
    description: 'List all navigation menus on the site',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wp_get_menu_items',
    description: 'Get all items in a specific menu (links, pages, categories, custom items)',
    inputSchema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'Menu ID (from wp_get_menus)', required: true }
      },
      required: ['menu_id']
    }
  },

  // ── SEARCH ──
  {
    name: 'wp_search',
    description: 'Unified search across all content types (posts, pages, media, categories, tags)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search query', required: true },
        type: { type: 'string', description: 'Filter by type: post, page, category, post_tag' },
        per_page: { type: 'number', description: 'Results per page', default: 20 }
      },
      required: ['search']
    }
  },

  // ── BULK OPERATIONS ──
  {
    name: 'wp_bulk_update_posts',
    description: 'Update multiple posts/pages at once (change status, category, author, meta fields). Saves API calls.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'number' }, description: 'Array of post/page IDs to update', required: true },
        updates: {
          type: 'object',
          description: 'Fields to update on all items: status, categories, tags, author, meta, etc.',
          properties: {
            status: { type: 'string', description: 'draft, publish, pending, private, trash' },
            categories: { type: 'array', items: { type: 'number' }, description: 'Category IDs' },
            tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' },
            author: { type: 'number', description: 'Author user ID' },
            meta: { type: 'object', description: 'Meta fields to update' }
          }
        },
        post_type: { type: 'string', description: 'posts or pages', default: 'posts' }
      },
      required: ['ids', 'updates']
    }
  },

  // ── PAGE TREE ──
  {
    name: 'wp_get_page_tree',
    description: 'Get hierarchical page structure (parent/child relationships) — useful for understanding site architecture',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Max pages to fetch', default: 100 }
      }
    }
  },

  // ── RANKMATH SEO ──
  {
    name: 'wp_rankmath_update_meta',
    description: 'Update RankMath SEO meta (title, description, focus keyword) for a post/page. Works on sites with RankMath plugin (caio, kedma, shukeat).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page ID', required: true },
        post_type: { type: 'string', description: 'post or page', default: 'post' },
        title: { type: 'string', description: 'SEO title' },
        description: { type: 'string', description: 'Meta description' },
        focus_keyword: { type: 'string', description: 'Focus keyword' },
        robots: { type: 'array', items: { type: 'string' }, description: 'Robots directives: index, noindex, follow, nofollow' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_rankmath_get_meta',
    description: 'Get RankMath SEO meta (title, description, focus keyword, robots, score) for a post/page',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page ID', required: true },
        post_type: { type: 'string', description: 'post or page', default: 'post' }
      },
      required: ['id']
    }
  },

  // ── YOAST SEO ──
  {
    name: 'wp_yoast_get_head',
    description: 'Get Yoast SEO head data (title, description, og tags, schema, robots) for any URL. Works on sites with Yoast (smartup, xod).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to get SEO head for', required: true }
      },
      required: ['url']
    }
  },
  {
    name: 'wp_yoast_update_meta',
    description: 'Update Yoast SEO meta (title, description, focus keyword, robots) for a post/page. Works on sites with Yoast (smartup, xod).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page ID', required: true },
        post_type: { type: 'string', description: 'post or page', default: 'post' },
        title: { type: 'string', description: 'SEO title' },
        description: { type: 'string', description: 'Meta description' },
        focus_keyword: { type: 'string', description: 'Focus keyphrase' },
        robots_noindex: { type: 'boolean', description: 'Set noindex (true = noindex)' },
        robots_nofollow: { type: 'boolean', description: 'Set nofollow (true = nofollow)' },
        canonical: { type: 'string', description: 'Canonical URL override' },
        og_title: { type: 'string', description: 'Open Graph title' },
        og_description: { type: 'string', description: 'Open Graph description' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_yoast_get_meta',
    description: 'Get Yoast SEO meta fields (title, description, focus keyword, robots, canonical) for a specific post/page by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page ID', required: true },
        post_type: { type: 'string', description: 'post or page', default: 'post' }
      },
      required: ['id']
    }
  },

  // ── SETTINGS ──
  {
    name: 'wp_get_settings',
    description: 'Get WordPress site settings (title, tagline, timezone, language, date/time format, URL)',
    inputSchema: { type: 'object', properties: {} }
  },

  // ── REDIRECTS ──
  {
    name: 'wp_get_redirects',
    description: 'List redirects managed by Redirection or RankMath plugin. Returns source URL, target URL, type (301/302), and hit count.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Results per page', default: 50 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search redirects by URL' }
      }
    }
  },
  {
    name: 'wp_create_redirect',
    description: 'Create a new redirect rule (301/302). Uses RankMath or Redirection plugin API.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source URL path (e.g. /old-page)', required: true },
        target: { type: 'string', description: 'Target URL (e.g. /new-page or full URL)', required: true },
        type: { type: 'number', description: 'Redirect type: 301 (permanent) or 302 (temporary)', default: 301 }
      },
      required: ['source', 'target']
    }
  }
];

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
  // Get client-specific wpRequest if provided
  const wpReq = clientConfig ? createWpRequestForClient(clientConfig) : wpRequest;
  const currentAuthHeader = clientConfig 
    ? 'Basic ' + Buffer.from(`${clientConfig.username}:${clientConfig.password}`).toString('base64')
    : authHeader;

  switch (name) {
    // CLIENT MANAGEMENT
    case 'wp_list_clients': {
      const clients = await getAllClientConfigs();
      return { 
        clients,
        count: clients.length,
        source: clients[0]?.source || 'none'
      };
    }

    case 'wp_refresh_clients': {
      invalidateClientCache();
      const clients = await loadClientsFromDB();
      return { 
        success: true,
        count: clients?.length || 0,
        message: clients ? 'Cache refreshed from database' : 'Using ENV fallback'
      };
    }

    // POSTS
    case 'wp_get_posts': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'publish'
      });
      if (args.search) params.append('search', args.search);
      if (args.author) params.append('author', String(args.author));
      if (args.categories) params.append('categories', args.categories);
      
      const posts = await wpReq(`/wp/v2/posts?${params}`);
      return { posts: posts.map(p => ({ id: p.id, title: p.title.rendered, excerpt: p.excerpt.rendered, date: p.date, link: p.link })) };
    }

    case 'wp_get_post': {
      const post = await wpReq(`/wp/v2/posts/${args.id}`);
      return { 
        id: post.id, 
        title: post.title.rendered, 
        content: post.content.rendered, 
        excerpt: post.excerpt.rendered,
        date: post.date,
        status: post.status,
        link: post.link
      };
    }

    case 'wp_create_post': {
      const postData = {
        title: args.title,
        content: args.content,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags
      };
      if (args.slug) postData.slug = args.slug;
      if (args.featured_media) postData.featured_media = args.featured_media;
      if (args.meta) postData.meta = args.meta;
      const post = await wpReq('/wp/v2/posts', {
        method: 'POST',
        body: JSON.stringify(postData)
      });
      return {
        id: post.id,
        title: post.title.rendered,
        slug: post.slug,
        link: post.link,
        status: post.status,
        date: post.date,
        modified: post.modified,
        excerpt: post.excerpt?.rendered,
        author: post.author,
        categories: post.categories,
        tags: post.tags,
        featured_media: post.featured_media
      };
    }

    case 'wp_update_post': {
      const updates = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.content !== undefined) updates.content = args.content;
      if (args.status !== undefined) updates.status = args.status;
      if (args.excerpt !== undefined) updates.excerpt = args.excerpt;
      if (args.meta !== undefined) updates.meta = args.meta;
      // Yoast SEO shorthand
      if (args.yoast_title !== undefined || args.yoast_desc !== undefined || args.yoast_canonical !== undefined) {
        updates.meta = updates.meta || {};
        if (args.yoast_title !== undefined) updates.meta['yoast_wpseo_title'] = args.yoast_title;
        if (args.yoast_desc !== undefined) updates.meta['yoast_wpseo_metadesc'] = args.yoast_desc;
        if (args.yoast_canonical !== undefined) updates.meta['yoast_wpseo_canonical'] = args.yoast_canonical;
      }

      const post = await wpReq(`/wp/v2/posts/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return {
        id: post.id,
        title: post.title.rendered,
        slug: post.slug,
        link: post.link,
        status: post.status,
        date: post.date,
        modified: post.modified,
        excerpt: post.excerpt?.rendered,
        author: post.author,
        categories: post.categories,
        tags: post.tags,
        featured_media: post.featured_media
      };
    }

    case 'wp_delete_post': {
      await wpReq(`/wp/v2/posts/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    // PAGES
    case 'wp_get_pages': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'publish'
      });
      if (args.search) params.append('search', args.search);
      
      const pages = await wpReq(`/wp/v2/pages?${params}`);
      return { pages: pages.map(p => ({ id: p.id, title: p.title.rendered, link: p.link })) };
    }

    case 'wp_get_page': {
      const page = await wpReq(`/wp/v2/pages/${args.id}`);
      return {
        id: page.id,
        title: page.title.rendered,
        content: page.content.rendered,
        date: page.date,
        status: page.status,
        link: page.link
      };
    }

    case 'wp_create_page': {
      const page = await wpReq('/wp/v2/pages', {
        method: 'POST',
        body: JSON.stringify({
          title: args.title,
          content: args.content,
          status: args.status || 'draft',
          ...(args.excerpt !== undefined ? { excerpt: args.excerpt } : {}),
          parent: args.parent
        })
      });
      return {
        id: page.id,
        title: page.title.rendered,
        slug: page.slug,
        link: page.link,
        status: page.status,
        date: page.date,
        modified: page.modified,
        parent: page.parent,
        author: page.author,
        featured_media: page.featured_media,
        menu_order: page.menu_order
      };
    }

    case 'wp_update_page': {
      const updates = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.content !== undefined) updates.content = args.content;
      if (args.status !== undefined) updates.status = args.status;
      // Pass excerpt through even when it's an empty string, so callers can
      // clear an existing excerpt with excerpt: "".
      if (args.excerpt !== undefined) updates.excerpt = args.excerpt;
      if (args.meta !== undefined) updates.meta = args.meta;
      // Yoast SEO shorthand
      if (args.yoast_title !== undefined || args.yoast_desc !== undefined || args.yoast_canonical !== undefined) {
        updates.meta = updates.meta || {};
        if (args.yoast_title !== undefined) updates.meta['yoast_wpseo_title'] = args.yoast_title;
        if (args.yoast_desc !== undefined) updates.meta['yoast_wpseo_metadesc'] = args.yoast_desc;
        if (args.yoast_canonical !== undefined) updates.meta['yoast_wpseo_canonical'] = args.yoast_canonical;
      }

      const page = await wpReq(`/wp/v2/pages/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return {
        id: page.id,
        title: page.title.rendered,
        slug: page.slug,
        link: page.link,
        status: page.status,
        date: page.date,
        modified: page.modified,
        excerpt: page.excerpt?.raw ?? page.excerpt?.rendered ?? '',
        parent: page.parent,
        author: page.author,
        featured_media: page.featured_media,
        menu_order: page.menu_order
      };
    }

    case 'wp_delete_page': {
      await wpReq(`/wp/v2/pages/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    // ELEMENTOR
    case 'wp_elementor_get_page': {
      const page = await wpReq(`/wp/v2/pages/${args.id}?context=edit`);
      return page;
    }

    case 'wp_elementor_get_page_by_slug': {
      const pages = await wpReq(`/wp/v2/pages?slug=${encodeURIComponent(args.slug)}&_fields=id`);
      if (pages && pages.length > 0) {
        return { id: pages[0].id };
      }
      throw new Error(`Page with slug '${args.slug}' not found.`);
    }

    case 'wp_elementor_create_page': {
      if (args.elementor_data && typeof args.elementor_data === 'string') {
        try { JSON.parse(args.elementor_data); } catch (e) {
          throw new Error('elementor_data is not valid JSON string.');
        }
      }
      const created = await wpReq('/wp/v2/pages', {
        method: 'POST',
        body: {
          title: args.title,
          status: args.status || 'draft',
          content: args.content || ''
        }
      });
      // Write _elementor_data through the privileged route (core REST rejects
      // protected meta writes), with a fallback to the core write inside.
      let elementorWrite = null;
      if (args.elementor_data) {
        elementorWrite = await writeElementorData(wpReq, created.id, args.elementor_data);
      }
      return { id: created.id, title: created.title?.rendered || args.title, elementor_write: elementorWrite };
    }

    case 'wp_elementor_update_page': {
      const updatePayload = {};
      if (args.title !== undefined) updatePayload.title = args.title;
      if (args.status !== undefined) updatePayload.status = args.status;
      if (args.content !== undefined) updatePayload.content = args.content;
      if (args.elementor_data) {
        if (typeof args.elementor_data === 'string') {
          try { JSON.parse(args.elementor_data); } catch (e) {
            throw new Error('elementor_data is not valid JSON string.');
          }
        }
        updatePayload.meta = { _elementor_data: args.elementor_data };
      }
      if (Object.keys(updatePayload).length === 0) {
        throw new Error('No update data provided (title, status, content, or elementor_data).');
      }
      const elementorWrite = await updatePageRouted(wpReq, args.id, updatePayload);
      return { updated: true, id: args.id, elementor_write: elementorWrite };
    }

    case 'wp_elementor_delete_page': {
      await wpReq(`/wp/v2/pages/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    case 'wp_elementor_download_page': {
      const pageData = await wpReq(`/wp/v2/pages/${args.id}?context=edit`);
      if (args.only_elementor_data) {
        const elementorData = pageData.meta?._elementor_data ?? '';
        fs.writeFileSync(
          args.file_path,
          typeof elementorData === 'string' ? elementorData : JSON.stringify(elementorData, null, 0)
        );
      } else {
        fs.writeFileSync(args.file_path, JSON.stringify(pageData, null, 0));
      }
      return { saved: true, path: args.file_path };
    }

    case 'wp_elementor_update_from_file': {
      const rawElementorData = fs.readFileSync(args.elementor_file_path, 'utf8');
      const parsedElementorData = JSON.parse(rawElementorData);
      const elementorData = typeof parsedElementorData === 'string'
        ? parsedElementorData
        : JSON.stringify(parsedElementorData, null, 0);
      const fileUpdatePayload = {
        meta: { _elementor_data: elementorData }
      };
      if (args.title !== undefined) fileUpdatePayload.title = args.title;
      if (args.status !== undefined) fileUpdatePayload.status = args.status;
      if (args.content_file_path) {
        fileUpdatePayload.content = fs.readFileSync(args.content_file_path, 'utf8');
      }
      const elementorWrite = await updatePageRouted(wpReq, args.id, fileUpdatePayload);
      return { updated: true, id: args.id, elementor_write: elementorWrite };
    }

    case 'wp_elementor_list_templates': {
      const tplParams = new URLSearchParams({
        per_page: String(args.per_page || 20),
        status: args.status || 'publish'
      });
      const templates = await wpReq(`/wp/v2/elementor_library?${tplParams}`);
      const result = (templates || []).map(t => ({
        id: t.id,
        title: t.title?.rendered || '',
        status: t.status,
        template_type: t.meta?._elementor_template_type || 'unknown',
        modified: t.modified
      }));
      if (args.template_type) {
        return result.filter(t => t.template_type === args.template_type);
      }
      return result;
    }

    case 'wp_elementor_get_template': {
      const template = await wpReq(`/wp/v2/elementor_library/${args.id}?context=edit`);
      return template;
    }

    case 'wp_elementor_list_revisions': {
      const revisions = await wpReq(`/wp/v2/pages/${args.id}/revisions?per_page=${args.per_page || 10}`);
      return (revisions || []).map(r => ({
        id: r.id,
        date: r.date,
        author: r.author,
        title: r.title?.rendered || '',
        has_elementor_data: !!(r.meta?._elementor_data)
      }));
    }

    case 'wp_elementor_list_blocks': {
      const blocks = listBlocks({ category: args.category });
      return {
        total: blocks.length,
        categories: [...new Set(BLOCKS_MANIFEST.map(b => b.category))].sort(),
        blocks
      };
    }

    case 'wp_elementor_get_block': {
      return await getBlock(args.block_id);
    }

    case 'wp_elementor_guidelines': {
      return await buildGuidelines(wpReq, {
        include_observed: args.include_observed !== false,
        sample_size: args.sample_size
      });
    }

    case 'wp_elementor_capabilities': {
      // Plugin slugs we look for. The values are the brand-friendly labels we
      // surface back. Keep this list short — the agent can probe specific
      // plugins via wp_list_plugins if it needs more.
      const KNOWN_ADDON_PACKS = {
        'elementor':                         'Elementor (core)',
        'elementor-pro':                     'Elementor Pro',
        'header-footer-elementor':           'Header Footer Elementor (HFE)',
        'ultimate-elementor':                'Ultimate Addons for Elementor (UAE)',
        'premium-addons-for-elementor':      'Premium Addons for Elementor',
        'powerpack-elements':                'PowerPack',
        'essential-addons-for-elementor-lite': 'Essential Addons',
        'happy-elementor-addons':            'Happy Addons',
        'jet-engine':                        'JetEngine',
        'jet-elements':                      'JetElements',
        'jet-tabs':                          'JetTabs',
        'jet-blocks':                        'JetBlocks',
        'jet-blog':                          'JetBlog',
        'jet-menu':                          'JetMenu',
        'jet-popup':                         'JetPopup',
        'jet-smart-filters':                 'JetSmartFilters',
        'elementskit-lite':                  'ElementsKit',
        'the-plus-addons-for-elementor':     'The Plus Addons',
        'exclusive-addons-for-elementor':    'Exclusive Addons',
        'master-addons':                     'Master Addons'
      };

      // Read installed plugins. /wp/v2/plugins returns entries shaped like
      // { plugin: "elementor/elementor", status, name, version, ... }.
      let plugins = [];
      try {
        plugins = await wpReq('/wp/v2/plugins?context=edit');
      } catch (e) {
        // Some sites lock down /wp/v2/plugins for non-admins. Continue with
        // partial info; agent can still query other endpoints.
      }
      if (!Array.isArray(plugins)) plugins = [];

      const detected = {};
      let elementorVersion = null;
      let proActive = false;
      let proVersion = null;
      for (const p of plugins) {
        const slug = (p.plugin || '').split('/')[0];
        if (!slug || !(slug in KNOWN_ADDON_PACKS)) continue;
        detected[slug] = {
          label: KNOWN_ADDON_PACKS[slug],
          active: p.status === 'active',
          version: p.version || null
        };
        if (slug === 'elementor' && p.status === 'active') elementorVersion = p.version || null;
        if (slug === 'elementor-pro' && p.status === 'active') {
          proActive = true;
          proVersion = p.version || null;
        }
      }

      // Active kit id, if exposed.
      let activeKitId = null;
      try {
        const settings = await wpReq('/wp/v2/settings');
        if (settings && typeof settings.elementor_active_kit === 'number') {
          activeKitId = settings.elementor_active_kit;
        }
      } catch { /* settings may be locked down */ }

      // Container experiment is ON by default from Elementor 3.6 (Aug 2022).
      // A robust check requires an option read; we surface it as a heuristic.
      const containerLikely = (() => {
        if (!elementorVersion) return null;
        const major = parseInt(elementorVersion.split('.')[0] || '0', 10);
        const minor = parseInt(elementorVersion.split('.')[1] || '0', 10);
        if (major > 3) return true;
        if (major === 3 && minor >= 6) return true;
        return false;
      })();

      return {
        elementor: {
          installed: elementorVersion !== null || ('elementor' in detected),
          active: elementorVersion !== null,
          version: elementorVersion
        },
        elementor_pro: {
          installed: ('elementor-pro' in detected),
          active: proActive,
          version: proVersion
        },
        container_experiment_likely: containerLikely,
        active_kit_id: activeKitId,
        addon_packs: detected,
        plugins_endpoint_accessible: plugins.length > 0
      };
    }

    case 'wp_set_static_front_page': {
      if (typeof args.page_id !== 'number') throw new Error('page_id (number) required');
      const pageId = args.page_id;
      const postsPageId = typeof args.posts_page_id === 'number' ? args.posts_page_id : undefined;

      // Capture current state for rollback.
      const before = await wpReq('/wp/v2/settings');
      const previousState = {
        show_on_front: before?.show_on_front ?? null,
        page_on_front: before?.page_on_front ?? null,
        page_for_posts: before?.page_for_posts ?? null
      };

      const body = {};
      if (pageId === 0) {
        // Revert to "Your latest posts" mode.
        body.show_on_front = 'posts';
        body.page_on_front = 0;
        if (postsPageId !== undefined) body.page_for_posts = postsPageId;
      } else {
        body.show_on_front = 'page';
        body.page_on_front = pageId;
        if (postsPageId !== undefined) body.page_for_posts = postsPageId;
      }

      const after = await wpReq('/wp/v2/settings', { method: 'POST', body });
      return {
        updated: true,
        mode: body.show_on_front,
        page_on_front: after?.page_on_front ?? body.page_on_front,
        page_for_posts: after?.page_for_posts ?? null,
        previous_state: previousState
      };
    }


    case 'wp_elementor_insert_block': {
      const block = await getBlock(args.block_id);
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`);
      const currentSections = parseElementorData(page.meta?._elementor_data);

      let position = args.position ?? 'end';
      if (typeof position === 'string' && /^\d+$/.test(position)) {
        position = parseInt(position, 10);
      }

      const merged = spliceBlock(currentSections, block.content, position);
      const serialized = JSON.stringify(merged);

      await writeElementorData(wpReq, args.page_id, serialized);

      return {
        inserted: true,
        page_id: args.page_id,
        block_id: args.block_id,
        block_title: block.title,
        sections_added: block.content.length,
        total_sections: merged.length,
        position
      };
    }

    // ── SURGICAL PRIMITIVES ──
    case 'wp_elementor_get_page_structure': {
      if (!args.page_id) throw new Error('page_id required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,title,meta`);
      const tree = parseElementorData(page.meta?._elementor_data);
      const summary = summarizeTree(tree, { max_snippet_length: args.max_snippet_length });
      return {
        page_id: page.id,
        page_title: page.title?.rendered || '',
        stats: summary.stats,
        tree: summary.tree
      };
    }

    case 'wp_elementor_get_widget_settings': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const tree = parseElementorData(page.meta?._elementor_data);
      const hit = findElementById(tree, args.element_id);
      if (!hit) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);
      return {
        page_id: page.id,
        element_id: hit.element.id,
        elType: hit.element.elType,
        widgetType: hit.element.widgetType || null,
        settings: hit.element.settings || {},
        child_count: Array.isArray(hit.element.elements) ? hit.element.elements.length : 0,
        ancestors_ids: hit.ancestors.map(a => a.id)
      };
    }

    case 'wp_elementor_update_widget': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      if (!args.settings_patch || typeof args.settings_patch !== 'object') {
        throw new Error('settings_patch (object) required');
      }
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`);
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const hit = findElementById(tree, args.element_id);
      if (!hit) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);

      const beforeSettings = hit.element.settings || {};
      const newTree = patchElementById(tree, args.element_id, (el) => ({
        ...el,
        settings: args.replace_settings
          ? { ...args.settings_patch }
          : { ...el.settings, ...args.settings_patch }
      }));
      if (!newTree) throw new Error('Patch failed unexpectedly');

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;
      const verified = verifyBytes === serialized.length;

      return {
        updated: true,
        page_id: args.page_id,
        element_id: args.element_id,
        verified,
        bytes_written: serialized.length,
        changed_keys: args.replace_settings
          ? Object.keys(args.settings_patch)
          : Object.keys(args.settings_patch).filter(k => beforeSettings[k] !== args.settings_patch[k]),
        previous_state: previousState
      };
    }

    case 'wp_elementor_duplicate_widget': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      const where = args.position || 'after';
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`);
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, duplicateId } = duplicateElementById(tree, args.element_id, where);
      if (!duplicateId) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        duplicated: true,
        page_id: args.page_id,
        source_id: args.element_id,
        new_id: duplicateId,
        position: where,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }

    case 'wp_elementor_insert_widget': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.widget) throw new Error('widget (object) required');
      if (args.position === undefined) throw new Error('position required');

      const widget = normalizeWidget(args.widget);
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`);
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, insertedId } = insertElement(tree, widget, args.position);
      const serialized = JSON.stringify(newTree);

      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        inserted: true,
        page_id: args.page_id,
        element_id: insertedId,
        widgetType: widget.widgetType || null,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }

    // ── CONTROL PLANE ──
    // Pure REST, stateless. Destructive ops return `previous_state` so the
    // caller can pass it back to wp_restore_page_state to roll back.
    case 'wp_publish_draft_over': {
      const draftId = args.draft_id;
      const targetId = args.target_id;
      const copySeo = args.copy_seo !== false;
      const copyFeaturedImage = args.copy_featured_image !== false;
      const copyTaxonomies = args.copy_taxonomies === true;
      const extraMetaKeys = Array.isArray(args.extra_meta_keys) ? args.extra_meta_keys : [];

      if (!draftId || !targetId) throw new Error('draft_id and target_id required');
      if (draftId === targetId) throw new Error('draft_id and target_id must differ');

      const draft = await wpReq(`/wp/v2/pages/${draftId}?context=edit`);
      if (!draft || !draft.id) throw new Error(`Draft page ${draftId} not found`);
      const target = await wpReq(`/wp/v2/pages/${targetId}?context=edit`);
      if (!target || !target.id) throw new Error(`Target page ${targetId} not found`);

      const previousState = extractPageState(target);

      const payload = {
        title: draft.title?.raw ?? draft.title?.rendered ?? '',
        content: draft.content?.raw ?? draft.content?.rendered ?? '',
        excerpt: draft.excerpt?.raw ?? ''
      };
      if (draft.template !== undefined && draft.template !== null) payload.template = draft.template;
      if (typeof draft.menu_order === 'number') payload.menu_order = draft.menu_order;
      if (copyFeaturedImage && draft.featured_media) payload.featured_media = draft.featured_media;

      const wantedMetaKeys = [...ELEMENTOR_META_KEYS];
      if (copySeo) wantedMetaKeys.push(...SEO_META_KEYS);
      if (extraMetaKeys.length) wantedMetaKeys.push(...extraMetaKeys);

      const meta = {};
      const copiedMetaKeys = [];
      const draftMeta = draft.meta || {};
      for (const key of wantedMetaKeys) {
        if (!(key in draftMeta)) continue;
        const value = draftMeta[key];
        if (value === '' || value === null) continue;
        meta[key] = (key === '_elementor_data' && typeof value !== 'string')
          ? JSON.stringify(value)
          : value;
        copiedMetaKeys.push(key);
      }
      if (Object.keys(meta).length > 0) payload.meta = meta;

      const copiedTaxonomies = [];
      if (copyTaxonomies) {
        for (const [k, v] of Object.entries(draft)) {
          if (POST_NON_TAX_FIELDS.has(k)) continue;
          if (Array.isArray(v) && v.every(x => Number.isInteger(x))) {
            payload[k] = v;
            copiedTaxonomies.push(k);
          }
        }
      }

      await updatePageRouted(wpReq, targetId, payload);

      const verify = await wpReq(`/wp/v2/pages/${targetId}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string'
        ? verify.meta._elementor_data.length
        : 0;
      const expectedElementor = meta._elementor_data;
      const verified = expectedElementor === undefined
        ? true
        : verifyBytes === expectedElementor.length;

      if (!verified) {
        throw new Error(
          `Verify failed: wrote ${expectedElementor.length} bytes of _elementor_data but read back ${verifyBytes}. ` +
          `Draft ${draftId} NOT deleted. Use wp_restore_page_state with the previous_state from a prior wp_get_page_state call if you need to recover target ${targetId}.`
        );
      }

      await wpReq(`/wp/v2/pages/${draftId}?force=true`, { method: 'DELETE' });

      return {
        published: true,
        target_id: targetId,
        deleted_draft_id: draftId,
        verified: true,
        elementor_bytes: verifyBytes,
        copied: {
          featured_image: copyFeaturedImage && !!draft.featured_media,
          template: payload.template !== undefined,
          menu_order: payload.menu_order !== undefined,
          excerpt: !!payload.excerpt,
          meta_keys: copiedMetaKeys,
          taxonomies: copiedTaxonomies
        },
        previous_state: previousState,
        rollback_hint: `To undo: call wp_restore_page_state with post_id=${targetId} and the previous_state above.`
      };
    }

    case 'wp_replace_text': {
      const postId = args.post_id;
      const find = args.find;
      const replace = args.replace ?? '';
      const regex = args.regex === true;
      const ci = args.case_insensitive === true;
      const dryRun = args.dry_run === true;

      if (!postId || typeof find !== 'string' || find === '') {
        throw new Error('post_id and non-empty find required');
      }

      const page = await wpReq(`/wp/v2/pages/${postId}?context=edit`);
      if (!page || !page.id) throw new Error(`Page ${postId} not found`);

      const counter = { replacements: 0, fields: {} };

      const contentRaw = page.content?.raw ?? '';
      const [newContent, contentHits] = applyReplaceText(contentRaw, find, replace, regex, ci);
      if (contentHits > 0) {
        counter.replacements += contentHits;
        counter.fields.post_content = contentHits;
      }

      const rawElementor = page.meta?._elementor_data;
      let newElementorString = null;
      let elementorChanged = false;
      if (typeof rawElementor === 'string' && rawElementor !== '') {
        let tree;
        try { tree = JSON.parse(rawElementor); } catch { tree = null; }
        if (Array.isArray(tree)) {
          walkElementorReplace(tree, find, replace, regex, ci, counter);
          newElementorString = JSON.stringify(tree);
          elementorChanged = newElementorString !== rawElementor;
        }
      }

      if (dryRun || counter.replacements === 0) {
        return {
          dry_run: dryRun,
          applied: false,
          post_id: postId,
          matches: counter.replacements,
          fields: counter.fields,
          would_change: {
            post_content: contentHits > 0,
            elementor_data: elementorChanged
          }
        };
      }

      const previousState = extractPageState(page);

      const writePayload = {};
      if (contentHits > 0) writePayload.content = newContent;
      if (elementorChanged) writePayload.meta = { _elementor_data: newElementorString };
      await updatePageRouted(wpReq, postId, writePayload);

      const after = await wpReq(`/wp/v2/pages/${postId}?context=edit&_fields=id,meta`);
      const afterBytes = typeof after?.meta?._elementor_data === 'string'
        ? after.meta._elementor_data.length
        : 0;
      const expectedBytes = elementorChanged
        ? newElementorString.length
        : (typeof rawElementor === 'string' ? rawElementor.length : 0);

      return {
        applied: true,
        post_id: postId,
        matches: counter.replacements,
        fields: counter.fields,
        content_changed: contentHits > 0,
        elementor_changed: elementorChanged,
        verified: afterBytes === expectedBytes,
        elementor_bytes: afterBytes,
        previous_state: previousState,
        rollback_hint: `To undo: call wp_restore_page_state with post_id=${postId} and the previous_state above.`
      };
    }

    case 'wp_get_page_state': {
      const postId = args.post_id;
      if (!postId) throw new Error('post_id required');
      const page = await wpReq(`/wp/v2/pages/${postId}?context=edit`);
      if (!page || !page.id) throw new Error(`Page ${postId} not found`);
      return { state: extractPageState(page) };
    }

    case 'wp_restore_page_state': {
      const postId = args.post_id;
      const state = args.state;
      if (!postId) throw new Error('post_id required');
      if (!state || typeof state !== 'object') throw new Error('state object required');

      const payload = statePayload(state);
      await updatePageRouted(wpReq, postId, payload);

      const after = await wpReq(`/wp/v2/pages/${postId}?context=edit&_fields=id,meta`);
      const afterBytes = typeof after?.meta?._elementor_data === 'string'
        ? after.meta._elementor_data.length
        : 0;
      const expectedElementor = payload.meta?._elementor_data;
      const verified = expectedElementor === undefined
        ? true
        : afterBytes === expectedElementor.length;

      return {
        restored: true,
        post_id: postId,
        verified,
        elementor_bytes: afterBytes,
        wrote: {
          title: !!payload.title,
          content: !!payload.content,
          excerpt: !!payload.excerpt,
          template: payload.template !== undefined,
          menu_order: payload.menu_order !== undefined,
          featured_media: payload.featured_media != null,
          meta_keys: payload.meta ? Object.keys(payload.meta) : []
        }
      };
    }

    // ── MENUS ──
    case 'wp_get_menus': {
      const menus = await wpReq('/wp/v2/menus');
      return (menus || []).map(m => ({
        id: m.id,
        name: m.name,
        slug: m.slug,
        description: m.description || '',
        locations: m.locations || [],
        count: m.count || 0
      }));
    }

    case 'wp_get_menu_items': {
      const items = await wpReq(`/wp/v2/menu-items?menus=${args.menu_id}&per_page=100`);
      return (items || []).map(item => ({
        id: item.id,
        title: item.title?.rendered || '',
        url: item.url,
        type: item.type,
        parent: item.parent || 0,
        menu_order: item.menu_order,
        object: item.object,
        object_id: item.object_id
      }));
    }

    // ── SEARCH ──
    case 'wp_search': {
      const searchParams = new URLSearchParams({
        search: args.search,
        per_page: String(args.per_page || 20)
      });
      if (args.type) searchParams.set('type', args.type);
      const results = await wpReq(`/wp/v2/search?${searchParams}`);
      return (results || []).map(r => ({
        id: r.id,
        title: r.title,
        url: r.url,
        type: r.type,
        subtype: r.subtype
      }));
    }

    // ── BULK OPERATIONS ──
    case 'wp_bulk_update_posts': {
      const postType = args.post_type === 'pages' ? 'pages' : 'posts';
      // Parse updates if passed as string
      const updates = typeof args.updates === 'string' ? JSON.parse(args.updates) : args.updates;
      // Parse ids if passed as string
      const ids = typeof args.ids === 'string' ? JSON.parse(args.ids) : args.ids;
      const results = [];
      // Process in batches of 5 to avoid rate limits
      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const promises = batch.map(async (id) => {
          try {
            await wpReq(`/wp/v2/${postType}/${id}`, {
              method: 'POST',
              body: updates
            });
            return { id, success: true };
          } catch (e) {
            return { id, success: false, error: e.message };
          }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
        if (i + 5 < args.ids.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      return {
        total: ids.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };
    }

    // ── PAGE TREE ──
    case 'wp_get_page_tree': {
      const allPages = await wpReq(`/wp/v2/pages?per_page=${args.per_page || 100}&_fields=id,title,slug,parent,status,menu_order,link`);
      const pages = (allPages || []).map(p => ({
        id: p.id,
        title: p.title?.rendered || '',
        slug: p.slug,
        parent: p.parent || 0,
        status: p.status,
        menu_order: p.menu_order,
        link: p.link
      }));
      // Build tree structure
      const byId = {};
      pages.forEach(p => { byId[p.id] = { ...p, children: [] }; });
      const tree = [];
      pages.forEach(p => {
        if (p.parent && byId[p.parent]) {
          byId[p.parent].children.push(byId[p.id]);
        } else {
          tree.push(byId[p.id]);
        }
      });
      return { total: pages.length, tree };
    }

    // ── RANKMATH SEO ──
    case 'wp_rankmath_update_meta': {
      const rmMeta = {};
      if (args.title !== undefined) rmMeta.rank_math_title = args.title;
      if (args.description !== undefined) rmMeta.rank_math_description = args.description;
      if (args.focus_keyword !== undefined) rmMeta.rank_math_focus_keyword = args.focus_keyword;
      if (args.robots !== undefined) rmMeta.rank_math_robots = args.robots;
      const endpoint = args.post_type === 'page' ? 'pages' : 'posts';
      await wpReq(`/wp/v2/${endpoint}/${args.id}`, {
        method: 'POST',
        body: { meta: rmMeta }
      });
      return { updated: true, id: args.id, fields: Object.keys(rmMeta) };
    }

    case 'wp_rankmath_get_meta': {
      const endpoint2 = args.post_type === 'page' ? 'pages' : 'posts';
      const rmPost = await wpReq(`/wp/v2/${endpoint2}/${args.id}?context=edit`);
      const meta = rmPost?.meta || {};
      return {
        id: args.id,
        title: meta.rank_math_title || '',
        description: meta.rank_math_description || '',
        focus_keyword: meta.rank_math_focus_keyword || '',
        robots: meta.rank_math_robots || [],
        seo_score: meta.rank_math_seo_score || null,
        pillar_content: meta.rank_math_pillar_content || false,
        canonical_url: meta.rank_math_canonical_url || ''
      };
    }

    // ── YOAST SEO ──
    case 'wp_yoast_get_head': {
      const yoastData = await wpReq(`/yoast/v1/get_head?url=${encodeURIComponent(args.url)}`);
      if (yoastData?.code) {
        return { error: yoastData.message || 'Yoast API error', hint: 'Yoast SEO may not be installed on this site' };
      }
      return {
        status: yoastData?.status || 200,
        json: yoastData?.json || {},
        html: (yoastData?.html || '').substring(0, 2000)
      };
    }

    case 'wp_yoast_update_meta': {
      // Yoast doesn't register meta in REST API by default.
      // Strategy: try meta object first (works if Yoast REST is enabled),
      // fall back to yoast_head_json check for verification.
      const yMeta = {};
      if (args.title !== undefined) yMeta._yoast_wpseo_title = args.title;
      if (args.description !== undefined) yMeta._yoast_wpseo_metadesc = args.description;
      if (args.focus_keyword !== undefined) yMeta._yoast_wpseo_focuskw = args.focus_keyword;
      if (args.robots_noindex !== undefined) yMeta._yoast_wpseo_meta_robots_noindex = args.robots_noindex ? '1' : '0';
      if (args.robots_nofollow !== undefined) yMeta._yoast_wpseo_meta_robots_nofollow = args.robots_nofollow ? '1' : '0';
      if (args.canonical !== undefined) yMeta._yoast_wpseo_canonical = args.canonical;
      if (args.og_title !== undefined) yMeta._yoast_wpseo_opengraph_title = args.og_title;
      if (args.og_description !== undefined) yMeta._yoast_wpseo_opengraph_description = args.og_description;
      const yEndpoint = args.post_type === 'page' ? 'pages' : 'posts';
      try {
        await wpReq(`/wp/v2/${yEndpoint}/${args.id}`, {
          method: 'POST',
          body: { meta: yMeta }
        });
        return { updated: true, id: args.id, fields: Object.keys(yMeta), method: 'meta' };
      } catch (e) {
        // If meta write fails (Yoast doesn't register fields), try yoast_meta endpoint
        if (e.message?.includes('404') || e.message?.includes('rest_no_route')) {
          // Fall back: update via standard post update with meta in body
          // Some Yoast versions expose meta through yoast_head_json but not write
          return {
            updated: false,
            error: 'Yoast does not expose meta write via REST API on this site. Use wp_update_post with meta fields directly, or install "Yoast SEO: REST API" addon.',
            id: args.id,
            workaround: `wp_update_post id:${args.id} meta:'${JSON.stringify(yMeta)}'`
          };
        }
        throw e;
      }
    }

    case 'wp_yoast_get_meta': {
      const yEndpoint2 = args.post_type === 'page' ? 'pages' : 'posts';
      const yPost = await wpReq(`/wp/v2/${yEndpoint2}/${args.id}?context=edit`);
      const yM = yPost?.meta || {};
      // Also try yoast_head_json (Yoast v14+ adds this to REST response)
      const yHead = yPost?.yoast_head_json || {};
      return {
        id: args.id,
        // Prefer direct meta, fall back to yoast_head_json
        title: yM._yoast_wpseo_title || yHead.title || '',
        description: yM._yoast_wpseo_metadesc || yHead.description || '',
        focus_keyword: yM._yoast_wpseo_focuskw || '',
        robots_noindex: yM._yoast_wpseo_meta_robots_noindex === '1',
        robots_nofollow: yM._yoast_wpseo_meta_robots_nofollow === '1',
        canonical: yM._yoast_wpseo_canonical || yHead.canonical || '',
        og_title: yM._yoast_wpseo_opengraph_title || yHead.og_title || '',
        og_description: yM._yoast_wpseo_opengraph_description || yHead.og_description || '',
        og_image: yHead.og_image?.[0]?.url || '',
        schema_page_type: yM._yoast_wpseo_schema_page_type || '',
        schema_article_type: yM._yoast_wpseo_schema_article_type || '',
        source: Object.keys(yM).some(k => k.includes('yoast')) ? 'meta' : 'yoast_head_json'
      };
    }

    // ── SETTINGS ──
    case 'wp_get_settings': {
      const settings = await wpReq('/wp/v2/settings');
      return {
        title: settings?.title || '',
        tagline: settings?.description || '',
        url: settings?.url || '',
        timezone: settings?.timezone_string || settings?.gmt_offset || '',
        language: settings?.language || '',
        date_format: settings?.date_format || '',
        time_format: settings?.time_format || '',
        posts_per_page: settings?.posts_per_page || 10,
        default_comment_status: settings?.default_comment_status || ''
      };
    }

    // ── REDIRECTS ──
    case 'wp_get_redirects': {
      const allRedirects = [];

      // Method 1: RankMath — uses updateRedirection endpoint with GET action
      try {
        const rmResult = await wpReq('/rankmath/v1/updateRedirection', {
          method: 'POST',
          body: {
            action: 'list',
            per_page: args.per_page || 50,
            page: args.page || 1,
            ...(args.search ? { search: args.search } : {})
          }
        });
        if (rmResult && (rmResult.redirections || rmResult.items || Array.isArray(rmResult))) {
          const items = rmResult.redirections || rmResult.items || rmResult;
          return {
            source: 'rankmath',
            total: rmResult.total || items.length,
            redirects: (Array.isArray(items) ? items : []).map(r => ({
              id: r.id,
              source: r.sources?.[0]?.pattern || r.url_from || '',
              target: r.url_to || '',
              type: r.header_code || 301,
              hits: r.hits || 0,
              status: r.status || 'active'
            }))
          };
        }
      } catch (e) { /* RankMath not available or different version */ }

      // Method 2: RankMath — try direct DB-backed REST endpoint (some versions)
      try {
        const rmDirect = await wpReq('/rankmath/v1/redirections');
        if (rmDirect && !rmDirect.code && (Array.isArray(rmDirect) || rmDirect.redirections)) {
          const items = rmDirect.redirections || rmDirect;
          return {
            source: 'rankmath-direct',
            total: items.length,
            redirects: (Array.isArray(items) ? items : []).map(r => ({
              id: r.id,
              source: r.sources?.[0]?.pattern || r.url || '',
              target: r.url_to || '',
              type: r.header_code || 301,
              hits: r.hits || 0,
              status: r.status || 'active'
            }))
          };
        }
      } catch (e) { /* not available */ }

      // Method 3: Redirection plugin
      // NOTE: the Redirection plugin's REST API uses 0-based page indexing.
      // Callers pass a 1-based `page` (default 1), so translate it here —
      // otherwise the default lands on the *second* page and returns an empty
      // list while still reporting a non-zero `total`.
      try {
        const reqPage = Math.max(0, (args.page ? Number(args.page) - 1 : 0));
        const rdParams = new URLSearchParams({
          per_page: String(args.per_page || 50),
          page: String(reqPage)
        });
        if (args.search) rdParams.set('filterBy[url]', args.search);
        const redirection = await wpReq('/redirection/v1/redirect?' + rdParams.toString());
        if (redirection && Array.isArray(redirection.items)) {
          return {
            source: 'redirection-plugin',
            total: redirection.total || redirection.items.length,
            page: reqPage,
            redirects: redirection.items.map(r => ({
              id: r.id,
              source: r.url,
              target: r.action_data?.url || '',
              type: r.action_code || 301,
              hits: r.hits || 0,
              last_access: r.last_access || null,
              enabled: r.enabled !== false
            }))
          };
        }
      } catch (e) { /* Redirection plugin not available */ }

      // Method 4: Check _wp_http_referer redirects in options (last resort)
      return { error: 'No redirect data found. Tried: RankMath API, RankMath direct, Redirection plugin.', hint: 'Check which redirect plugin is installed and active.' };
    }

    case 'wp_create_redirect': {
      // Collect per-plugin failures so the final error is actionable instead
      // of a blanket "no plugin found" when a plugin is in fact active.
      const attempts = [];

      // Try RankMath first
      try {
        const result = await wpReq('/rankmath/v1/updateRedirection', {
          method: 'POST',
          body: {
            action: 'update',
            redirection: {
              sources: [{ pattern: args.source, comparison: 'exact' }],
              url_to: args.target,
              header_code: args.type || 301,
              status: 'active'
            }
          }
        });
        if (result && !result.code) {
          return { created: true, source: 'rankmath', redirect: result };
        }
        attempts.push({ plugin: 'rankmath', response: result });
      } catch (e) { attempts.push({ plugin: 'rankmath', error: e.message }); }

      // Try Redirection plugin
      try {
        const result = await wpReq('/redirection/v1/redirect', {
          method: 'POST',
          body: {
            url: args.source,
            action_data: { url: args.target },
            action_type: 'url',
            action_code: args.type || 301,
            group_id: 1,
            match_type: 'url'
          }
        });
        // The Redirection plugin's create endpoint does NOT return the new row
        // as `{ id }`. On success it returns the refreshed paged LIST
        // ({ items, total, pages }) with the new redirect included. Other
        // versions may return the created object directly, so handle both.
        if (result) {
          if (result.id) {
            return { created: true, source: 'redirection-plugin', id: result.id };
          }
          if (Array.isArray(result.items)) {
            const match = result.items.find(r => r.url === args.source);
            return {
              created: true,
              source: 'redirection-plugin',
              id: match?.id ?? null,
              total: result.total,
              redirect: match || null
            };
          }
        }
        attempts.push({ plugin: 'redirection-plugin', response: result });
      } catch (e) { attempts.push({ plugin: 'redirection-plugin', error: e.message }); }

      return { error: 'No redirect plugin found (tried RankMath and Redirection plugin)', attempts };
    }

    // MEDIA
    case 'wp_get_media': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1)
      });
      if (args.media_type) params.append('media_type', args.media_type);
      
      const media = await wpReq(`/wp/v2/media?${params}`);
      return { 
        media: media.map(m => ({ 
          id: m.id, 
          title: m.title.rendered, 
          url: m.source_url,
          media_type: m.media_type,
          mime_type: m.mime_type
        })) 
      };
    }

    case 'wp_get_media_item': {
      const media = await wpReq(`/wp/v2/media/${args.id}`);
      return {
        id: media.id,
        title: media.title.rendered,
        url: media.source_url,
        media_type: media.media_type,
        mime_type: media.mime_type,
        alt_text: media.alt_text
      };
    }

    case 'wp_upload_media': {
      const buffer = Buffer.from(args.base64_content, 'base64');
      const media = await wpReq('/wp/v2/media', {
        method: 'POST',
        headers: {
          'Content-Disposition': `attachment; filename="${args.filename}"`,
          'Content-Type': 'application/octet-stream',
          'Authorization': currentAuthHeader
        },
        body: buffer
      });
      
      if (args.title !== undefined || args.alt_text !== undefined) {
        const updates = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.alt_text !== undefined) updates.alt_text = args.alt_text;
        
        await wpReq(`/wp/v2/media/${media.id}`, {
          method: 'POST',
          body: JSON.stringify(updates)
        });
      }
      
      return {
        id: media.id,
        url: media.source_url,
        slug: media.slug,
        guid: media.guid?.rendered,
        title: media.title?.rendered,
        alt_text: media.alt_text || "",
      };
    }

    case 'wp_update_media': {
      const updates = {};
      if (args.title !== undefined) updates.title = { raw: args.title };
      if (args.alt_text !== undefined) updates.alt_text = args.alt_text;
      if (args.caption !== undefined) updates.caption = { raw: args.caption };
      if (args.description !== undefined) updates.description = { raw: args.description };
      if (args.post !== undefined) updates.post = args.post;

      if (Object.keys(updates).length === 0) {
        throw new Error('No fields to update. Provide at least one valid field.');
      }

      const media = await wpReq(`/wp/v2/media/${args.id}?context=edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': currentAuthHeader
        },
        body: JSON.stringify(updates)
      });

      return { 
        id: media.id, 
        url: media.source_url,
        title: media.title?.rendered || media.title?.raw || media.title,
        alt_text: media.alt_text 
      };
    }

    case 'wp_delete_media': {
      await wpReq(`/wp/v2/media/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    // COMMENTS
    case 'wp_get_comments': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'approve'
      });
      if (args.post) params.append('post', String(args.post));
      if (args.search) params.append('search', args.search);
      
      const comments = await wpReq(`/wp/v2/comments?${params}`);
      return { 
        comments: comments.map(c => ({ 
          id: c.id, 
          post: c.post,
          author_name: c.author_name,
          content: c.content.rendered,
          date: c.date,
          status: c.status
        })) 
      };
    }

    case 'wp_get_comment': {
      const comment = await wpReq(`/wp/v2/comments/${args.id}`);
      return {
        id: comment.id,
        post: comment.post,
        author_name: comment.author_name,
        author_email: comment.author_email,
        content: comment.content.rendered,
        date: comment.date,
        status: comment.status
      };
    }

    case 'wp_create_comment': {
      const commentData = {
        post: args.post,
        content: args.content
      };
      if (args.author_name) commentData.author_name = args.author_name;
      if (args.author_email) commentData.author_email = args.author_email;
      if (args.parent) commentData.parent = args.parent;

      const comment = await wpReq('/wp/v2/comments', {
        method: 'POST',
        body: JSON.stringify(commentData)
      });
      return { id: comment.id, status: comment.status };
    }

    case 'wp_update_comment': {
      const updates = {};
      if (args.content !== undefined) updates.content = args.content;
      if (args.status !== undefined) updates.status = args.status;

      const comment = await wpReq(`/wp/v2/comments/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return { id: comment.id, status: comment.status };
    }

    case 'wp_delete_comment': {
      await wpReq(`/wp/v2/comments/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    // USERS
    case 'wp_get_users': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1)
      });
      if (args.search) params.append('search', args.search);
      if (args.roles) params.append('roles', args.roles);
      
      const users = await wpReq(`/wp/v2/users?${params}`);
      return { 
        users: users.map(u => ({ 
          id: u.id, 
          name: u.name,
          username: u.slug,
          email: u.email,
          roles: u.roles,
          link: u.link
        })) 
      };
    }

    case 'wp_get_user': {
      const user = await wpReq(`/wp/v2/users/${args.id}`);
      return {
        id: user.id,
        name: user.name,
        username: user.slug,
        email: user.email,
        roles: user.roles,
        description: user.description,
        link: user.link
      };
    }

    case 'wp_get_current_user': {
      const users = await wpReq('/wp/v2/users/me');
      return {
        id: users.id,
        name: users.name,
        username: users.slug,
        email: users.email,
        roles: users.roles
      };
    }

    // CUSTOM POST TYPES
    case 'wp_get_custom_posts': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'publish'
      });
      
      const posts = await wpReq(`/wp/v2/${args.post_type}?${params}`);
      return { posts: posts.map(p => ({ id: p.id, title: p.title?.rendered || 'Untitled', link: p.link })) };
    }

    case 'wp_get_custom_post': {
      const post = await wpReq(`/wp/v2/${args.post_type}/${args.id}`);
      return {
        id: post.id,
        title: post.title?.rendered || 'Untitled',
        content: post.content?.rendered,
        link: post.link,
        status: post.status
      };
    }

    case 'wp_create_custom_post': {
      const postData = {
        title: args.title,
        content: args.content,
        status: args.status || 'draft'
      };
      
      // Meta fields (custom fields)
      if (args.meta) {
        postData.meta = args.meta;
      }
      
      // Slug/permalink
      if (args.slug) {
        postData.slug = args.slug;
      }
      
      // Excerpt
      if (args.excerpt) {
        postData.excerpt = args.excerpt;
      }
      
      // Featured image
      if (args.featured_media) {
        postData.featured_media = args.featured_media;
      }
      
      const post = await wpReq(`/wp/v2/${args.post_type}`, {
        method: 'POST',
        body: JSON.stringify(postData)
      });
      
      return { 
        id: post.id, 
        link: post.link,
        status: post.status,
        slug: post.slug,
        meta: post.meta
      };
    }

    case 'wp_update_custom_post': {
      const postData = {};
      if (args.title !== undefined) postData.title = args.title;
      if (args.content !== undefined) postData.content = args.content;
      if (args.status !== undefined) postData.status = args.status;
      if (args.excerpt !== undefined) postData.excerpt = args.excerpt;
      if (args.meta !== undefined) postData.meta = args.meta;
      // Yoast SEO shorthand
      if (args.yoast_title !== undefined || args.yoast_desc !== undefined || args.yoast_canonical !== undefined) {
        postData.meta = postData.meta || {};
        if (args.yoast_title !== undefined) postData.meta['yoast_wpseo_title'] = args.yoast_title;
        if (args.yoast_desc !== undefined) postData.meta['yoast_wpseo_metadesc'] = args.yoast_desc;
        if (args.yoast_canonical !== undefined) postData.meta['yoast_wpseo_canonical'] = args.yoast_canonical;
      }
      
      const post = await wpReq(`/wp/v2/${args.post_type}/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(postData)
      });
      
      return { 
        id: post.id, 
        title: post.title?.rendered,
        link: post.link,
        status: post.status,
        slug: post.slug,
        modified: post.modified,
        meta: post.meta
      };
    }

    // TAXONOMY
    case 'wp_get_categories': {
      const categories = await wpReq(`/wp/v2/categories?per_page=${args.per_page || 100}`);
      return { categories: categories.map(c => ({ id: c.id, name: c.name, count: c.count })) };
    }

    case 'wp_get_tags': {
      const tags = await wpReq(`/wp/v2/tags?per_page=${args.per_page || 100}`);
      return { tags: tags.map(t => ({ id: t.id, name: t.name, count: t.count })) };
    }

    case 'wp_create_category': {
      const categoryData = { name: args.name };
      if (args.description) categoryData.description = args.description;
      if (args.parent) categoryData.parent = args.parent;
      if (args.slug) categoryData.slug = args.slug;

      const category = await wpReq('/wp/v2/categories', {
        method: 'POST',
        body: JSON.stringify(categoryData)
      });
      return { id: category.id, name: category.name, slug: category.slug };
    }

    case 'wp_create_tag': {
      const tagData = { name: args.name };
      if (args.description) tagData.description = args.description;
      if (args.slug) tagData.slug = args.slug;

      const tag = await wpReq('/wp/v2/tags', {
        method: 'POST',
        body: JSON.stringify(tagData)
      });
      return { id: tag.id, name: tag.name, slug: tag.slug };
    }

    case 'wp_update_category': {
      const updates = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.parent !== undefined) updates.parent = args.parent;

      const category = await wpReq(`/wp/v2/categories/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return { id: category.id, name: category.name };
    }

    case 'wp_delete_category': {
      await wpReq(`/wp/v2/categories/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    case 'wp_update_tag': {
      const updates = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.slug !== undefined) updates.slug = args.slug;

      const tag = await wpReq(`/wp/v2/tags/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return { id: tag.id, name: tag.name, slug: tag.slug };
    }

    case 'wp_delete_tag': {
      const force = args.force !== false;
      await wpReq(`/wp/v2/tags/${args.id}?force=${force}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }

    // SITE INFO
    case 'wp_get_site_info': {
      const settings = await wpReq('/wp/v2/settings');
      return {
        title: settings.title,
        description: settings.description,
        url: settings.url,
        timezone: settings.timezone,
        language: settings.language,
        date_format: settings.date_format,
        time_format: settings.time_format,
        show_on_front: settings.show_on_front,
        page_on_front: settings.page_on_front || 0,
        page_for_posts: settings.page_for_posts || 0,
        posts_per_page: settings.posts_per_page || 10,
        default_category: settings.default_category || 1,
        default_post_format: settings.default_post_format || '0'
      };
    }

    case 'wp_get_special_pages': {
      const settings = await wpReq('/wp/v2/settings');
      const specialPages = {};

      if (settings.show_on_front === 'page' && settings.page_on_front) {
        try {
          const homepage = await wpReq(`/wp/v2/pages/${settings.page_on_front}`);
          specialPages.homepage = {
            id: homepage.id,
            title: homepage.title.rendered,
            slug: homepage.slug,
            url: homepage.link,
            status: homepage.status,
            type: 'page'
          };
        } catch (e) {
          specialPages.homepage = {
            id: settings.page_on_front,
            error: 'Page not found or not accessible'
          };
        }
      } else {
        specialPages.homepage = {
          type: 'posts',
          description: 'Homepage shows latest posts'
        };
      }

      if (settings.page_for_posts) {
        try {
          const blogPage = await wpReq(`/wp/v2/pages/${settings.page_for_posts}`);
          specialPages.blog_page = {
            id: blogPage.id,
            title: blogPage.title.rendered,
            slug: blogPage.slug,
            url: blogPage.link,
            status: blogPage.status,
            type: 'page'
          };
        } catch (e) {
          specialPages.blog_page = {
            id: settings.page_for_posts,
            error: 'Page not found or not accessible'
          };
        }
      }

      if (settings.wp_page_for_privacy_policy) {
        try {
          const privacyPage = await wpReq(`/wp/v2/pages/${settings.wp_page_for_privacy_policy}`);
          specialPages.privacy_policy = {
            id: privacyPage.id,
            title: privacyPage.title.rendered,
            slug: privacyPage.slug,
            url: privacyPage.link,
            status: privacyPage.status,
            type: 'page'
          };
        } catch (e) {
          specialPages.privacy_policy = {
            id: settings.wp_page_for_privacy_policy,
            error: 'Page not found or not accessible'
          };
        }
      }

      specialPages._settings = {
        show_on_front: settings.show_on_front,
        posts_per_page: settings.posts_per_page,
        default_category: settings.default_category
      };

      return specialPages;
    }

    case 'wp_get_post_types': {
      const types = await wpReq('/wp/v2/types');
      return {
        post_types: Object.entries(types).map(([key, type]) => ({
          slug: key,
          name: type.name,
          description: type.description,
          hierarchical: type.hierarchical,
          rest_base: type.rest_base
        }))
      };
    }

    // FILE OPERATIONS
    case 'wp_create_file': {
      const { path, content, overwrite = true } = args;

      // Security validation (defense in depth - PHP side also validates)
      const allowedPrefixes = [
        'wp-content/mu-plugins/',
        'wp-content/uploads/'
      ];

      // Check allowed directory
      if (!allowedPrefixes.some(prefix => path.startsWith(prefix))) {
        throw new Error(`Path not allowed. Must start with: ${allowedPrefixes.join(' or ')}`);
      }

      // Prevent path traversal
      if (path.includes('..')) {
        throw new Error('Path traversal (..) not allowed');
      }

      // Prevent double slashes
      if (path.includes('//')) {
        throw new Error('Invalid path format');
      }

      // Only allow .php files in mu-plugins
      if (path.startsWith('wp-content/mu-plugins/') && !path.endsWith('.php')) {
        throw new Error('Only .php files allowed in mu-plugins');
      }

      const result = await wpReq('/agency-os/v1/create-file', {
        method: 'POST',
        body: JSON.stringify({
          path,
          content,
          overwrite
        })
      });
      return result;
    }

    // ── CODE SNIPPETS (wraps the Code Snippets plugin REST API) ──
    case 'wp_list_snippets': {
      const snippets = await wpReq('/code-snippets/v1/snippets');
      const list = (Array.isArray(snippets) ? snippets : [])
        .filter(s => (args.active_only ? !!s.active : true))
        .map(s => ({
          id: s.id,
          name: s.name,
          scope: s.scope,
          active: !!s.active,
          priority: s.priority,
          tags: s.tags || [],
          modified: s.modified
        }));
      return { count: list.length, snippets: list };
    }

    case 'wp_get_snippet': {
      if (!args.id) throw new Error('id required');
      const snippet = await wpReq(`/code-snippets/v1/snippets/${args.id}`);
      return snippet;
    }

    case 'wp_create_snippet': {
      if (!args.name) throw new Error('name required');
      if (args.code === undefined) throw new Error('code required');
      const body = {
        name: args.name,
        code: args.code,
        desc: args.desc ?? '',
        scope: args.scope || 'global',
        priority: args.priority ?? 10,
        active: args.active === true
      };
      if (Array.isArray(args.tags)) body.tags = args.tags;
      const snippet = await wpReq('/code-snippets/v1/snippets', {
        method: 'POST',
        body
      });
      return { created: true, id: snippet.id, name: snippet.name, active: !!snippet.active, scope: snippet.scope };
    }

    case 'wp_update_snippet': {
      if (!args.id) throw new Error('id required');
      const body = {};
      if (args.name !== undefined) body.name = args.name;
      if (args.code !== undefined) body.code = args.code;
      if (args.desc !== undefined) body.desc = args.desc;
      if (args.scope !== undefined) body.scope = args.scope;
      if (args.priority !== undefined) body.priority = args.priority;
      if (args.active !== undefined) body.active = args.active;
      if (Array.isArray(args.tags)) body.tags = args.tags;
      if (Object.keys(body).length === 0) {
        throw new Error('No update data provided (name, code, desc, scope, priority, active, or tags).');
      }
      const snippet = await wpReq(`/code-snippets/v1/snippets/${args.id}`, {
        method: 'POST',
        body
      });
      return { updated: true, id: snippet.id ?? args.id, name: snippet.name, active: !!snippet.active, scope: snippet.scope };
    }

    case 'wp_activate_snippet': {
      if (!args.id) throw new Error('id required');
      const snippet = await wpReq(`/code-snippets/v1/snippets/${args.id}/activate`, {
        method: 'POST'
      });
      return { activated: true, id: args.id, active: snippet?.active !== undefined ? !!snippet.active : true };
    }

    case 'wp_deactivate_snippet': {
      if (!args.id) throw new Error('id required');
      const snippet = await wpReq(`/code-snippets/v1/snippets/${args.id}/deactivate`, {
        method: 'POST'
      });
      return { deactivated: true, id: args.id, active: snippet?.active !== undefined ? !!snippet.active : false };
    }

    case 'wp_delete_snippet': {
      if (!args.id) throw new Error('id required');
      await wpReq(`/code-snippets/v1/snippets/${args.id}`, { method: 'DELETE' });
      return { deleted: true, id: args.id };
    }

    case 'wp_bootstrap_elementor_writer': {
      const force = args.force || false;
      const steps = [];

      // Treat anything other than rest_no_route as "route is live".
      const routeLive = async () => {
        try {
          await wpReq('/agency-os/v1/elementor-data', { method: 'POST', body: JSON.stringify({}) });
          return true;
        } catch (error) {
          return !error.message.includes('rest_no_route');
        }
      };

      if (!force && await routeLive()) {
        return { success: true, message: 'Elementor write route already installed', steps: ['Route is responding'] };
      }

      // The route is registered directly inside an active global snippet — no
      // mu-plugin, no file write. The function_exists guard avoids a fatal
      // redeclare if the File API mu-plugin also defines it on the same site.
      const snippetName = 'Agency OS Elementor Writer';
      const snippetCode = `if (!defined('ABSPATH')) exit;

add_action('rest_api_init', function() {
    register_rest_route('agency-os/v1', '/elementor-data', [
        'methods' => 'POST',
        'callback' => 'agency_os_set_elementor_data',
        'permission_callback' => function() { return current_user_can('edit_posts'); }
    ]);
});

if (!function_exists('agency_os_set_elementor_data')) {
function agency_os_set_elementor_data($r) {
    $post_id = (int) $r->get_param('post_id');
    $data = $r->get_param('elementor_data');
    if (!$post_id || get_post_status($post_id) === false) return new WP_Error('not_found', 'Post not found', ['status' => 404]);
    if (!current_user_can('edit_post', $post_id)) return new WP_Error('forbidden', 'Cannot edit this post', ['status' => 403]);
    if (!is_string($data)) return new WP_Error('invalid', 'elementor_data must be a string', ['status' => 400]);
    json_decode($data, true);
    if (json_last_error() !== JSON_ERROR_NONE) return new WP_Error('invalid_json', 'Invalid JSON: ' . json_last_error_msg(), ['status' => 400]);
    update_post_meta($post_id, '_elementor_data', wp_slash($data));
    update_post_meta($post_id, '_elementor_edit_mode', 'builder');
    delete_post_meta($post_id, '_elementor_css');
    $written = get_post_meta($post_id, '_elementor_data', true);
    return ['success' => true, 'post_id' => $post_id, 'bytes' => strlen(is_string($written) ? $written : '')];
}
}`;

      // Reuse an existing snippet with this name if present (so re-running
      // updates in place instead of piling up duplicates).
      let existing = null;
      try {
        const all = await wpReq('/code-snippets/v1/snippets');
        existing = (Array.isArray(all) ? all : []).find(s => s.name === snippetName) || null;
      } catch (error) {
        if (error.message.includes('rest_no_route')) {
          return {
            success: false,
            error: 'Code Snippets REST API not found. Install & activate the "Code Snippets" plugin first.',
            steps: ['Install the Code Snippets plugin, then re-run wp_bootstrap_elementor_writer.']
          };
        }
        steps.push('Could not list existing snippets: ' + error.message);
      }

      let snippet;
      if (existing) {
        steps.push(`Updating existing snippet (ID ${existing.id})...`);
        snippet = await wpReq(`/code-snippets/v1/snippets/${existing.id}`, {
          method: 'POST',
          body: { name: snippetName, code: snippetCode, scope: 'global', active: true }
        });
      } else {
        steps.push('Creating Elementor write-route snippet...');
        snippet = await wpReq('/code-snippets/v1/snippets', {
          method: 'POST',
          body: {
            name: snippetName,
            desc: 'Registers the privileged agency-os/v1/elementor-data REST route used by WordPress MCP to write _elementor_data.',
            code: snippetCode,
            scope: 'global',
            active: true
          }
        });
      }
      steps.push(`Snippet saved (ID ${snippet.id ?? existing?.id}), verifying route...`);

      await new Promise(resolve => setTimeout(resolve, 1000));
      const verified = await routeLive();
      steps.push(verified ? 'Elementor write route verified!' : 'Route not responding yet — it may need a moment to register.');

      return {
        success: verified,
        via: 'code-snippet',
        snippet_id: snippet.id ?? existing?.id,
        verified,
        message: verified
          ? 'Elementor write route installed via active Code Snippet (no mu-plugin).'
          : 'Snippet saved but route not verified yet. Re-run wp_check_file_api shortly.',
        steps
      };
    }

    case 'wp_check_file_api': {
      // A route "exists" if it responds with anything other than 404/rest_no_route
      // (e.g. a 400/403 on our empty probe payload means the route is registered).
      const probe = async (path) => {
        try {
          await wpReq(path, { method: 'POST', body: JSON.stringify({}) });
          return true;
        } catch (error) {
          // Only `rest_no_route` means the route isn't registered. Other errors
          // (incl. a 404 "post not found" from the elementor route) prove it is.
          return !error.message.includes('rest_no_route');
        }
      };

      const fileApi = await probe('/agency-os/v1/create-file');
      if (!fileApi) {
        return {
          available: false,
          message: 'File API not installed',
          elementor_write_route: false,
          instructions: [
            '1. Install "Code Snippets" plugin on the WordPress site',
            '2. Run wp_bootstrap_file_api tool to auto-install the File API',
            'OR manually upload agency-os-file-api.php to wp-content/mu-plugins/'
          ]
        };
      }

      const elementorRoute = await probe('/agency-os/v1/elementor-data');
      return {
        available: true,
        message: elementorRoute
          ? 'File API + Elementor write route are installed and working'
          : 'File API installed, but the Elementor write route is missing — run wp_bootstrap_file_api (or with force:true) to upgrade the mu-plugin',
        elementor_write_route: elementorRoute
      };
    }

    case 'wp_bootstrap_file_api': {
      const steps = [];
      const force = args.force || false;

      // Step 1: Check if File API already exists AND exposes the elementor-data
      // route. Probe both so older installs (create-file only) get upgraded with
      // the privileged Elementor writer instead of short-circuiting here.
      const routeInstalled = async (path) => {
        try {
          await wpReq(path, { method: 'POST', body: JSON.stringify({}) });
          return true;
        } catch (error) {
          // A registered route rejects our empty probe with 400/403/404
          // ("post not found") etc. Only `rest_no_route` means it isn't there.
          return !error.message.includes('rest_no_route');
        }
      };

      if (!force) {
        const hasFileApi = await routeInstalled('/agency-os/v1/create-file');
        const hasElementorRoute = hasFileApi && await routeInstalled('/agency-os/v1/elementor-data');
        if (hasFileApi && hasElementorRoute) {
          return { success: true, message: 'File API already installed!', steps: ['File API + Elementor write route are working'] };
        }
        if (hasFileApi) {
          steps.push('File API found but Elementor write route missing — reinstalling mu-plugin to add it...');
        } else {
          steps.push('File API not found, proceeding with installation...');
        }
      } else {
        steps.push('Force mode: reinstalling File API...');
      }

      // Step 2: Check if Code Snippets plugin is installed
      let codeSnippetsInstalled = false;
      try {
        const plugins = await wpReq('/wp/v2/plugins');
        codeSnippetsInstalled = plugins.some(p =>
          p.plugin && p.plugin.includes('code-snippets')
        );
        if (codeSnippetsInstalled) {
          steps.push('Code Snippets plugin found');
        }
      } catch (error) {
        steps.push('Could not check plugins: ' + error.message);
      }

      // Step 3: Install Code Snippets if not present
      if (!codeSnippetsInstalled) {
        steps.push('Installing Code Snippets plugin...');
        try {
          await wpReq('/wp/v2/plugins', {
            method: 'POST',
            body: JSON.stringify({
              slug: 'code-snippets',
              status: 'active'
            })
          });
          steps.push('Code Snippets plugin installed and activated!');
          codeSnippetsInstalled = true;
        } catch (error) {
          if (error.message.includes('already installed') || error.message.includes('folder already exists')) {
            // Plugin exists but might be inactive, try to activate
            try {
              await wpReq('/wp/v2/plugins/code-snippets/code-snippets', {
                method: 'POST',
                body: JSON.stringify({ status: 'active' })
              });
              steps.push('Code Snippets plugin activated');
              codeSnippetsInstalled = true;
            } catch (activateError) {
              steps.push('Could not activate Code Snippets: ' + activateError.message);
            }
          } else {
            steps.push('Could not install Code Snippets: ' + error.message);
            return {
              success: false,
              steps,
              error: 'Failed to install Code Snippets plugin',
              manual_instructions: [
                '1. Go to WordPress Admin > Plugins > Add New',
                '2. Search for "Code Snippets" and install it',
                '3. Activate the plugin',
                '4. Run wp_bootstrap_file_api again'
              ]
            };
          }
        }
      }

      // Step 4: Create bootstrap snippet via Code Snippets API
      const snippetCode = `// Agency OS File API Bootstrap - Run Once
$mu_dir = ABSPATH . 'wp-content/mu-plugins';
$file = $mu_dir . '/agency-os-file-api.php';
if (!file_exists($mu_dir)) wp_mkdir_p($mu_dir);

$code = '<?php
/**
 * Plugin Name: Agency OS File API
 * Version: 1.0.0
 */
if (!defined("ABSPATH")) exit;

add_action("rest_api_init", function() {
    register_rest_route("agency-os/v1", "/create-file", [
        "methods" => "POST",
        "callback" => "agency_os_create_file",
        "permission_callback" => function() { return current_user_can("manage_options"); }
    ]);
    register_rest_route("agency-os/v1", "/elementor-data", [
        "methods" => "POST",
        "callback" => "agency_os_set_elementor_data",
        "permission_callback" => function() { return current_user_can("edit_posts"); }
    ]);
});

function agency_os_set_elementor_data($r) {
    $post_id = (int) $r->get_param("post_id");
    $data = $r->get_param("elementor_data");
    if (!$post_id || get_post_status($post_id) === false) return new WP_Error("not_found", "Post not found", ["status" => 404]);
    if (!current_user_can("edit_post", $post_id)) return new WP_Error("forbidden", "Cannot edit this post", ["status" => 403]);
    if (!is_string($data)) return new WP_Error("invalid", "elementor_data must be a string", ["status" => 400]);
    json_decode($data, true);
    if (json_last_error() !== JSON_ERROR_NONE) return new WP_Error("invalid_json", "Invalid JSON: " . json_last_error_msg(), ["status" => 400]);
    update_post_meta($post_id, "_elementor_data", wp_slash($data));
    update_post_meta($post_id, "_elementor_edit_mode", "builder");
    delete_post_meta($post_id, "_elementor_css");
    $written = get_post_meta($post_id, "_elementor_data", true);
    return ["success" => true, "post_id" => $post_id, "bytes" => strlen(is_string($written) ? $written : "")];
}

function agency_os_create_file($r) {
    $path = sanitize_text_field($r->get_param("path"));
    $content = $r->get_param("content");
    $overwrite = $r->get_param("overwrite") ?? true;

    $allowed = ["wp-content/mu-plugins/", "wp-content/uploads/"];
    $ok = false;
    foreach ($allowed as $d) if (str_starts_with($path, $d)) { $ok = true; break; }
    if (!$ok) return new WP_Error("forbidden", "Path not allowed", ["status" => 403]);
    if (strpos($path, "..") !== false) return new WP_Error("invalid", "Path traversal not allowed", ["status" => 400]);

    $full = ABSPATH . $path;
    wp_mkdir_p(dirname($full));

    if (file_exists($full) && !$overwrite) return new WP_Error("exists", "File exists", ["status" => 409]);

    $bytes = file_put_contents($full, $content);
    if ($bytes === false) return new WP_Error("failed", "Write failed", ["status" => 500]);

    return ["success" => true, "path" => $full, "bytes" => $bytes];
}';

$result = file_put_contents($file, $code);
if ($result === false) {
    return "Failed to create mu-plugin file";
}
return "Agency OS File API installed successfully! ($result bytes)";`;

      steps.push('Creating bootstrap snippet...');

      try {
        const snippet = await wpReq('/code-snippets/v1/snippets', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Agency OS File API Bootstrap',
            desc: 'One-time bootstrap to install the File API mu-plugin',
            code: snippetCode,
            scope: 'global',
            active: true
          })
        });
        steps.push('Bootstrap snippet created (ID: ' + snippet.id + ')');

        // Step 5: Verify installation
        steps.push('Verifying File API installation...');

        // Wait a moment for the snippet to execute
        await new Promise(resolve => setTimeout(resolve, 1000));

        try {
          await wpReq('/agency-os/v1/create-file', {
            method: 'POST',
            body: JSON.stringify({ path: '', content: '' })
          });
          steps.push('File API verified and working!');
        } catch (verifyError) {
          if (verifyError.message.includes('403') || verifyError.message.includes('forbidden')) {
            steps.push('File API verified and working!');
          } else {
            steps.push('File API verification pending - may need page reload on WordPress');
          }
        }

        return {
          success: true,
          message: 'File API bootstrap complete!',
          steps,
          snippet_id: snippet.id
        };

      } catch (error) {
        if (error.message.includes('404') || error.message.includes('rest_no_route')) {
          steps.push('Code Snippets REST API not available (need Pro version or REST API addon)');
          return {
            success: false,
            steps,
            message: 'Code Snippets installed but REST API not available',
            manual_instructions: [
              'Code Snippets free version does not have REST API.',
              'Options:',
              '1. Upgrade to Code Snippets Pro, OR',
              '2. Go to Snippets > Add New in WordPress admin',
              '3. Paste this code and run once:',
              '',
              snippetCode
            ]
          };
        }
        throw error;
      }
    }

    // PLUGINS
    case 'wp_list_plugins': {
      const plugins = await wpReq('/wp/v2/plugins');
      let filtered = plugins;

      // Filter by status
      if (args.status && args.status !== 'all') {
        filtered = filtered.filter(p => p.status === args.status);
      }

      // Filter by search term
      if (args.search) {
        const searchLower = args.search.toLowerCase();
        filtered = filtered.filter(p =>
          p.name?.toLowerCase().includes(searchLower) ||
          p.plugin?.toLowerCase().includes(searchLower) ||
          p.description?.raw?.toLowerCase().includes(searchLower)
        );
      }

      return {
        plugins: filtered.map(p => ({
          plugin: p.plugin,
          name: p.name,
          status: p.status,
          version: p.version,
          author: p.author,
          description: p.description?.raw?.substring(0, 200)
        })),
        count: filtered.length,
        total: plugins.length
      };
    }

    case 'wp_install_plugin': {
      // Install plugin from WordPress.org by slug
      const plugin = await wpReq('/wp/v2/plugins', {
        method: 'POST',
        body: JSON.stringify({
          slug: args.slug,
          status: args.activate ? 'active' : 'inactive'
        })
      });

      return {
        success: true,
        plugin: plugin.plugin,
        name: plugin.name,
        status: plugin.status,
        version: plugin.version,
        message: `Plugin "${plugin.name}" installed${args.activate ? ' and activated' : ''}`
      };
    }

    case 'wp_activate_plugin': {
      // Normalize plugin identifier
      let pluginId = args.plugin;
      if (!pluginId.includes('/')) {
        // Try to find the full plugin path
        const plugins = await wpReq('/wp/v2/plugins');
        const found = plugins.find(p =>
          p.plugin.startsWith(pluginId + '/') ||
          p.plugin === pluginId
        );
        if (found) {
          pluginId = found.plugin;
        } else {
          throw new Error(`Plugin "${args.plugin}" not found. Use wp_list_plugins to see installed plugins.`);
        }
      }

      const pluginPath = pluginId.split('/').map(encodeURIComponent).join('/');
      const plugin = await wpReq(`/wp/v2/plugins/${pluginPath}`, {
        method: 'POST',
        body: JSON.stringify({ status: 'active' })
      });

      return {
        success: true,
        plugin: plugin.plugin,
        name: plugin.name,
        status: plugin.status,
        message: `Plugin "${plugin.name}" activated`
      };
    }

    case 'wp_deactivate_plugin': {
      // Normalize plugin identifier
      let pluginId = args.plugin;
      if (!pluginId.includes('/')) {
        const plugins = await wpReq('/wp/v2/plugins');
        const found = plugins.find(p =>
          p.plugin.startsWith(pluginId + '/') ||
          p.plugin === pluginId
        );
        if (found) {
          pluginId = found.plugin;
        } else {
          throw new Error(`Plugin "${args.plugin}" not found. Use wp_list_plugins to see installed plugins.`);
        }
      }

      const pluginPath = pluginId.split('/').map(encodeURIComponent).join('/');
      const plugin = await wpReq(`/wp/v2/plugins/${pluginPath}`, {
        method: 'POST',
        body: JSON.stringify({ status: 'inactive' })
      });

      return {
        success: true,
        plugin: plugin.plugin,
        name: plugin.name,
        status: plugin.status,
        message: `Plugin "${plugin.name}" deactivated`
      };
    }

    case 'wp_delete_plugin': {
      // Normalize plugin identifier
      let pluginId = args.plugin;
      if (!pluginId.includes('/')) {
        const plugins = await wpReq('/wp/v2/plugins');
        const found = plugins.find(p =>
          p.plugin.startsWith(pluginId + '/') ||
          p.plugin === pluginId
        );
        if (found) {
          pluginId = found.plugin;
          // Check if active
          if (found.status === 'active') {
            throw new Error(`Plugin "${found.name}" is active. Deactivate it first using wp_deactivate_plugin.`);
          }
        } else {
          throw new Error(`Plugin "${args.plugin}" not found. Use wp_list_plugins to see installed plugins.`);
        }
      }

      const pluginPath = pluginId.split('/').map(encodeURIComponent).join('/');
      await wpReq(`/wp/v2/plugins/${pluginPath}`, {
        method: 'DELETE'
      });

      return {
        success: true,
        plugin: pluginId,
        message: `Plugin "${pluginId}" deleted`
      };
    }

    case 'wp_update_plugin': {
      // Normalize plugin identifier
      let pluginId = args.plugin;
      if (!pluginId.includes('/')) {
        const plugins = await wpReq('/wp/v2/plugins');
        const found = plugins.find(p =>
          p.plugin.startsWith(pluginId + '/') ||
          p.plugin === pluginId
        );
        if (found) {
          pluginId = found.plugin;
        } else {
          throw new Error(`Plugin "${args.plugin}" not found. Use wp_list_plugins to see installed plugins.`);
        }
      }

      // Use the WP REST API PUT endpoint to trigger a plugin update
      const pluginPath = pluginId.split('/').map(encodeURIComponent).join('/');

      const plugin = await wpReq(`/wp/v2/plugins/${pluginPath}`, {
        method: 'PUT',
        body: JSON.stringify({})
      });

      return {
        success: true,
        plugin: plugin.plugin,
        name: plugin.name,
        version: plugin.version,
        status: plugin.status,
        message: `Plugin "${plugin.name}" updated to version ${plugin.version}`
      };
    }

    case 'wp_install_plugin_zip': {
      // Install plugin from ZIP URL using custom endpoint
      try {
        const result = await wpReq('/agency-os/v1/install-plugin', {
          method: 'POST',
          body: JSON.stringify({
            url: args.url,
            activate: args.activate || false
          })
        });

        return {
          success: true,
          plugin: result.plugin,
          name: result.name,
          version: result.version,
          status: result.status,
          message: result.message || `Plugin installed from ZIP`
        };
      } catch (error) {
        if (error.message.includes('404') || error.message.includes('rest_no_route')) {
          throw new Error(
            'Plugin Installer API not found. Run wp_bootstrap_plugin_installer first to set it up.'
          );
        }
        throw error;
      }
    }

    case 'wp_bootstrap_plugin_installer': {
      const steps = [];
      const force = args.force || false;

      // Step 1: Check if Plugin Installer API already exists
      if (!force) {
        try {
          const check = await wpReq('/agency-os/v1/install-plugin');
          if (check && check.status === 'ready') {
            return {
              success: true,
              already_installed: true,
              message: 'Plugin Installer API is already available'
            };
          }
        } catch (e) {
          steps.push('Plugin Installer API not found, will install...');
        }
      }

      // Step 2: Create the mu-plugin
      const muPluginCode = `<?php
/**
 * Plugin Name: Agency OS Plugin Installer API
 * Description: REST API endpoint for installing plugins from ZIP URLs
 * Version: 1.0.0
 */

add_action('rest_api_init', function() {
    register_rest_route('agency-os/v1', '/install-plugin', [
        'methods' => ['GET', 'POST'],
        'callback' => 'agency_os_install_plugin',
        'permission_callback' => function() {
            return current_user_can('install_plugins');
        }
    ]);
});

function agency_os_install_plugin(WP_REST_Request \\$request) {
    if (\\$request->get_method() === 'GET') {
        return ['status' => 'ready', 'message' => 'Plugin Installer API is available'];
    }

    \\$url = \\$request->get_param('url');
    \\$activate = \\$request->get_param('activate');

    if (empty(\\$url)) {
        return new WP_Error('missing_url', 'ZIP URL is required', ['status' => 400]);
    }

    // Validate URL
    if (!filter_var(\\$url, FILTER_VALIDATE_URL)) {
        return new WP_Error('invalid_url', 'Invalid URL format', ['status' => 400]);
    }

    // Include required files
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/misc.php';
    require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

    // Silent skin to suppress output
    class Agency_OS_Silent_Skin extends WP_Upgrader_Skin {
        public function feedback(\\$string, ...\\$args) {}
        public function header() {}
        public function footer() {}
    }

    \\$skin = new Agency_OS_Silent_Skin();
    \\$upgrader = new Plugin_Upgrader(\\$skin);

    // Install the plugin
    \\$result = \\$upgrader->install(\\$url);

    if (is_wp_error(\\$result)) {
        return \\$result;
    }

    if (!\\$result) {
        return new WP_Error('install_failed', 'Plugin installation failed', ['status' => 500]);
    }

    // Get installed plugin info
    \\$plugin_file = \\$upgrader->plugin_info();
    \\$plugin_data = get_plugin_data(WP_PLUGIN_DIR . '/' . \\$plugin_file);

    // Activate if requested
    \\$status = 'inactive';
    if (\\$activate && \\$plugin_file) {
        \\$activated = activate_plugin(\\$plugin_file);
        if (!is_wp_error(\\$activated)) {
            \\$status = 'active';
        }
    }

    return [
        'success' => true,
        'plugin' => \\$plugin_file,
        'name' => \\$plugin_data['Name'],
        'version' => \\$plugin_data['Version'],
        'author' => \\$plugin_data['Author'],
        'status' => \\$status,
        'message' => 'Plugin installed successfully' . (\\$status === 'active' ? ' and activated' : '')
    ];
}
`;

      // Try to create via File API
      try {
        const fileResult = await wpReq('/agency-os/v1/file', {
          method: 'POST',
          body: JSON.stringify({
            path: 'wp-content/mu-plugins/agency-os-plugin-installer.php',
            content: muPluginCode,
            overwrite: true
          })
        });
        steps.push('Created mu-plugin via File API');

        // Verify it works
        try {
          const check = await wpReq('/agency-os/v1/install-plugin');
          if (check && check.status === 'ready') {
            steps.push('Plugin Installer API is now available');
            return {
              success: true,
              steps,
              message: 'Plugin Installer API installed successfully'
            };
          }
        } catch (e) {
          steps.push('Warning: API created but not responding yet. Try again in a moment.');
        }

        return { success: true, steps };
      } catch (fileError) {
        // File API not available, try Code Snippets
        steps.push('File API not available: ' + fileError.message);

        return {
          success: false,
          steps,
          error: 'Could not install Plugin Installer API',
          manual_install: {
            instructions: [
              '1. Run wp_bootstrap_file_api first to enable File API',
              '2. Then run wp_bootstrap_plugin_installer again',
              'OR manually create wp-content/mu-plugins/agency-os-plugin-installer.php'
            ]
          }
        };
      }
    }

    // WOOCOMMERCE PRODUCTS
    case 'wc_list_products': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));
      if (args.page) params.append('page', String(args.page));
      if (args.search) params.append('search', args.search);
      if (args.category) params.append('category', String(args.category));
      if (args.status) params.append('status', args.status);
      if (args.type) params.append('type', args.type);
      if (args.sku) params.append('sku', args.sku);
      if (args.featured !== undefined) params.append('featured', String(args.featured));
      if (args.on_sale !== undefined) params.append('on_sale', String(args.on_sale));

      const queryString = params.toString();
      const products = await wpReq(`/wc/v3/products${queryString ? '?' + queryString : ''}`);
      return {
        products: products.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          type: p.type,
          status: p.status,
          sku: p.sku,
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          categories: p.categories,
          images: p.images?.map(img => ({ id: img.id, src: img.src, alt: img.alt })),
          permalink: p.permalink
        })),
        count: products.length
      };
    }

    case 'wc_get_product': {
      const product = await wpReq(`/wc/v3/products/${args.id}`);
      return product;
    }

    case 'wc_create_product': {
      const payload = { name: args.name };
      if (args.type) payload.type = args.type;
      if (args.status) payload.status = args.status;
      if (args.regular_price) payload.regular_price = args.regular_price;
      if (args.sale_price) payload.sale_price = args.sale_price;
      if (args.description) payload.description = args.description;
      if (args.short_description) payload.short_description = args.short_description;
      if (args.sku) payload.sku = args.sku;
      if (args.categories) payload.categories = args.categories;
      if (args.images) payload.images = args.images;
      if (args.manage_stock !== undefined) payload.manage_stock = args.manage_stock;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.weight) payload.weight = args.weight;
      if (args.dimensions) payload.dimensions = args.dimensions;
      if (args.attributes) payload.attributes = args.attributes;
      if (args.meta_data) payload.meta_data = args.meta_data;

      const product = await wpReq('/wc/v3/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          permalink: product.permalink,
          status: product.status,
          type: product.type
        }
      };
    }

    case 'wc_update_product': {
      const payload = {};
      if (args.name !== undefined) payload.name = args.name;
      if (args.status !== undefined) payload.status = args.status;
      if (args.regular_price !== undefined) payload.regular_price = args.regular_price;
      if (args.sale_price !== undefined) payload.sale_price = args.sale_price;
      if (args.description !== undefined) payload.description = args.description;
      if (args.short_description !== undefined) payload.short_description = args.short_description;
      if (args.sku !== undefined) payload.sku = args.sku;
      if (args.categories) payload.categories = args.categories;
      if (args.images) payload.images = args.images;
      if (args.manage_stock !== undefined) payload.manage_stock = args.manage_stock;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.featured !== undefined) payload.featured = args.featured;
      if (args.meta_data) payload.meta_data = args.meta_data;

      const product = await wpReq(`/wc/v3/products/${args.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          permalink: product.permalink,
          status: product.status
        }
      };
    }

    case 'wc_delete_product': {
      const params = args.force ? '?force=true' : '';
      const result = await wpReq(`/wc/v3/products/${args.id}${params}`, {
        method: 'DELETE'
      });
      return {
        success: true,
        deleted: result.id,
        message: args.force ? 'Product permanently deleted' : 'Product moved to trash'
      };
    }

    // WOOCOMMERCE CATEGORIES
    case 'wc_list_categories': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));
      if (args.search) params.append('search', args.search);
      if (args.parent !== undefined) params.append('parent', String(args.parent));
      if (args.hide_empty !== undefined) params.append('hide_empty', String(args.hide_empty));

      const queryString = params.toString();
      const categories = await wpReq(`/wc/v3/products/categories${queryString ? '?' + queryString : ''}`);
      return {
        categories: categories.map(c => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          parent: c.parent,
          description: c.description,
          count: c.count,
          image: c.image
        })),
        count: categories.length
      };
    }

    case 'wc_create_category': {
      const payload = { name: args.name };
      if (args.slug) payload.slug = args.slug;
      if (args.parent) payload.parent = args.parent;
      if (args.description) payload.description = args.description;
      if (args.image) payload.image = args.image;

      const category = await wpReq('/wc/v3/products/categories', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          parent: category.parent
        }
      };
    }

    case 'wc_update_category': {
      const payload = {};
      if (args.name !== undefined) payload.name = args.name;
      if (args.slug !== undefined) payload.slug = args.slug;
      if (args.parent !== undefined) payload.parent = args.parent;
      if (args.description !== undefined) payload.description = args.description;
      if (args.image) payload.image = args.image;

      const category = await wpReq(`/wc/v3/products/categories/${args.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug
        }
      };
    }

    case 'wc_delete_category': {
      const params = args.force !== false ? '?force=true' : '';
      const result = await wpReq(`/wc/v3/products/categories/${args.id}${params}`, {
        method: 'DELETE'
      });
      return {
        success: true,
        deleted: result.id,
        message: 'Category deleted'
      };
    }

    // WOOCOMMERCE VARIATIONS
    case 'wc_list_variations': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));

      const queryString = params.toString();
      const variations = await wpReq(`/wc/v3/products/${args.product_id}/variations${queryString ? '?' + queryString : ''}`);
      return {
        product_id: args.product_id,
        variations: variations.map(v => ({
          id: v.id,
          sku: v.sku,
          price: v.price,
          regular_price: v.regular_price,
          sale_price: v.sale_price,
          stock_status: v.stock_status,
          stock_quantity: v.stock_quantity,
          attributes: v.attributes,
          image: v.image
        })),
        count: variations.length
      };
    }

    case 'wc_create_variation': {
      const payload = {};
      if (args.regular_price) payload.regular_price = args.regular_price;
      if (args.sale_price) payload.sale_price = args.sale_price;
      if (args.sku) payload.sku = args.sku;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.attributes) payload.attributes = args.attributes;
      if (args.image) payload.image = args.image;

      const variation = await wpReq(`/wc/v3/products/${args.product_id}/variations`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        variation: {
          id: variation.id,
          sku: variation.sku,
          price: variation.price,
          attributes: variation.attributes
        }
      };
    }

    case 'wc_update_variation': {
      const payload = {};
      if (args.regular_price !== undefined) payload.regular_price = args.regular_price;
      if (args.sale_price !== undefined) payload.sale_price = args.sale_price;
      if (args.sku !== undefined) payload.sku = args.sku;
      if (args.stock_quantity !== undefined) payload.stock_quantity = args.stock_quantity;
      if (args.stock_status) payload.stock_status = args.stock_status;
      if (args.image) payload.image = args.image;

      const variation = await wpReq(`/wc/v3/products/${args.product_id}/variations/${args.variation_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        variation: {
          id: variation.id,
          sku: variation.sku,
          price: variation.price
        }
      };
    }

    case 'wc_delete_variation': {
      const params = args.force !== false ? '?force=true' : '';
      const result = await wpReq(`/wc/v3/products/${args.product_id}/variations/${args.variation_id}${params}`, {
        method: 'DELETE'
      });
      return {
        success: true,
        deleted: result.id,
        message: 'Variation deleted'
      };
    }

    // WOOCOMMERCE ORDERS
    case 'wc_list_orders': {
      const params = new URLSearchParams();
      if (args.per_page) params.append('per_page', String(args.per_page));
      if (args.page) params.append('page', String(args.page));
      if (args.status) params.append('status', args.status);
      if (args.customer) params.append('customer', String(args.customer));
      if (args.product) params.append('product', String(args.product));
      if (args.after) params.append('after', args.after);
      if (args.before) params.append('before', args.before);

      const queryString = params.toString();
      const orders = await wpReq(`/wc/v3/orders${queryString ? '?' + queryString : ''}`);
      return {
        orders: orders.map(o => ({
          id: o.id,
          number: o.number,
          status: o.status,
          total: o.total,
          currency: o.currency,
          customer_id: o.customer_id,
          billing: {
            first_name: o.billing?.first_name,
            last_name: o.billing?.last_name,
            email: o.billing?.email
          },
          date_created: o.date_created,
          line_items_count: o.line_items?.length
        })),
        count: orders.length
      };
    }

    case 'wc_get_order': {
      const order = await wpReq(`/wc/v3/orders/${args.id}`);
      return order;
    }

    case 'wc_update_order': {
      const payload = {};
      if (args.status !== undefined) payload.status = args.status;
      if (args.customer_note !== undefined) payload.customer_note = args.customer_note;
      if (args.meta_data !== undefined) payload.meta_data = args.meta_data;

      const order = await wpReq(`/wc/v3/orders/${args.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      return {
        success: true,
        order: {
          id: order.id,
          number: order.number,
          status: order.status,
          total: order.total
        }
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
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
  if (req.method === 'GET' && req.url === '/mcp') {
    if (!requireApiKey(req, res, API_KEY)) return;
    const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Mcp-Session-Id': sessionId
    });
    res.write(`event: endpoint\ndata: /mcp\n\n`);
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
  if (req.method !== 'POST' || req.url !== '/mcp') {
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
            version: '3.0.0',
            description: '38 WordPress endpoints + PostgreSQL client management (Agency OS integration)'
          }
        }
      }));
    }

    if (method === 'tools/list') {
      return sendResult(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { tools }
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

      await requireExplicitClientRouting(args, method);

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

      const result = await executeTool(name, args || {}, clientConfig);

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
