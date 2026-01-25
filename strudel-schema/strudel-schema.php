<?php
/**
 * Plugin Name: Strudel Schema
 * Plugin URI: https://strudel.marketing
 * Description: Simple JSON-LD schema field for every page. Paste schema, it outputs. Disables Yoast/Rank Math.
 * Version: 1.0.0
 * Author: Strudel Marketing
 * Author URI: https://strudel.marketing
 */

if (!defined('ABSPATH')) exit;

define('STRUDEL_SCHEMA_VERSION', '1.0.0');
define('STRUDEL_SCHEMA_PATH', plugin_dir_path(__FILE__));

// Load components
require_once STRUDEL_SCHEMA_PATH . 'includes/render.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/admin.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/rest.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/integrations/yoast.php';
require_once STRUDEL_SCHEMA_PATH . 'includes/integrations/rankmath.php';

/**
 * Meta keys
 */
function strudel_schema_meta_keys() {
    return [
        'override_json' => '_strudel_schema_json',
        'mode'          => '_strudel_schema_mode',
    ];
}
