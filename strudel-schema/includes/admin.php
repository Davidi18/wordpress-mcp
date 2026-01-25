<?php
/**
 * Strudel Schema - Admin UI
 *
 * Simple metabox: one field for JSON-LD, that's it.
 */

if (!defined('ABSPATH')) exit;

/**
 * Register metabox
 */
add_action('add_meta_boxes', function () {
    $post_types = apply_filters('strudel_schema_post_types', ['post', 'page']);

    add_meta_box(
        'strudel_schema_box',
        __('Schema (JSON-LD)', 'strudel-schema'),
        'strudel_schema_render_metabox',
        $post_types,
        'normal',
        'default'
    );
});

/**
 * Enqueue admin scripts and styles
 */
add_action('admin_enqueue_scripts', function ($hook) {
    if (!in_array($hook, ['post.php', 'post-new.php'])) return;

    wp_add_inline_style('wp-admin', '
        .strudel-schema-field {
            width: 100%;
            min-height: 200px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.5;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            resize: vertical;
        }
        .strudel-schema-field:focus {
            border-color: #2271b1;
            outline: none;
            box-shadow: 0 0 0 1px #2271b1;
        }
        .strudel-status {
            margin-top: 8px;
            font-size: 12px;
        }
        .strudel-status.valid { color: #00a32a; }
        .strudel-status.invalid { color: #d63638; }
        .strudel-info {
            color: #666;
            font-size: 12px;
            margin-top: 10px;
        }
    ');

    wp_add_inline_script('jquery', '
        jQuery(document).ready(function($) {
            var $field = $("#strudel_schema_json");
            var $status = $("#strudel_status");

            function validate() {
                var val = $field.val().trim();
                if (!val) {
                    $status.text("No schema set - Yoast/Rank Math will handle this page").removeClass("valid invalid");
                    return;
                }
                try {
                    JSON.parse(val);
                    $status.text("Valid JSON-LD - will override other schemas").removeClass("invalid").addClass("valid");
                } catch (e) {
                    $status.text("Invalid JSON: " + e.message).removeClass("valid").addClass("invalid");
                }
            }

            function format() {
                var val = $field.val().trim();
                if (!val) return;
                try {
                    var parsed = JSON.parse(val);
                    $field.val(JSON.stringify(parsed, null, 2));
                    validate();
                } catch (e) {}
            }

            $field.on("blur", validate);
            $("#strudel_format_btn").on("click", format);
            validate();
        });
    ');
});

/**
 * Render the metabox
 */
function strudel_schema_render_metabox($post) {
    $keys = strudel_schema_meta_keys();
    $json = get_post_meta($post->ID, $keys['override_json'], true);

    wp_nonce_field('strudel_schema_save', 'strudel_schema_nonce');
    ?>
    <textarea
        name="strudel_schema_json"
        id="strudel_schema_json"
        class="strudel-schema-field"
        placeholder='{"@context": "https://schema.org", "@type": "WebPage", "name": "..."}'
    ><?php echo esc_textarea($json); ?></textarea>

    <div class="strudel-status" id="strudel_status"></div>

    <p class="strudel-info">
        <button type="button" class="button button-small" id="strudel_format_btn">Format JSON</button>
        &nbsp; Paste any JSON-LD schema. When set, Yoast/Rank Math schemas are disabled for this page.
    </p>
    <?php
}

/**
 * Save metabox data
 */
add_action('save_post', function ($post_id) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (!isset($_POST['strudel_schema_nonce'])) return;
    if (!wp_verify_nonce($_POST['strudel_schema_nonce'], 'strudel_schema_save')) return;
    if (!current_user_can('edit_post', $post_id)) return;

    $keys = strudel_schema_meta_keys();
    $json = isset($_POST['strudel_schema_json']) ? wp_unslash($_POST['strudel_schema_json']) : '';
    $json = trim($json);

    // Save the JSON
    update_post_meta($post_id, $keys['override_json'], $json);

    // Set mode based on whether JSON is present
    $mode = !empty($json) ? 'override' : 'inherit';
    update_post_meta($post_id, $keys['mode'], $mode);
});
