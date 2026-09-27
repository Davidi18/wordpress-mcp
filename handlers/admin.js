// handlers/admin.js
// Tool handlers for the "admin" toolset (see toolsets.js / tool-definitions/admin.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { NOT_HANDLED } from './not-handled.js';

export async function handleAdmin(name, args, ctx) {
  const { wpReq } = ctx;
  switch (name) {

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
  }
  return NOT_HANDLED;
}
