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

// Get client config - tries DB first, then ENV fallback
async function getClientConfig(clientId = null) {
  // Try database first
  const dbClients = await loadClientsFromDB();
  
  if (dbClients && dbClients.length > 0) {
    // If specific client requested
    if (clientId) {
      const client = dbClients.find(c => 
        c.wordpress_client_id === clientId ||
        c.name.toLowerCase() === clientId.toLowerCase() ||
        extractDomain(c.wordpress_url) === extractDomain(clientId)
      );
      
      if (client) {
        const wpUrl = client.wordpress_url.startsWith('http') 
          ? client.wordpress_url 
          : `https://${client.wordpress_url}`;
        
        return {
          url: wpUrl,
          username: client.wordpress_username,
          password: client.wordpress_app_password,
          name: client.name,
          id: client.id,
          source: 'database'
        };
      }
    }
    
    // Return first active client as default
    const defaultClient = dbClients[0];
    const wpUrl = defaultClient.wordpress_url.startsWith('http') 
      ? defaultClient.wordpress_url 
      : `https://${defaultClient.wordpress_url}`;
    
    return {
      url: wpUrl,
      username: defaultClient.wordpress_username,
      password: defaultClient.wordpress_app_password,
      name: defaultClient.name,
      id: defaultClient.id,
      source: 'database'
    };
  }
  
  // Fallback to ENV configuration
  console.log('📋 Using ENV fallback for client config');
  
  const activeClient = clientId || process.env.ACTIVE_CLIENT || 'default';

  if (activeClient === 'default') {
    return {
      url: process.env.WP_API_URL,
      username: process.env.WP_API_USERNAME,
      password: process.env.WP_API_PASSWORD,
      name: 'default',
      source: 'env'
    };
  }

  // Support for CLIENT1_NAME, CLIENT2_NAME, etc.
  const clientPrefix = activeClient.toUpperCase().replace(/-/g, '_');
  return {
    url: process.env[`${clientPrefix}_WP_API_URL`],
    username: process.env[`${clientPrefix}_WP_API_USERNAME`],
    password: process.env[`${clientPrefix}_WP_API_PASSWORD`],
    name: activeClient,
    source: 'env'
  };
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

console.log(`🚀 Default Client: ${initConfig.name} (${initConfig.source})`);

async function wpRequest(endpoint, options = {}) {
  const url = `${wpApiBase}${endpoint}`;
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
    const url = `${wpApiBase}${endpoint}`;
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
        post_type: { type: 'string', description: 'Custom post type slug', required: true },
        title: { type: 'string', description: 'Post title', required: true },
        content: { type: 'string', description: 'Post content', required: true },
        status: { type: 'string', description: 'Post status', default: 'draft' },
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
      const post = await wpReq('/wp/v2/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: args.title,
          content: args.content,
          status: args.status || 'draft',
          excerpt: args.excerpt,
          categories: args.categories,
          tags: args.tags
        })
      });
      return { id: post.id, link: post.link, status: post.status };
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
      return { id: post.id, link: post.link, status: post.status };
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
      return { id: page.id, link: page.link, status: page.status };
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
      return { id: page.id, link: page.link, status: page.status };
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
      
      if (args.meta) {
        postData.acf = args.meta;
      }
      
      const post = await wpReq(`/wp/v2/${args.post_type}`, {
        method: 'POST',
        body: JSON.stringify(postData)
      });
      
      return { 
        id: post.id, 
        link: post.link,
        status: post.status
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
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
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
