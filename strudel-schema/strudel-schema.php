<?php
/**
 * Plugin Name: Strudel Schema
 * Plugin URI: https://strudel.marketing
 * Description: Single-source JSON-LD schema with per-page UI, override modes, and REST API for MCP integration.
 * Version: 0.1.0
 * Author: Strudel Marketing
 * Author URI: https://strudel.marketing
 * Text Domain: strudel-schema
 * Domain Path: /languages
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('STRUDEL_SCHEMA_VERSION', '0.1.0');
define('STRUDEL_SCHEMA_PATH', plugin_dir_path(__FILE__));
define('STRUDEL_SCHEMA_URL', plugin_dir_url(__FILE__));

// Load components
require_once STRUDEL_SCHEMA_PATH . 'includes/settings.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/render.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/admin.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/rest.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/integrations/yoast.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/integrations/rankmath.php';

/**
 * Meta keys used by the plugin
 *
 * @return array Associative array of meta key names
 */
function strudel_schema_meta_keys() {
    return [
        'mode'          => '_strudel_schema_mode',          // inherit | extend | override
        'template'      => '_strudel_schema_template',      // about | service | course | blog | custom
        'data_json'     => '_strudel_schema_data_json',     // JSON object for template inputs
        'override_json' => '_strudel_schema_override_json', // Full JSON-LD graph override (string)
        'extra_json'    => '_strudel_schema_extra_json',    // Optional extra nodes (string)
        'locked'        => '_strudel_schema_locked',        // Lock editing (1 = locked)
    ];
}

/**
 * Available modes and their descriptions
 *
 * @return array
 */
function strudel_schema_get_modes() {
    return [
        'inherit'  => __('Inherit (do nothing)', 'strudel-schema'),
        'extend'   => __('Extend (add schema alongside existing)', 'strudel-schema'),
        'override' => __('Override (only Strudel schema on this page)', 'strudel-schema'),
    ];
}

/**
 * Available templates and their descriptions
 *
 * @return array
 */
function strudel_schema_get_templates() {
    return [
        'custom'      => __('Custom (use override/extra JSON only)', 'strudel-schema'),
        'about'       => __('AboutPage', 'strudel-schema'),
        'service'     => __('Service', 'strudel-schema'),
        'course'      => __('Course', 'strudel-schema'),
        'blog'        => __('BlogPosting', 'strudel-schema'),
        'faq'         => __('FAQPage', 'strudel-schema'),
        'local'       => __('LocalBusiness', 'strudel-schema'),
        'product'     => __('Product', 'strudel-schema'),
    ];
}

/**
 * Get schema configuration for a post
 *
 * @param int $post_id Post ID
 * @return array Configuration array
 */
function strudel_schema_get_config($post_id) {
    $keys = strudel_schema_meta_keys();

    $mode = get_post_meta($post_id, $keys['mode'], true);
    if (!$mode) {
        // Use default from settings, fallback to override
        $defaults = get_option('strudel_schema_defaults', []);
        $mode = $defaults['default_mode'] ?? 'override';
    }

    $template = get_post_meta($post_id, $keys['template'], true);
    if (!$template) $template = 'custom';

    return [
        'mode'          => $mode,
        'template'      => $template,
        'data_json'     => (string) get_post_meta($post_id, $keys['data_json'], true),
        'override_json' => (string) get_post_meta($post_id, $keys['override_json'], true),
        'extra_json'    => (string) get_post_meta($post_id, $keys['extra_json'], true),
        'locked'        => (bool) get_post_meta($post_id, $keys['locked'], true),
    ];
}

/**
 * Check if the current request is for an override page
 *
 * @return bool
 */
function strudel_schema_is_override_request() {
    if (!is_singular()) return false;

    $post_id = get_queried_object_id();
    if (!$post_id) return false;

    $cfg = strudel_schema_get_config($post_id);
    return $cfg['mode'] === 'override';
}

/**
 * Validate JSON string
 *
 * @param string $json JSON string to validate
 * @return array|null Decoded array or null if invalid
 */
function strudel_schema_validate_json($json) {
    $json = trim((string)$json);
    if ($json === '') return null;

    $decoded = json_decode($json, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return null;
    }

    return $decoded;
}

/**
 * Get JSON validation error message
 *
 * @param string $json JSON string to validate
 * @return string|null Error message or null if valid
 */
function strudel_schema_get_json_error($json) {
    $json = trim((string)$json);
    if ($json === '') return null;

    json_decode($json, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return json_last_error_msg();
    }

    return null;
}

/**
 * Clean up null values from array recursively
 *
 * @param mixed $value Value to clean
 * @return mixed Cleaned value
 */
function strudel_schema_cleanup_nulls($value) {
    if (is_array($value)) {
        foreach ($value as $k => $v) {
            $value[$k] = strudel_schema_cleanup_nulls($v);
            if ($value[$k] === null) {
                unset($value[$k]);
            }
        }
    }
    return $value;
}

/**
 * Plugin activation hook
 */
function strudel_schema_activate() {
    // Flush rewrite rules for REST API
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'strudel_schema_activate');

/**
 * Plugin deactivation hook
 */
function strudel_schema_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'strudel_schema_deactivate');
