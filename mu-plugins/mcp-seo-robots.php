<?php
/**
 * MCP SEO Robots API
 *
 * A lightweight mu-plugin that provides REST API endpoints for managing
 * SEO robots settings (noindex, nofollow) for Yoast SEO and Rank Math.
 *
 * Installation: Drop this file into wp-content/mu-plugins/
 * No activation required - it works immediately.
 *
 * @version 1.0.0
 */

if (!defined('ABSPATH')) exit;

add_action('rest_api_init', function () {
    register_rest_route('mcp/v1', '/seo-robots/(?P<id>\d+)', [
        [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => 'mcp_seo_robots_get',
            'permission_callback' => function ($request) {
                return current_user_can('edit_post', (int) $request['id']);
            },
        ],
        [
            'methods'             => WP_REST_Server::EDITABLE,
            'callback'            => 'mcp_seo_robots_set',
            'permission_callback' => function ($request) {
                return current_user_can('edit_post', (int) $request['id']);
            },
        ],
    ]);
});

/**
 * Detect active SEO plugin
 */
function mcp_detect_seo_plugin() {
    if (defined('WPSEO_VERSION') || class_exists('WPSEO_Meta')) {
        return 'yoast';
    }
    if (defined('RANK_MATH_VERSION') || class_exists('RankMath')) {
        return 'rankmath';
    }
    return null;
}

/**
 * GET SEO robots settings
 */
function mcp_seo_robots_get(WP_REST_Request $request) {
    $post_id = (int) $request['id'];
    $post = get_post($post_id);

    if (!$post) {
        return new WP_Error('not_found', 'Post not found', ['status' => 404]);
    }

    $plugin = mcp_detect_seo_plugin();
    $robots = [
        'noindex'   => false,
        'nofollow'  => false,
        'noarchive' => false,
        'nosnippet' => false,
    ];

    if ($plugin === 'yoast') {
        $noindex = get_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', true);
        $nofollow = get_post_meta($post_id, '_yoast_wpseo_meta-robots-nofollow', true);
        $robots['noindex'] = ($noindex === '1');
        $robots['nofollow'] = ($nofollow === '1');
    } elseif ($plugin === 'rankmath') {
        $rm_robots = get_post_meta($post_id, 'rank_math_robots', true);
        if (is_array($rm_robots)) {
            $robots['noindex'] = in_array('noindex', $rm_robots, true);
            $robots['nofollow'] = in_array('nofollow', $rm_robots, true);
            $robots['noarchive'] = in_array('noarchive', $rm_robots, true);
            $robots['nosnippet'] = in_array('nosnippet', $rm_robots, true);
        }
    }

    return [
        'post_id'    => $post_id,
        'title'      => $post->post_title,
        'seo_plugin' => $plugin,
        'robots'     => $robots,
    ];
}

/**
 * SET SEO robots settings
 */
function mcp_seo_robots_set(WP_REST_Request $request) {
    $post_id = (int) $request['id'];
    $post = get_post($post_id);

    if (!$post) {
        return new WP_Error('not_found', 'Post not found', ['status' => 404]);
    }

    $plugin = mcp_detect_seo_plugin();

    if (!$plugin) {
        return new WP_Error('no_seo_plugin', 'No SEO plugin detected (Yoast or Rank Math required)', ['status' => 400]);
    }

    $noindex = $request->get_param('noindex');
    $nofollow = $request->get_param('nofollow');
    $noarchive = $request->get_param('noarchive');
    $nosnippet = $request->get_param('nosnippet');

    if ($plugin === 'yoast') {
        if ($noindex !== null) {
            update_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', $noindex ? '1' : '2');
        }
        if ($nofollow !== null) {
            update_post_meta($post_id, '_yoast_wpseo_meta-robots-nofollow', $nofollow ? '1' : '0');
        }
    } elseif ($plugin === 'rankmath') {
        $rm_robots = get_post_meta($post_id, 'rank_math_robots', true);
        if (!is_array($rm_robots)) {
            $rm_robots = ['index', 'follow'];
        }

        $toggle = function($arr, $on, $off, $enable) {
            $arr = array_diff($arr, [$on, $off]);
            $arr[] = $enable ? $on : $off;
            return array_values($arr);
        };

        if ($noindex !== null) {
            $rm_robots = $toggle($rm_robots, 'noindex', 'index', $noindex);
        }
        if ($nofollow !== null) {
            $rm_robots = $toggle($rm_robots, 'nofollow', 'follow', $nofollow);
        }
        if ($noarchive !== null) {
            $rm_robots = $noarchive
                ? array_unique(array_merge($rm_robots, ['noarchive']))
                : array_values(array_diff($rm_robots, ['noarchive']));
        }
        if ($nosnippet !== null) {
            $rm_robots = $nosnippet
                ? array_unique(array_merge($rm_robots, ['nosnippet']))
                : array_values(array_diff($rm_robots, ['nosnippet']));
        }

        update_post_meta($post_id, 'rank_math_robots', $rm_robots);
    }

    return mcp_seo_robots_get($request);
}
