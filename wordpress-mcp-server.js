#!/usr/bin/env node
// WordPress MCP Server v3.0.0 - PostgreSQL Integration + ENV Fallback
// Now reads clients from Agency OS database!
// Includes: Posts, Pages, Media, Comments, Users, Taxonomy, Site Info
// Multi-Client Support with dynamic PostgreSQL loading

import http from 'http';
import pg from 'pg';

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
    // ... existing database code stays the same ...
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

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error(`Invalid JSON from WordPress: ${text.substring(0, 100)}`);
  }

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

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error(`Invalid JSON from WordPress: ${text.substring(0, 100)}`);
    }

    if (!response.ok) {
      throw new Error(`WordPress API error (${response.status}): ${JSON.stringify(data)}`);
    }

    return data;
  };
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
        status: { type: 'string', description: 'Page status' }
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

  // STRUDEL SCHEMA (requires strudel-schema plugin)
  {
    name: 'wp_get_schema',
    description: 'Get JSON-LD schema configuration for a page/post (requires Strudel Schema plugin)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/Page ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_set_schema',
    description: 'Set JSON-LD schema for a page/post. Templates: service, about, blog, faq, course, local, product, custom',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/Page ID', required: true },
        template: { type: 'string', description: 'Template: service, about, blog, faq, course, local, product, custom' },
        data: { type: 'object', description: 'Template data (e.g., {service_name: "...", area_served: "IL"})' },
        override_json: { type: 'object', description: 'Full JSON-LD override (for custom template)' },
        extra_json: { type: 'object', description: 'Extra schema nodes to merge' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_list_schemas',
    description: 'List all pages/posts with schema configuration',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Filter by template (service, about, etc.)' },
        per_page: { type: 'number', description: 'Results per page', default: 50 }
      }
    }
  },
  {
    name: 'wp_preview_schema',
    description: 'Preview rendered JSON-LD schema for a page without saving',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/Page ID', required: true },
        template: { type: 'string', description: 'Template to preview' },
        data: { type: 'object', description: 'Template data to preview' }
      },
      required: ['id']
    }
  },

  // SEO ROBOTS (index/noindex - requires strudel-schema plugin + Yoast SEO or Rank Math)
  {
    name: 'wp_get_seo_robots',
    description: 'Get SEO robots settings (index/noindex, follow/nofollow) for a post. Requires strudel-schema plugin + Yoast/Rank Math.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/Page ID', required: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_set_seo_robots',
    description: 'Set SEO robots settings for a post. Requires strudel-schema plugin. Set noindex:true to prevent indexing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/Page ID', required: true },
        noindex: { type: 'boolean', description: 'Set to true to add noindex (prevent search engine indexing)' },
        nofollow: { type: 'boolean', description: 'Set to true to add nofollow (prevent following links)' },
        noarchive: { type: 'boolean', description: 'Set to true to add noarchive (prevent caching) - Rank Math only' },
        nosnippet: { type: 'boolean', description: 'Set to true to add nosnippet (prevent snippets) - Rank Math only' }
      },
      required: ['id']
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
      if (args.title) updates.title = args.title;
      if (args.content) updates.content = args.content;
      if (args.status) updates.status = args.status;
      if (args.excerpt) updates.excerpt = args.excerpt;

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
      if (args.title) updates.title = args.title;
      if (args.content) updates.content = args.content;
      if (args.status) updates.status = args.status;

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
      
      if (args.title || args.alt_text) {
        const updates = {};
        if (args.title) updates.title = args.title;
        if (args.alt_text) updates.alt_text = args.alt_text;
        
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
      if (args.title) updates.title = { raw: args.title };
      if (args.alt_text !== undefined) updates.alt_text = args.alt_text;
      if (args.caption) updates.caption = { raw: args.caption };
      if (args.description) updates.description = { raw: args.description };
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
      if (args.content) updates.content = args.content;
      if (args.status) updates.status = args.status;

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
      if (args.name) updates.name = args.name;
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

    case 'wp_check_file_api': {
      try {
        // Try to call the endpoint with empty data to see if it exists
        await wpReq('/agency-os/v1/create-file', {
          method: 'POST',
          body: JSON.stringify({ path: '', content: '' })
        });
        return { available: true, message: 'File API is installed and working' };
      } catch (error) {
        if (error.message.includes('403') || error.message.includes('forbidden')) {
          return { available: true, message: 'File API is installed (permission error on empty request is expected)' };
        }
        if (error.message.includes('404') || error.message.includes('rest_no_route')) {
          return {
            available: false,
            message: 'File API not installed',
            instructions: [
              '1. Install "Code Snippets" plugin on the WordPress site',
              '2. Run wp_bootstrap_file_api tool to auto-install the File API',
              'OR manually upload agency-os-file-api.php to wp-content/mu-plugins/'
            ]
          };
        }
        return { available: false, error: error.message };
      }
    }

    case 'wp_bootstrap_file_api': {
      const steps = [];
      const force = args.force || false;

      // Step 1: Check if File API already exists
      if (!force) {
        try {
          await wpReq('/agency-os/v1/create-file', {
            method: 'POST',
            body: JSON.stringify({ path: '', content: '' })
          });
          return { success: true, message: 'File API already installed!', steps: ['File API is working'] };
        } catch (error) {
          if (error.message.includes('403') || error.message.includes('forbidden')) {
            return { success: true, message: 'File API already installed!', steps: ['File API is working'] };
          }
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
});

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

    // STRUDEL SCHEMA
    case 'wp_get_schema': {
      const result = await wpReq(`/strudel-schema/v1/post/${args.id}`);
      return result;
    }

    case 'wp_set_schema': {
      const payload = {
        mode: 'override' // Always override
      };
      if (args.template) payload.template = args.template;
      if (args.data) payload.data_json = args.data;
      if (args.override_json) payload.override_json = args.override_json;
      if (args.extra_json) payload.extra_json = args.extra_json;

      const result = await wpReq(`/strudel-schema/v1/post/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return result;
    }

    case 'wp_list_schemas': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 50)
      });
      if (args.template) params.append('template', args.template);

      const result = await wpReq(`/strudel-schema/v1/posts?${params}`);
      return result;
    }

    case 'wp_preview_schema': {
      const payload = {
        mode: 'override'
      };
      if (args.template) payload.template = args.template;
      if (args.data) payload.data_json = args.data;

      const result = await wpReq(`/strudel-schema/v1/post/${args.id}/preview`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return result;
    }

    // SEO ROBOTS (requires strudel-schema plugin)
    case 'wp_get_seo_robots': {
      const result = await wpReq(`/strudel-schema/v1/seo-robots/${args.id}`);
      return result;
    }

    case 'wp_set_seo_robots': {
      const payload = {};
      if (args.noindex !== undefined) payload.noindex = args.noindex;
      if (args.nofollow !== undefined) payload.nofollow = args.nofollow;
      if (args.noarchive !== undefined) payload.noarchive = args.noarchive;
      if (args.nosnippet !== undefined) payload.nosnippet = args.nosnippet;

      const result = await wpReq(`/strudel-schema/v1/seo-robots/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return result;
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

      const plugin = await wpReq(`/wp/v2/plugins/${encodeURIComponent(pluginId)}`, {
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

      const plugin = await wpReq(`/wp/v2/plugins/${encodeURIComponent(pluginId)}`, {
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

      await wpReq(`/wp/v2/plugins/${encodeURIComponent(pluginId)}`, {
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

      // WordPress REST API doesn't have a direct update endpoint
      // We need to use the update endpoint or reinstall
      // The standard way is to POST to plugins with the slug
      const slug = pluginId.split('/')[0];

      const plugin = await wpReq('/wp/v2/plugins', {
        method: 'POST',
        body: JSON.stringify({
          slug: slug,
          status: 'active'
        })
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

      const products = await wpReq(`/wc/v3/products?${params}`);
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
      if (args.name) payload.name = args.name;
      if (args.status) payload.status = args.status;
      if (args.regular_price) payload.regular_price = args.regular_price;
      if (args.sale_price !== undefined) payload.sale_price = args.sale_price;
      if (args.description) payload.description = args.description;
      if (args.short_description) payload.short_description = args.short_description;
      if (args.sku) payload.sku = args.sku;
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

      const categories = await wpReq(`/wc/v3/products/categories?${params}`);
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
      if (args.name) payload.name = args.name;
      if (args.slug) payload.slug = args.slug;
      if (args.parent !== undefined) payload.parent = args.parent;
      if (args.description) payload.description = args.description;
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

      const variations = await wpReq(`/wc/v3/products/${args.product_id}/variations?${params}`);
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
      if (args.regular_price) payload.regular_price = args.regular_price;
      if (args.sale_price !== undefined) payload.sale_price = args.sale_price;
      if (args.sku) payload.sku = args.sku;
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

      const orders = await wpReq(`/wc/v3/orders?${params}`);
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
      if (args.status) payload.status = args.status;
      if (args.customer_note) payload.customer_note = args.customer_note;
      if (args.meta_data) payload.meta_data = args.meta_data;

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
        'POST /mcp'
      ]
    }));
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const { method, params, id } = body;

    if (method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-01',
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { tools }
      }));
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
    
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🪵 TOOL CALL:', name);
      console.log('📦 ARGS:', JSON.stringify(args, null, 2));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
      // Handle client parameter for multi-site
      let clientConfig = null;
      if (args && args.client) {
        clientConfig = await getClientConfig(args.client);
        delete args.client; // Remove from args after extracting
      }

      // Flatten nested arguments
      if (args && args.arguments && typeof args.arguments === 'object') {
        Object.assign(args, args.arguments);
        delete args.arguments;
      }
    
      // Normalize ID fields
      if (args && typeof args === 'object') {
        if (args.id && !args.ID) args.ID = String(args.id);
        if (args.ID && typeof args.ID !== 'string') args.ID = String(args.ID);
        if (args.postType && !args.post_type) args.post_type = args.postType;
        if (args.type && !args.post_type) args.post_type = args.type;
      }
    
      const result = await executeTool(name, args || {}, clientConfig);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
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
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      error: { code: -32603, message: error.message }
    }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WordPress MCP Server v3.0.0 listening on :${PORT}`);
  console.log(`📡 MCP Protocol: POST /mcp`);
  console.log(`🔍 HTTP API: GET /api/find?slug=...&client=...`);
  console.log(`📋 Clients: GET /api/clients`);
  console.log(`🔐 API Key: ${API_KEY ? 'Enabled ✅' : 'Disabled ⚠️'}`);
  console.log(`🗄️  Database: ${DATABASE_URL ? 'Configured' : 'Not configured (ENV fallback)'}`);
  console.log(`🛠️  Available MCP tools: ${tools.length}`);
});

process.on('SIGTERM', () => {
  if (pgClient) pgClient.end();
  server.close(() => process.exit(0));
});
