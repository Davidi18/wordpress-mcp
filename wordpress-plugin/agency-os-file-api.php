<?php
/**
 * Plugin Name: Agency OS File API
 * Description: REST API endpoint for creating files via MCP
 * Version: 1.0.0
 *
 * INSTALLATION:
 * Upload this file to: wp-content/mu-plugins/agency-os-file-api.php
 * (Create the mu-plugins folder if it doesn't exist)
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function() {
    register_rest_route('agency-os/v1', '/create-file', [
        'methods' => 'POST',
        'callback' => 'agency_os_create_file',
        'permission_callback' => function() {
            return current_user_can('manage_options');
        },
        'args' => [
            'path' => [
                'required' => true,
                'type' => 'string',
                'description' => 'Relative path from WP root',
                'sanitize_callback' => 'sanitize_text_field'
            ],
            'content' => [
                'required' => true,
                'type' => 'string',
                'description' => 'File content'
            ],
            'overwrite' => [
                'required' => false,
                'type' => 'boolean',
                'default' => true,
                'description' => 'Overwrite if file exists'
            ]
        ]
    ]);
});

/**
 * Create a file on the WordPress server
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function agency_os_create_file($request) {
    $path = $request->get_param('path');
    $content = $request->get_param('content');
    $overwrite = $request->get_param('overwrite') ?? true;

    // Security: Only allow specific directories
    $allowed_dirs = [
        'wp-content/mu-plugins/',
        'wp-content/uploads/',
    ];

    $is_allowed = false;
    foreach ($allowed_dirs as $dir) {
        if (str_starts_with($path, $dir)) {
            $is_allowed = true;
            break;
        }
    }

    if (!$is_allowed) {
        return new WP_Error(
            'forbidden_path',
            'Path not in allowed directories. Allowed: ' . implode(', ', $allowed_dirs),
            ['status' => 403]
        );
    }

    // Security: Prevent path traversal
    if (strpos($path, '..') !== false) {
        return new WP_Error(
            'invalid_path',
            'Path traversal not allowed',
            ['status' => 400]
        );
    }

    // Security: Only .php files in mu-plugins
    if (str_starts_with($path, 'wp-content/mu-plugins/') && !str_ends_with($path, '.php')) {
        return new WP_Error(
            'invalid_extension',
            'Only .php files allowed in mu-plugins',
            ['status' => 400]
        );
    }

    // Resolve full path
    $full_path = ABSPATH . $path;

    // Create directory if needed
    $dir = dirname($full_path);
    if (!file_exists($dir)) {
        if (!wp_mkdir_p($dir)) {
            return new WP_Error(
                'mkdir_failed',
                'Failed to create directory: ' . $dir,
                ['status' => 500]
            );
        }
    }

    // Check if file exists
    if (file_exists($full_path) && !$overwrite) {
        return new WP_Error(
            'file_exists',
            'File already exists and overwrite is false',
            ['status' => 409]
        );
    }

    // Write file
    $result = file_put_contents($full_path, $content);

    if ($result === false) {
        return new WP_Error(
            'write_failed',
            'Failed to write file. Check directory permissions.',
            ['status' => 500]
        );
    }

    return rest_ensure_response([
        'success' => true,
        'path' => $full_path,
        'bytes' => $result,
        'created' => !file_exists($full_path),
        'url' => str_starts_with($path, 'wp-content/uploads/')
            ? content_url(str_replace('wp-content/', '', $path))
            : null
    ]);
}
