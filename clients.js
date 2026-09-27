// clients.js
// WordPress client registry: Agency OS PostgreSQL (clients table) first, ENV
// (WP_API_URL / CLIENT<n>_*) as fallback. Also owns the shared pg pool.
import pg from 'pg';

// PostgreSQL Configuration (Agency OS via Tailscale)
// No hardcoded fallback: credentials must come from the environment.
export const DATABASE_URL = process.env.DATABASE_URL || null;

// Client cache (refreshes every 5 minutes)
let clientCache = null;
let clientCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// PostgreSQL client
export let pgClient = null;

export async function initDatabase() {
  if (pgClient) return pgClient;
  if (!DATABASE_URL) return null;

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
export async function loadClientsFromDB() {
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
export function invalidateClientCache() {
  clientCache = null;
  clientCacheTime = 0;
  console.log('🔄 Client cache invalidated');
}

// Extract domain from URL
export function extractDomain(url) {
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
export async function getClientConfig(clientId = null) {
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
export async function getAllClientConfigs() {
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
export async function detectClientByDomain(urlString) {
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
