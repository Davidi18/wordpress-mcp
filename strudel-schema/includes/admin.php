<?php
/**
 * Strudel Schema - Admin UI
 *
 * Metabox for editing schema settings on posts/pages
 */

if (!defined('ABSPATH')) exit;

/**
 * Register metabox
 */
add_action('add_meta_boxes', function () {
    $post_types = apply_filters('strudel_schema_post_types', ['post', 'page']);

    add_meta_box(
        'strudel_schema_box',
        __('Strudel Schema', 'strudel-schema'),
        'strudel_schema_render_metabox',
        $post_types,
        'normal',
        'high'
    );
});

/**
 * Enqueue admin scripts and styles
 */
add_action('admin_enqueue_scripts', function ($hook) {
    if (!in_array($hook, ['post.php', 'post-new.php'])) return;

    wp_add_inline_style('wp-admin', strudel_schema_admin_css());
    wp_add_inline_script('jquery', strudel_schema_admin_js());
});

/**
 * Render the metabox
 *
 * @param WP_Post $post Current post object
 */
function strudel_schema_render_metabox($post) {
    $cfg = strudel_schema_get_config($post->ID);
    $modes = strudel_schema_get_modes();
    $templates = strudel_schema_get_templates();

    wp_nonce_field('strudel_schema_save', 'strudel_schema_nonce');

    // Check if locked
    $is_locked = $cfg['locked'] && !current_user_can('manage_options');
    $disabled = $is_locked ? 'disabled' : '';

    ?>
    <div class="strudel-schema-metabox">
        <?php if ($is_locked): ?>
            <div class="strudel-notice strudel-notice-warning">
                <strong><?php _e('This schema is locked.', 'strudel-schema'); ?></strong>
                <?php _e('Only administrators can edit locked schemas.', 'strudel-schema'); ?>
            </div>
        <?php endif; ?>

        <div class="strudel-row">
            <div class="strudel-col">
                <label><strong><?php _e('Mode', 'strudel-schema'); ?></strong></label>
                <select name="strudel_schema_mode" id="strudel_schema_mode" <?php echo $disabled; ?>>
                    <?php foreach ($modes as $key => $label): ?>
                        <option value="<?php echo esc_attr($key); ?>" <?php selected($cfg['mode'], $key); ?>>
                            <?php echo esc_html($label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
                <p class="description" id="strudel_mode_description"></p>
            </div>

            <div class="strudel-col">
                <label><strong><?php _e('Template', 'strudel-schema'); ?></strong></label>
                <select name="strudel_schema_template" id="strudel_schema_template" <?php echo $disabled; ?>>
                    <?php foreach ($templates as $key => $label): ?>
                        <option value="<?php echo esc_attr($key); ?>" <?php selected($cfg['template'], $key); ?>>
                            <?php echo esc_html($label); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>
        </div>

        <div class="strudel-section" id="strudel_template_section">
            <label><strong><?php _e('Template Data (JSON)', 'strudel-schema'); ?></strong></label>
            <textarea
                name="strudel_schema_data_json"
                id="strudel_schema_data_json"
                rows="6"
                class="strudel-json-editor"
                <?php echo $disabled; ?>
            ><?php echo esc_textarea($cfg['data_json']); ?></textarea>
            <div class="strudel-json-status" id="strudel_data_json_status"></div>
            <p class="description" id="strudel_template_hint"></p>
        </div>

        <hr>

        <div class="strudel-section">
            <label><strong><?php _e('Override JSON-LD (full output)', 'strudel-schema'); ?></strong></label>
            <textarea
                name="strudel_schema_override_json"
                id="strudel_schema_override_json"
                rows="10"
                class="strudel-json-editor"
                <?php echo $disabled; ?>
            ><?php echo esc_textarea($cfg['override_json']); ?></textarea>
            <div class="strudel-json-status" id="strudel_override_json_status"></div>
            <p class="description">
                <?php _e('When Mode is Override and this field has valid JSON, it will be used as the complete schema output.', 'strudel-schema'); ?>
            </p>
        </div>

        <div class="strudel-section">
            <label><strong><?php _e('Extra JSON-LD (optional)', 'strudel-schema'); ?></strong></label>
            <textarea
                name="strudel_schema_extra_json"
                id="strudel_schema_extra_json"
                rows="6"
                class="strudel-json-editor"
                <?php echo $disabled; ?>
            ><?php echo esc_textarea($cfg['extra_json']); ?></textarea>
            <div class="strudel-json-status" id="strudel_extra_json_status"></div>
            <p class="description">
                <?php _e('Additional schema nodes to merge with template output.', 'strudel-schema'); ?>
            </p>
        </div>

        <?php if (current_user_can('manage_options')): ?>
        <hr>
        <div class="strudel-section">
            <label>
                <input type="checkbox" name="strudel_schema_locked" value="1" <?php checked($cfg['locked']); ?>>
                <strong><?php _e('Lock this schema (admin only)', 'strudel-schema'); ?></strong>
            </label>
            <p class="description">
                <?php _e('Prevent non-admin users from editing this schema.', 'strudel-schema'); ?>
            </p>
        </div>
        <?php endif; ?>

        <hr>

        <div class="strudel-section">
            <button type="button" class="button" id="strudel_preview_btn">
                <?php _e('Preview Schema', 'strudel-schema'); ?>
            </button>
            <button type="button" class="button" id="strudel_format_btn">
                <?php _e('Format JSON', 'strudel-schema'); ?>
            </button>
        </div>

        <div class="strudel-section" id="strudel_preview_section" style="display: none;">
            <label><strong><?php _e('Schema Preview', 'strudel-schema'); ?></strong></label>
            <pre id="strudel_preview_output" class="strudel-preview"></pre>
        </div>
    </div>

    <input type="hidden" id="strudel_post_id" value="<?php echo $post->ID; ?>">
    <?php
}

/**
 * Save metabox data
 */
add_action('save_post', function ($post_id) {
    // Skip autosave
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;

    // Verify nonce
    if (!isset($_POST['strudel_schema_nonce'])) return;
    if (!wp_verify_nonce($_POST['strudel_schema_nonce'], 'strudel_schema_save')) return;

    // Check permissions
    if (!current_user_can('edit_post', $post_id)) return;

    // Check if locked (only admins can edit locked schemas)
    $keys = strudel_schema_meta_keys();
    $is_locked = get_post_meta($post_id, $keys['locked'], true);
    if ($is_locked && !current_user_can('manage_options')) return;

    // Validate and save mode
    $mode = isset($_POST['strudel_schema_mode']) ? sanitize_text_field($_POST['strudel_schema_mode']) : 'inherit';
    $allowed_modes = array_keys(strudel_schema_get_modes());
    if (!in_array($mode, $allowed_modes, true)) {
        $mode = 'inherit';
    }
    update_post_meta($post_id, $keys['mode'], $mode);

    // Validate and save template
    $template = isset($_POST['strudel_schema_template']) ? sanitize_text_field($_POST['strudel_schema_template']) : 'custom';
    $allowed_templates = array_keys(strudel_schema_get_templates());
    if (!in_array($template, $allowed_templates, true)) {
        $template = 'custom';
    }
    update_post_meta($post_id, $keys['template'], $template);

    // Save JSON fields (wp_kses_post allows safe HTML entities in JSON)
    $json_fields = ['data_json', 'override_json', 'extra_json'];
    foreach ($json_fields as $field) {
        $key = 'strudel_schema_' . $field;
        $val = isset($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
        // Store as-is, validation happens on render
        update_post_meta($post_id, $keys[$field], $val);
    }

    // Save locked status (admin only)
    if (current_user_can('manage_options')) {
        $locked = isset($_POST['strudel_schema_locked']) ? 1 : 0;
        update_post_meta($post_id, $keys['locked'], $locked);
    }
});

/**
 * Admin CSS
 */
function strudel_schema_admin_css() {
    return '
    .strudel-schema-metabox {
        padding: 10px 0;
    }
    .strudel-schema-metabox label {
        display: block;
        margin-bottom: 5px;
    }
    .strudel-schema-metabox select {
        width: 100%;
    }
    .strudel-schema-metabox .description {
        margin-top: 5px;
        color: #666;
    }
    .strudel-row {
        display: flex;
        gap: 20px;
        margin-bottom: 15px;
    }
    .strudel-col {
        flex: 1;
    }
    .strudel-section {
        margin-bottom: 15px;
    }
    .strudel-json-editor {
        width: 100%;
        font-family: monospace;
        font-size: 12px;
        line-height: 1.4;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        resize: vertical;
    }
    .strudel-json-editor:focus {
        border-color: #2271b1;
        outline: none;
        box-shadow: 0 0 0 1px #2271b1;
    }
    .strudel-json-status {
        margin-top: 5px;
        font-size: 12px;
    }
    .strudel-json-status.valid {
        color: #00a32a;
    }
    .strudel-json-status.invalid {
        color: #d63638;
    }
    .strudel-preview {
        background: #f0f0f1;
        padding: 15px;
        border-radius: 4px;
        overflow-x: auto;
        font-size: 11px;
        line-height: 1.4;
        max-height: 400px;
        overflow-y: auto;
    }
    .strudel-notice {
        padding: 10px 15px;
        margin-bottom: 15px;
        border-radius: 4px;
    }
    .strudel-notice-warning {
        background: #fcf9e8;
        border-left: 4px solid #dba617;
    }
    ';
}

/**
 * Admin JavaScript
 */
function strudel_schema_admin_js() {
    return "
    jQuery(document).ready(function($) {
        var modeDescriptions = {
            'inherit': 'No schema will be output by Strudel. Other plugins (Yoast, Rank Math) will handle schema.',
            'extend': 'Strudel will add its schema alongside existing schemas from other plugins.',
            'override': 'Only Strudel schema will be output. Yoast and Rank Math schemas will be disabled for this page.'
        };

        var templateHints = {
            'custom': 'Use Override JSON for complete control, or Extra JSON to add nodes.',
            'about': 'Fields: organization_id (e.g., \"https://example.com/#organization\")',
            'service': 'Fields: service_name, service_description, organization_id, area_served, service_type',
            'course': 'Fields: course_name, course_description, organization_id, course_code, course_mode, start_date, end_date, location',
            'blog': 'Fields: organization_id (for publisher reference)',
            'faq': 'Fields: faqs (array of {question, answer} objects)',
            'local': 'Fields: business_type, business_name, telephone, email, address {street, city, region, postal_code, country}, latitude, longitude, opening_hours, price_range',
            'product': 'Fields: product_name, product_description, sku, brand, price, currency, availability, rating_value, rating_count, organization_id'
        };

        function updateModeDescription() {
            var mode = $('#strudel_schema_mode').val();
            $('#strudel_mode_description').text(modeDescriptions[mode] || '');
        }

        function updateTemplateHint() {
            var template = $('#strudel_schema_template').val();
            $('#strudel_template_hint').text(templateHints[template] || '');
        }

        function validateJson(textarea) {
            var $textarea = $(textarea);
            var $status = $('#' + $textarea.attr('id') + '_status');
            var val = $textarea.val().trim();

            if (!val) {
                $status.text('').removeClass('valid invalid');
                return true;
            }

            try {
                JSON.parse(val);
                $status.text('Valid JSON').removeClass('invalid').addClass('valid');
                return true;
            } catch (e) {
                $status.text('Invalid JSON: ' + e.message).removeClass('valid').addClass('invalid');
                return false;
            }
        }

        function formatJson(textarea) {
            var $textarea = $(textarea);
            var val = $textarea.val().trim();
            if (!val) return;

            try {
                var parsed = JSON.parse(val);
                $textarea.val(JSON.stringify(parsed, null, 2));
                validateJson(textarea);
            } catch (e) {
                // Already invalid, validation will show error
            }
        }

        // Init
        updateModeDescription();
        updateTemplateHint();
        $('.strudel-json-editor').each(function() {
            validateJson(this);
        });

        // Event listeners
        $('#strudel_schema_mode').on('change', updateModeDescription);
        $('#strudel_schema_template').on('change', updateTemplateHint);

        $('.strudel-json-editor').on('blur', function() {
            validateJson(this);
        });

        $('#strudel_format_btn').on('click', function() {
            $('.strudel-json-editor').each(function() {
                formatJson(this);
            });
        });

        $('#strudel_preview_btn').on('click', function() {
            var postId = $('#strudel_post_id').val();
            var $btn = $(this);
            var $preview = $('#strudel_preview_section');
            var $output = $('#strudel_preview_output');

            $btn.prop('disabled', true).text('Loading...');

            $.ajax({
                url: wpApiSettings.root + 'strudel-schema/v1/post/' + postId + '/preview',
                method: 'POST',
                beforeSend: function(xhr) {
                    xhr.setRequestHeader('X-WP-Nonce', wpApiSettings.nonce);
                },
                data: {
                    mode: $('#strudel_schema_mode').val(),
                    template: $('#strudel_schema_template').val(),
                    data_json: $('#strudel_schema_data_json').val(),
                    override_json: $('#strudel_schema_override_json').val(),
                    extra_json: $('#strudel_schema_extra_json').val()
                },
                success: function(response) {
                    if (response.schema) {
                        $output.text(JSON.stringify(response.schema, null, 2));
                    } else {
                        $output.text('No schema will be output (mode is inherit or no data provided)');
                    }
                    $preview.show();
                },
                error: function(xhr) {
                    $output.text('Error loading preview: ' + (xhr.responseJSON?.message || xhr.statusText));
                    $preview.show();
                },
                complete: function() {
                    $btn.prop('disabled', false).text('Preview Schema');
                }
            });
        });
    });
    ";
}

/**
 * Add admin notice for schema status
 */
add_action('admin_notices', function () {
    global $pagenow, $post;

    if (!in_array($pagenow, ['post.php', 'post-new.php'])) return;
    if (!$post) return;

    $cfg = strudel_schema_get_config($post->ID);

    if ($cfg['mode'] === 'override') {
        $class = 'notice notice-info';
        $message = sprintf(
            __('Strudel Schema is in <strong>Override</strong> mode for this page. Yoast and Rank Math schemas will be disabled.', 'strudel-schema')
        );
        printf('<div class="%1$s"><p>%2$s</p></div>', esc_attr($class), $message);
    }
});
