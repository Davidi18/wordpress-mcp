<?php
/**
 * Strudel Schema - Yoast SEO Integration
 *
 * Disables Yoast JSON-LD output when page is in override mode
 */

if (!defined('ABSPATH')) exit;

/**
 * Disable Yoast schema output on override pages
 *
 * The wpseo_json_ld_output filter allows us to prevent Yoast from
 * outputting its JSON-LD schema markup.
 *
 * @param array|false $data The schema data or false to disable
 * @return array|false
 */
add_filter('wpseo_json_ld_output', function ($data) {
    if (strudel_schema_is_override_request()) {
        return false;
    }
    return $data;
}, 999);

/**
 * Alternative hook for newer Yoast versions
 * This filter controls whether the schema should be output at all
 *
 * @param bool $should_output Whether to output schema
 * @return bool
 */
add_filter('wpseo_schema_needs_output', function ($should_output) {
    if (strudel_schema_is_override_request()) {
        return false;
    }
    return $should_output;
}, 999);

/**
 * Remove specific schema pieces if needed (Yoast 14+)
 * This allows more granular control over which schema pieces are output
 *
 * @param array $pieces Array of schema piece generators
 * @return array
 */
add_filter('wpseo_schema_graph_pieces', function ($pieces) {
    if (strudel_schema_is_override_request()) {
        return []; // Remove all pieces
    }
    return $pieces;
}, 999);

/**
 * Disable schema presenter if available (Yoast 15+)
 *
 * @param array $presenters Array of presenters
 * @return array
 */
add_filter('wpseo_frontend_presenters', function ($presenters) {
    if (!strudel_schema_is_override_request()) {
        return $presenters;
    }

    // Remove schema presenter
    return array_filter($presenters, function ($presenter) {
        $class = is_object($presenter) ? get_class($presenter) : $presenter;
        return strpos($class, 'Schema') === false;
    });
}, 999);
