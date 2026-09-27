// MCP tool definitions — "admin" toolset (see toolsets.js). Handlers live in executeTool.
export default [
  // FILE OPERATIONS
  {
    name: 'wp_create_file',
    description: 'Create a file on the WordPress server (restricted to allowed directories: wp-content/mu-plugins/, wp-content/uploads/)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from WP root (e.g., "wp-content/mu-plugins/file.php")' },
        content: { type: 'string', description: 'File content' },
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
        id: { type: 'number', description: 'Snippet ID' }
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
        name: { type: 'string', description: 'Snippet name' },
        code: { type: 'string', description: 'Snippet body WITHOUT the opening <?php tag' },
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
        id: { type: 'number', description: 'Snippet ID' },
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
        id: { type: 'number', description: 'Snippet ID' }
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
        id: { type: 'number', description: 'Snippet ID' }
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
        id: { type: 'number', description: 'Snippet ID' }
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
        slug: { type: 'string', description: 'Plugin slug from WordPress.org (e.g., "akismet", "contact-form-7")' },
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
        url: { type: 'string', description: 'URL to the plugin ZIP file' },
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
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")' }
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
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")' }
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
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")' }
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
        plugin: { type: 'string', description: 'Plugin identifier (e.g., "akismet/akismet.php" or just "akismet")' }
      },
      required: ['plugin']
    }
  }
];
