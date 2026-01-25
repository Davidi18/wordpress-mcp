<?php
/**
 * Strudel Schema - REST API
 *
 * Simple endpoints: get/set JSON-LD for a post
 */

if (!defined('ABSPATH')) exit;

add_action('rest_api_init', function () {
    $namespace = 'strudel-schema/v1';

    // GET/POST single post schema
    register_rest_route($namespace, '/post/(?P<id>\d+)', [
        [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => 'strudel_schema_rest_get',
            'permission_callback' => function ($r) {
                return current_user_can('edit_post', (int) $r['id']);
            },
        ],
        [
            'methods'             => WP_REST_Server::EDITABLE,
            'callback'            => 'strudel_schema_rest_update',
            'permission_callback' => function ($r) {
                return current_user_can('edit_post', (int) $r['id']);
            },
        ],
    ]);

    // GET rendered schema
    register_rest_route($namespace, '/post/(?P<id>\d+)/rendered', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'strudel_schema_rest_rendered',
        'permission_callback' => function ($r) {
            return current_user_can('read_post', (int) $r['id']);
        },
    ]);

    // List posts with schema
    register_rest_route($namespace, '/posts', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'strudel_schema_rest_list',
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        },
    ]);
});

/**
 * GET schema for a post
 */
function strudel_schema_rest_get(WP_REST_Request $request) {
    $post_id = (int) $request['id'];
    $post = get_post($post_id);

    if (!$post) {
        return new WP_Error('not_found', 'Post not found', ['status' => 404]);
    }

    $keys = strudel_schema_meta_keys();
    $json = get_post_meta($post_id, $keys['override_json'], true);

    return [
        'post_id' => $post_id,
        'title'   => $post->post_title,
        'url'     => get_permalink($post_id),
        'schema'  => $json ? json_decode($json, true) : null,
    ];
}

/**
 * POST/PUT - Update schema for a post
 */
function strudel_schema_rest_update(WP_REST_Request $request) {
    $post_id = (int) $request['id'];
    $post = get_post($post_id);

    if (!$post) {
        return new WP_Error('not_found', 'Post not found', ['status' => 404]);
    }

    $keys = strudel_schema_meta_keys();

    // Accept schema as object or override_json as string/object
    $schema = $request->get_param('schema');
    if ($schema === null) {
        $schema = $request->get_param('override_json');
    }

    // Convert to string for storage
    if (is_array($schema)) {
        $json = wp_json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    } else {
        $json = (string) $schema;
    }

    // Validate JSON if not empty
    if (!empty(trim($json))) {
        json_decode($json, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return new WP_Error('invalid_json', 'Invalid JSON: ' . json_last_error_msg(), ['status' => 400]);
        }
    }

    // Save
    update_post_meta($post_id, $keys['override_json'], $json);
    update_post_meta($post_id, $keys['mode'], !empty(trim($json)) ? 'override' : 'inherit');

    return [
        'success' => true,
        'post_id' => $post_id,
        'schema'  => $json ? json_decode($json, true) : null,
    ];
}

/**
 * GET rendered schema
 */
function strudel_schema_rest_rendered(WP_REST_Request $request) {
    $post_id = (int) $request['id'];

    return [
        'post_id' => $post_id,
        'schema'  => strudel_schema_get_rendered($post_id),
    ];
}

/**
 * List posts with schema
 */
function strudel_schema_rest_list(WP_REST_Request $request) {
    $keys = strudel_schema_meta_keys();
    $per_page = (int) ($request->get_param('per_page') ?: 50);

    $query = new WP_Query([
        'post_type'      => 'any',
        'posts_per_page' => min(100, $per_page),
        'meta_query'     => [
            [
                'key'     => $keys['override_json'],
                'value'   => '',
                'compare' => '!=',
            ],
        ],
    ]);

    $posts = [];
    foreach ($query->posts as $post) {
        $posts[] = [
            'id'    => $post->ID,
            'title' => $post->post_title,
            'url'   => get_permalink($post->ID),
            'type'  => $post->post_type,
        ];
    }

    return [
        'total' => $query->found_posts,
        'posts' => $posts,
    ];
}
