<?php
/**
 * Strudel Schema - Render Logic
 *
 * Simple: if there's JSON-LD set, output it. That's all.
 */

if (!defined('ABSPATH')) exit;

/**
 * Output JSON-LD schema in wp_head
 */
add_action('wp_head', function () {
    if (!is_singular()) return;

    $post_id = get_queried_object_id();
    if (!$post_id) return;

    $keys = strudel_schema_meta_keys();
    $json = get_post_meta($post_id, $keys['override_json'], true);
    $json = trim((string)$json);

    // No schema set = do nothing, let Yoast/Rank Math handle it
    if (empty($json)) return;

    // Validate JSON
    $decoded = json_decode($json, true);
    if (json_last_error() !== JSON_ERROR_NONE) return;

    // Output the schema
    $output = wp_json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

    echo "\n<!-- Strudel Schema -->\n";
    echo '<script type="application/ld+json">' . "\n";
    echo $output;
    echo "\n</script>\n";
}, 20);

/**
 * Check if current page has schema override
 */
function strudel_schema_is_override_request() {
    if (!is_singular()) return false;

    $post_id = get_queried_object_id();
    if (!$post_id) return false;

    $keys = strudel_schema_meta_keys();
    $json = get_post_meta($post_id, $keys['override_json'], true);

    return !empty(trim((string)$json));
}

/**
 * Get rendered schema for a post (for API)
 */
function strudel_schema_get_rendered($post_id) {
    $keys = strudel_schema_meta_keys();
    $json = get_post_meta($post_id, $keys['override_json'], true);
    $json = trim((string)$json);

    if (empty($json)) return null;

    $decoded = json_decode($json, true);
    if (json_last_error() !== JSON_ERROR_NONE) return null;

    return $decoded;
}
