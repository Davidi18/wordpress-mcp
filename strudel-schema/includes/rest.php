<?php
/**
 * Strudel Schema - REST API
 *
 * REST endpoints for managing schema via MCP or external tools
 */

if (!defined('ABSPATH')) exit;

/**
 * Register REST routes
 */
add_action('rest_api_init', function () {
    $namespace = 'strudel-schema/v1';

    // GET/POST single post schema config
    register_rest_route($namespace, '/post/(?P<id>\d+)', [
        [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => 'strudel_schema_rest_get',
            'permission_callback' => 'strudel_schema_rest_permission_read',
            'args'                => [
                'id' => [
                    'validate_callback' => function ($param) {
                        return is_numeric($param);
                    },
                ],
            ],
        ],
        [
            'methods'             => WP_REST_Server::EDITABLE,
            'callback'            => 'strudel_schema_rest_update',
            'permission_callback' => 'strudel_schema_rest_permission_edit',
            'args'                => [
                'id'            => ['required' => true],
                'mode'          => ['required' => false],
                'template'      => ['required' => false],
                'data_json'     => ['required' => false],
                'override_json' => ['required' => false],
                'extra_json'    => ['required' => false],
                'locked'        => ['required' => false],
            ],
        ],
    ]);

    // Preview endpoint (POST to preview without saving)
    register_rest_route($namespace, '/post/(?P<id>\d+)/preview', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'strudel_schema_rest_preview',
        'permission_callback' => 'strudel_schema_rest_permission_read',
        'args'                => [
            'id'            => ['required' => true],
            'mode'          => ['required' => false],
            'template'      => ['required' => false],
            'data_json'     => ['required' => false],
            'override_json' => ['required' => false],
            'extra_json'    => ['required' => false],
        ],
    ]);

    // GET rendered schema output for a post
    register_rest_route($namespace, '/post/(?P<id>\d+)/rendered', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'strudel_schema_rest_rendered',
        'permission_callback' => 'strudel_schema_rest_permission_read',
    ]);

    // Batch update multiple posts
    register_rest_route($namespace, '/batch', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'strudel_schema_rest_batch',
        'permission_callback' => 'strudel_schema_rest_permission_edit_any',
        'args'                => [
            'posts' => [
                'required' => true,
                'type'     => 'array',
            ],
        ],
    ]);

    // List all posts with schema config
    register_rest_route($namespace, '/posts', [
        'methods'             => WP_REST_Server::READABLE,
        'callback'            => 'strudel_schema_rest_list',
        'permission_callback' => 'strudel_schema_rest_permission_read_any',
        'args'                => [
            'mode'      => ['required' => false],
            'template'  => ['required' => false],
            'post_type' => ['required' => false, 'default' => 'any'],
            'per_page'  => ['required' => false, 'default' => 50],
            'page'      => ['required' => false, 'default' => 1],
        ],
    ]);

    // Validate JSON endpoint
    register_rest_route($namespace, '/validate', [
        'methods'             => WP_REST_Server::CREATABLE,
        'callback'            => 'strudel_schema_rest_validate',
        'permission_callback' => 'strudel_schema_rest_permission_read_any',
        'args'                => [
            'json' => ['required' => true],
        ],
    ]);

    // SEO Robots (index/noindex) - GET/POST
    register_rest_route($namespace, '/seo-robots/(?P<id>\d+)', [
        [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => 'strudel_schema_rest_get_seo_robots',
            'permission_callback' => 'strudel_schema_rest_permission_read',
            'args'                => [
                'id' => [
                    'validate_callback' => function ($param) {
                        return is_numeric($param);
                    },
                ],
            ],
        ],
        [
            'methods'             => WP_REST_Server::EDITABLE,
            'callback'            => 'strudel_schema_rest_set_seo_robots',
            'permission_callback' => 'strudel_schema_rest_permission_edit',
            'args'                => [
                'id'        => ['required' => true],
                'noindex'   => ['required' => false, 'type' => 'boolean'],
                'nofollow'  => ['required' => false, 'type' => 'boolean'],
                'noarchive' => ['required' => false, 'type' => 'boolean'],
                'nosnippet' => ['required' => false, 'type' => 'boolean'],
            ],
        ],
    ]);
});

