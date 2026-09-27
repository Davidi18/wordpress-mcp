// MCP tool definitions — "core" toolset (see toolsets.js). Handlers live in executeTool.
export default [
  // SITE INFO (3 endpoints)
  {
    name: 'wp_get_site_info',
    description: 'Get WordPress site information and settings including special page IDs',
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
  // ── AUDIT LOG ──
  {
    name: 'wp_audit_log',
    description: 'Query the log of write operations made through this server (every create/update/delete/install tool call, success or failure). Answers "what changed on this site / this post, when, and what was there before" — previous_state holds rollback data when the tool captured it (Elementor/page-state tools, ACF writes). Needs no client routing.',
    inputSchema: {
      type: 'object',
      properties: {
        filter_client: { type: 'string', description: 'Filter by client name (partial match)' },
        tool: { type: 'string', description: 'Exact tool name, e.g. wp_update_post' },
        target_id: { type: 'string', description: 'Post/page/product ID the write targeted' },
        since: { type: 'string', description: 'ISO timestamp, e.g. 2026-09-27T00:00:00Z' },
        failed_only: { type: 'boolean', description: 'Only failed writes' },
        limit: { type: 'number', description: 'Max rows (1-200)', default: 50 }
      }
    }
  }
];
