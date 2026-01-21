/**
 * ONE-TIME BOOTSTRAP SNIPPET
 *
 * INSTRUCTIONS:
 * 1. Install "Code Snippets" plugin on WordPress site
 * 2. Go to Snippets > Add New
 * 3. Paste this code
 * 4. Set to "Run once"
 * 5. Save and activate
 *
 * This will create the Agency OS File API mu-plugin automatically.
 */

$mu_plugins_dir = ABSPATH . 'wp-content/mu-plugins';
$plugin_file = $mu_plugins_dir . '/agency-os-file-api.php';

// Create mu-plugins directory if it doesn't exist
if (!file_exists($mu_plugins_dir)) {
    wp_mkdir_p($mu_plugins_dir);
}

$plugin_content = <<<'PLUGIN'
<?php
/**
 * Plugin Name: Agency OS File API
 * Description: REST API endpoint for creating files via MCP
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;

add_action('rest_api_init', function() {
    register_rest_route('agency-os/v1', '/create-file', [
        'methods' => 'POST',
        'callback' => 'agency_os_create_file',
        'permission_callback' => function() {
            return current_user_can('manage_options');
        }
    ]);
});

function agency_os_create_file($request) {
    $path = sanitize_text_field($request->get_param('path'));
    $content = $request->get_param('content');
    $overwrite = $request->get_param('overwrite') ?? true;

    $allowed_dirs = ['wp-content/mu-plugins/', 'wp-content/uploads/'];
    $is_allowed = false;
    foreach ($allowed_dirs as $dir) {
        if (str_starts_with($path, $dir)) { $is_allowed = true; break; }
    }

    if (!$is_allowed) {
        return new WP_Error('forbidden', 'Path not in allowed directories', ['status' => 403]);
    }

    if (strpos($path, '..') !== false) {
        return new WP_Error('invalid', 'Path traversal not allowed', ['status' => 400]);
    }

    $full_path = ABSPATH . $path;
    wp_mkdir_p(dirname($full_path));

    if (file_exists($full_path) && !$overwrite) {
        return new WP_Error('exists', 'File exists', ['status' => 409]);
    }

    $bytes = file_put_contents($full_path, $content);

    if ($bytes === false) {
        return new WP_Error('failed', 'Write failed', ['status' => 500]);
    }

    return ['success' => true, 'path' => $full_path, 'bytes' => $bytes];
}
PLUGIN;

// Write the plugin file
$result = file_put_contents($plugin_file, $plugin_content);

if ($result !== false) {
    return "✅ Agency OS File API installed successfully! ({$result} bytes written)";
} else {
    return "❌ Failed to create mu-plugin. Check directory permissions.";
}