/**
 * Permission callbacks
 */
function strudel_schema_rest_permission_read($request) {
    $post_id = (int) $request['id'];
    return current_user_can('read_post', $post_id);
}

function strudel_schema_rest_permission_edit($request) {
    $post_id = (int) $request['id'];

    // Check basic edit permission
    if (!current_user_can('edit_post', $post_id)) {
        return false;
    }

    // Check if locked
    $keys = strudel_schema_meta_keys();
    $is_locked = get_post_meta($post_id, $keys['locked'], true);
    if ($is_locked && !current_user_can('manage_options')) {
        return new WP_Error(
            'strudel_schema_locked',
            __('This schema is locked. Only administrators can edit it.', 'strudel-schema'),
            ['status' => 403]
        );
    }

    return true;
}

function strudel_schema_rest_permission_read_any() {
    return current_user_can('edit_posts');
}

function strudel_schema_rest_permission_edit_any() {
    return current_user_can('edit_posts');
}

/**
 * GET single post schema config
 */
function strudel_schema_rest_get(WP_REST_Request $request) {
    $post_id = (int) $request['id'];

    $post = get_post($post_id);
    if (!$post) {
        return new WP_Error('not_found', __('Post not found', 'strudel-schema'), ['status' => 404]);
    }

    $cfg = strudel_schema_get_config($post_id);

    // Parse JSON fields for response
    $response = [
        'post_id'   => $post_id,
        'post_type' => $post->post_type,
        'title'     => $post->post_title,
        'url'       => get_permalink($post_id),
        'config'    => [
            'mode'          => $cfg['mode'],
            'template'      => $cfg['template'],
            'data_json'     => $cfg['data_json'],
            'override_json' => $cfg['override_json'],
            'extra_json'    => $cfg['extra_json'],
            'locked'        => $cfg['locked'],
        ],
        'data_parsed'     => strudel_schema_validate_json($cfg['data_json']),
        'override_parsed' => strudel_schema_validate_json($cfg['override_json']),
        'extra_parsed'    => strudel_schema_validate_json($cfg['extra_json']),
    ];

    return new WP_REST_Response($response, 200);
}

/**
 * POST/PUT update single post schema config
 */
