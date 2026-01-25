<?php
/**
 * Strudel Schema - Rank Math Integration
 *
 * Disables Rank Math JSON-LD output when page is in override mode
 */

if (!defined('ABSPATH')) exit;

/**
 * Disable Rank Math schema output on override pages
 *
 * The rank_math/json_ld filter provides the complete JSON-LD data.
 * Returning an empty array prevents any schema output.
 *
 * @param array $data JSON-LD schema data
 * @return array
 */
add_filter('rank_math/json_ld', function ($data) {
    if (strudel_schema_is_override_request()) {
        return [];
    }
    return $data;
}, 999);

/**
 * Disable Rank Math schema entirely via disable filter
 * Some versions of Rank Math support this filter
 *
 * @param bool $disable Whether to disable schema
 * @return bool
 */
add_filter('rank_math/schema/disable', function ($disable) {
    if (strudel_schema_is_override_request()) {
        return true;
    }
    return $disable;
}, 999);

/**
 * Remove all schema types (Rank Math alternative method)
 *
 * @param array $schemas Array of schema types
 * @return array
 */
add_filter('rank_math/schema/types', function ($schemas) {
    if (strudel_schema_is_override_request()) {
        return [];
    }
    return $schemas;
}, 999);

/**
 * Disable schema output via the head action
 * This is a more aggressive approach that removes the schema action entirely
 */
add_action('wp', function () {
    if (!strudel_schema_is_override_request()) {
        return;
    }

    // Try to remove Rank Math's schema output action
    // The exact hook varies by Rank Math version
    $possible_hooks = [
        'rank_math/head',
        'rank_math/frontend/head',
    ];

    foreach ($possible_hooks as $hook) {
        if (has_action($hook)) {
            // Get all callbacks and remove schema-related ones
            global $wp_filter;
            if (isset($wp_filter[$hook])) {
                foreach ($wp_filter[$hook]->callbacks as $priority => $callbacks) {
                    foreach ($callbacks as $id => $callback) {
                        if (is_array($callback['function']) && is_object($callback['function'][0])) {
                            $class = get_class($callback['function'][0]);
                            if (stripos($class, 'schema') !== false || stripos($class, 'jsonld') !== false) {
                                remove_action($hook, $callback['function'], $priority);
                            }
                        }
                    }
                }
            }
        }
    }
}, 1);

/**
 * Filter individual schema entities
 * This provides fine-grained control over each schema type
 *
 * @param array $entity Schema entity data
 * @param string $type Schema type
 * @return array|false
 */
add_filter('rank_math/schema/entity', function ($entity, $type = '') {
    if (strudel_schema_is_override_request()) {
        return false;
    }
    return $entity;
}, 999, 2);

/**
 * Disable specific schema modules if Rank Math Pro is active
 */
add_filter('rank_math/schema/pro_schemas', function ($schemas) {
    if (strudel_schema_is_override_request()) {
        return [];
    }
    return $schemas;
}, 999);