function strudel_schema_rest_update(WP_REST_Request $request) {
    $post_id = (int) $request['id'];
    $keys = strudel_schema_meta_keys();

    $post = get_post($post_id);
    if (!$post) {
        return new WP_Error('not_found', __('Post not found', 'strudel-schema'), ['status' => 404]);
    }

    $allowed_modes = array_keys(strudel_schema_get_modes());
    $allowed_templates = array_keys(strudel_schema_get_templates());

    // Update mode
    $mode = $request->get_param('mode');
    if ($mode !== null) {
        $mode = sanitize_text_field($mode);
        if (!in_array($mode, $allowed_modes, true)) {
            return new WP_Error('invalid_mode', __('Invalid mode', 'strudel-schema'), ['status' => 400]);
        }
        update_post_meta($post_id, $keys['mode'], $mode);
    }

    // Update template
    $template = $request->get_param('template');
    if ($template !== null) {
        $template = sanitize_text_field($template);
        if (!in_array($template, $allowed_templates, true)) {
            return new WP_Error('invalid_template', __('Invalid template', 'strudel-schema'), ['status' => 400]);
        }
        update_post_meta($post_id, $keys['template'], $template);
    }

    // Update JSON fields
    foreach (['data_json', 'override_json', 'extra_json'] as $field) {
        $val = $request->get_param($field);
        if ($val !== null) {
            // Accept both string and array/object
            if (is_array($val)) {
                $val = wp_json_encode($val, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }
            // Validate JSON if not empty
            $trimmed = trim((string)$val);
            if ($trimmed !== '') {
                $error = strudel_schema_get_json_error($trimmed);
                if ($error) {
                    return new WP_Error(
                        'invalid_json',
                        sprintf(__('Invalid JSON in %s: %s', 'strudel-schema'), $field, $error),
                        ['status' => 400]
                    );
                }
            }
            update_post_meta($post_id, $keys[$field], $val);
        }
    }

    // Update locked status (admin only)
    $locked = $request->get_param('locked');
    if ($locked !== null && current_user_can('manage_options')) {
        update_post_meta($post_id, $keys['locked'], $locked ? 1 : 0);
    }

    // Return updated config
    return strudel_schema_rest_get($request);
}

/**
 * Preview schema without saving
 */
function strudel_schema_rest_preview(WP_REST_Request $request) {
    $post_id = (int) $request['id'];

    $post = get_post($post_id);
    if (!$post) {
        return new WP_Error('not_found', __('Post not found', 'strudel-schema'), ['status' => 404]);
    }

    // Build temporary config from request
    $cfg = [
        'mode'          => $request->get_param('mode') ?: 'inherit',
        'template'      => $request->get_param('template') ?: 'custom',
        'data_json'     => $request->get_param('data_json') ?: '',
        'override_json' => $request->get_param('override_json') ?: '',
        'extra_json'    => $request->get_param('extra_json') ?: '',
    ];

    // Convert arrays to JSON strings
    foreach (['data_json', 'override_json', 'extra_json'] as $field) {
        if (is_array($cfg[$field])) {
            $cfg[$field] = wp_json_encode($cfg[$field], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }
    }

    $schema = null;

    if ($cfg['mode'] === 'override') {
        $schema = strudel_schema_build_override_graph($post_id, $cfg);
    } elseif ($cfg['mode'] === 'extend') {
        $schema = strudel_schema_build_extend_graph($post_id, $cfg);
    }

    return new WP_REST_Response([
        'post_id' => $post_id,
        'mode'    => $cfg['mode'],
        'schema'  => $schema,
    ], 200);
}

/**
 * GET rendered schema for a post
 */
function strudel_schema_rest_rendered(WP_REST_Request $request) {
    $post_id = (int) $request['id'];

    $post = get_post($post_id);
    if (!$post) {
        return new WP_Error('not_found', __('Post not found', 'strudel-schema'), ['status' => 404]);
    }

    $schema = strudel_schema_get_rendered($post_id);

    return new WP_REST_Response([
        'post_id' => $post_id,
        'schema'  => $schema,
    ], 200);
}

/**
 * Batch update multiple posts
 */
function strudel_schema_rest_batch(WP_REST_Request $request) {
    $posts = $request->get_param('posts');

    if (!is_array($posts)) {
        return new WP_Error('invalid_input', __('Posts must be an array', 'strudel-schema'), ['status' => 400]);
    }

    $results = [];

    foreach ($posts as $item) {
        if (!isset($item['id'])) {
            $results[] = ['error' => 'Missing post ID'];
            continue;
        }

        $post_id = (int) $item['id'];

        // Check permissions
        if (!current_user_can('edit_post', $post_id)) {
            $results[] = ['id' => $post_id, 'error' => 'Permission denied'];
            continue;
        }

        // Check if locked
        $keys = strudel_schema_meta_keys();
        $is_locked = get_post_meta($post_id, $keys['locked'], true);
        if ($is_locked && !current_user_can('manage_options')) {
            $results[] = ['id' => $post_id, 'error' => 'Schema is locked'];
            continue;
        }

        // Create sub-request
        $sub_request = new WP_REST_Request('POST', '/strudel-schema/v1/post/' . $post_id);
        foreach (['mode', 'template', 'data_json', 'override_json', 'extra_json', 'locked'] as $field) {
            if (isset($item[$field])) {
                $sub_request->set_param($field, $item[$field]);
            }
        }
        $sub_request->set_param('id', $post_id);

        $response = strudel_schema_rest_update($sub_request);

        if (is_wp_error($response)) {
            $results[] = [
                'id'    => $post_id,
                'error' => $response->get_error_message(),
            ];
        } else {
            $results[] = [
                'id'      => $post_id,
                'success' => true,
            ];
        }
    }

    return new WP_REST_Response([
        'processed' => count($results),
        'results'   => $results,
    ], 200);
}

/**
 * List posts with schema config
 */
function strudel_schema_rest_list(WP_REST_Request $request) {
    $keys = strudel_schema_meta_keys();

    $args = [
        'post_type'      => $request->get_param('post_type') ?: 'any',
        'posts_per_page' => min(100, (int) $request->get_param('per_page') ?: 50),
        'paged'          => (int) $request->get_param('page') ?: 1,
        'meta_query'     => [],
    ];

    // Filter by mode
    $mode = $request->get_param('mode');
    if ($mode) {
        $args['meta_query'][] = [
            'key'   => $keys['mode'],
            'value' => sanitize_text_field($mode),
        ];
    }

    // Filter by template
    $template = $request->get_param('template');
    if ($template) {
        $args['meta_query'][] = [
            'key'   => $keys['template'],
            'value' => sanitize_text_field($template),
        ];
    }

    // If no filters, only return posts with schema config
    if (empty($args['meta_query'])) {
        $args['meta_query'][] = [
            'key'     => $keys['mode'],
            'compare' => 'EXISTS',
        ];
    }

    $query = new WP_Query($args);
    $posts = [];

    foreach ($query->posts as $post) {
        $cfg = strudel_schema_get_config($post->ID);
        $posts[] = [
            'id'        => $post->ID,
            'title'     => $post->post_title,
            'post_type' => $post->post_type,
            'url'       => get_permalink($post->ID),
            'mode'      => $cfg['mode'],
            'template'  => $cfg['template'],
            'locked'    => $cfg['locked'],
        ];
    }

    return new WP_REST_Response([
        'total'       => $query->found_posts,
        'total_pages' => $query->max_num_pages,
        'page'        => $args['paged'],
        'posts'       => $posts,
    ], 200);
}

/**
 * Validate JSON
 */
function strudel_schema_rest_validate(WP_REST_Request $request) {
    $json = $request->get_param('json');

    // Handle array input
    if (is_array($json)) {
        return new WP_REST_Response([
            'valid'  => true,
            'parsed' => $json,
        ], 200);
    }

    $error = strudel_schema_get_json_error($json);

    if ($error) {
        return new WP_REST_Response([
            'valid' => false,
            'error' => $error,
        ], 200);
    }

    return new WP_REST_Response([
        'valid'  => true,
        'parsed' => json_decode($json, true),
    ], 200);
}

/**
 * Detect which SEO plugin is active
 * @return string|null 'yoast', 'rankmath', or null
 */
function strudel_schema_detect_seo_plugin() {
    // Check Yoast SEO
    if (defined('WPSEO_VERSION') || class_exists('WPSEO_Meta')) {
        return 'yoast';
    }
    // Check Rank Math
    if (defined('RANK_MATH_VERSION') || class_exists('RankMath')) {
        return 'rankmath';
    }
    return null;
}

/**
 * GET SEO robots settings for a post
 */
function strudel_schema_rest_get_seo_robots(WP_REST_Request $request) {
    $post_id = (int) $request['id'];

    $post = get_post($post_id);
    if (!$post) {
        return new WP_Error('not_found', __('Post not found', 'strudel-schema'), ['status' => 404]);
    }

    $plugin = strudel_schema_detect_seo_plugin();

    $robots = [
        'noindex'   => false,
        'nofollow'  => false,
        'noarchive' => false,
        'nosnippet' => false,
    ];

    if ($plugin === 'yoast') {
        // Yoast uses individual meta keys
        // Value '1' = noindex, '2' or empty = index (site default)
        $noindex = get_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', true);
        $nofollow = get_post_meta($post_id, '_yoast_wpseo_meta-robots-nofollow', true);

        $robots['noindex'] = ($noindex === '1');
        $robots['nofollow'] = ($nofollow === '1');
        // Yoast handles noarchive/nosnippet at site level, not per-post in free version

    } elseif ($plugin === 'rankmath') {
        // Rank Math uses a serialized array in rank_math_robots
        $rm_robots = get_post_meta($post_id, 'rank_math_robots', true);

        if (is_array($rm_robots)) {
            $robots['noindex'] = in_array('noindex', $rm_robots, true);
            $robots['nofollow'] = in_array('nofollow', $rm_robots, true);
            $robots['noarchive'] = in_array('noarchive', $rm_robots, true);
            $robots['nosnippet'] = in_array('nosnippet', $rm_robots, true);
        }
    }

    return new WP_REST_Response([
        'post_id'    => $post_id,
        'post_type'  => $post->post_type,
        'title'      => $post->post_title,
        'seo_plugin' => $plugin,
        'robots'     => $robots,
    ], 200);
}

/**
 * POST/PUT SEO robots settings for a post
 */
function strudel_schema_rest_set_seo_robots(WP_REST_Request $request) {
    $post_id = (int) $request['id'];

    $post = get_post($post_id);
    if (!$post) {
        return new WP_Error('not_found', __('Post not found', 'strudel-schema'), ['status' => 404]);
    }

    $plugin = strudel_schema_detect_seo_plugin();

    if (!$plugin) {
        return new WP_Error(
            'no_seo_plugin',
            __('No supported SEO plugin detected (Yoast SEO or Rank Math required)', 'strudel-schema'),
            ['status' => 400]
        );
    }

    // Get current robots settings
    $noindex = $request->get_param('noindex');
    $nofollow = $request->get_param('nofollow');
    $noarchive = $request->get_param('noarchive');
    $nosnippet = $request->get_param('nosnippet');

    if ($plugin === 'yoast') {
        // Yoast: '1' = noindex/nofollow, '2' = index/follow (explicit), '' = site default
        if ($noindex !== null) {
            update_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', $noindex ? '1' : '2');
        }
        if ($nofollow !== null) {
            update_post_meta($post_id, '_yoast_wpseo_meta-robots-nofollow', $nofollow ? '1' : '0');
        }
        // Note: Yoast free doesn't support per-post noarchive/nosnippet

    } elseif ($plugin === 'rankmath') {
        // Rank Math: array of robot directives
        $rm_robots = get_post_meta($post_id, 'rank_math_robots', true);
        if (!is_array($rm_robots)) {
            $rm_robots = ['index', 'follow']; // Default
        }

        // Helper to toggle directive
        $toggle = function($directives, $on_value, $off_value, $should_be_on) {
            // Remove both values first
            $directives = array_diff($directives, [$on_value, $off_value]);
            // Add the correct one
            $directives[] = $should_be_on ? $on_value : $off_value;
            return array_values($directives);
        };

        if ($noindex !== null) {
            $rm_robots = $toggle($rm_robots, 'noindex', 'index', $noindex);
        }
        if ($nofollow !== null) {
            $rm_robots = $toggle($rm_robots, 'nofollow', 'follow', $nofollow);
        }
        if ($noarchive !== null) {
            if ($noarchive) {
                if (!in_array('noarchive', $rm_robots, true)) {
                    $rm_robots[] = 'noarchive';
                }
            } else {
                $rm_robots = array_values(array_diff($rm_robots, ['noarchive']));
            }
        }
        if ($nosnippet !== null) {
            if ($nosnippet) {
                if (!in_array('nosnippet', $rm_robots, true)) {
                    $rm_robots[] = 'nosnippet';
                }
            } else {
                $rm_robots = array_values(array_diff($rm_robots, ['nosnippet']));
            }
        }

        update_post_meta($post_id, 'rank_math_robots', $rm_robots);
    }

    // Return updated settings
    return strudel_schema_rest_get_seo_robots($request);
}
