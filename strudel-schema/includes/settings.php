<?php
/**
 * Strudel Schema - Global Settings Page
 *
 * Admin settings for global Organization and WebSite schema
 */

if (!defined('ABSPATH')) exit;

/**
 * Register settings page
 */
add_action('admin_menu', function () {
    add_options_page(
        __('Strudel Schema', 'strudel-schema'),
        __('Strudel Schema', 'strudel-schema'),
        'manage_options',
        'strudel-schema',
        'strudel_schema_settings_page'
    );
});

/**
 * Register settings
 */
add_action('admin_init', function () {
    register_setting('strudel_schema_settings', 'strudel_schema_organization', [
        'type' => 'array',
        'sanitize_callback' => 'strudel_schema_sanitize_organization',
        'default' => [],
    ]);

    register_setting('strudel_schema_settings', 'strudel_schema_website', [
        'type' => 'array',
        'sanitize_callback' => 'strudel_schema_sanitize_website',
        'default' => [],
    ]);

    register_setting('strudel_schema_settings', 'strudel_schema_defaults', [
        'type' => 'array',
        'sanitize_callback' => 'strudel_schema_sanitize_defaults',
        'default' => [],
    ]);
});

/**
 * Sanitize organization settings
 */
function strudel_schema_sanitize_organization($input) {
    if (!is_array($input)) return [];

    return [
        'name'        => sanitize_text_field($input['name'] ?? ''),
        'url'         => esc_url_raw($input['url'] ?? ''),
        'logo'        => esc_url_raw($input['logo'] ?? ''),
        'description' => sanitize_textarea_field($input['description'] ?? ''),
        'email'       => sanitize_email($input['email'] ?? ''),
        'phone'       => sanitize_text_field($input['phone'] ?? ''),
        'address'     => sanitize_textarea_field($input['address'] ?? ''),
        'social'      => array_map('esc_url_raw', array_filter((array)($input['social'] ?? []))),
    ];
}

/**
 * Sanitize website settings
 */
function strudel_schema_sanitize_website($input) {
    if (!is_array($input)) return [];

    return [
        'name'        => sanitize_text_field($input['name'] ?? ''),
        'description' => sanitize_textarea_field($input['description'] ?? ''),
        'language'    => sanitize_text_field($input['language'] ?? 'he-IL'),
    ];
}

/**
 * Sanitize defaults
 */
function strudel_schema_sanitize_defaults($input) {
    if (!is_array($input)) return [];

    return [
        'output_global_schema' => !empty($input['output_global_schema']),
        'default_mode'         => in_array($input['default_mode'] ?? '', ['inherit', 'extend', 'override'])
                                    ? $input['default_mode'] : 'inherit',
    ];
}

/**
 * Get organization data
 */
function strudel_schema_get_organization() {
    $org = get_option('strudel_schema_organization', []);
    $defaults = [
        'name'        => get_bloginfo('name'),
        'url'         => home_url('/'),
        'logo'        => '',
        'description' => get_bloginfo('description'),
        'email'       => get_option('admin_email'),
        'phone'       => '',
        'address'     => '',
        'social'      => [],
    ];
    return wp_parse_args($org, $defaults);
}

/**
 * Get website data
 */
function strudel_schema_get_website() {
    $site = get_option('strudel_schema_website', []);
    $defaults = [
        'name'        => get_bloginfo('name'),
        'description' => get_bloginfo('description'),
        'language'    => get_bloginfo('language') ?: 'he-IL',
    ];
    return wp_parse_args($site, $defaults);
}

/**
 * Get default settings
 */
function strudel_schema_get_defaults() {
    $defaults = get_option('strudel_schema_defaults', []);
    return wp_parse_args($defaults, [
        'output_global_schema' => true,
        'default_mode'         => 'inherit',
    ]);
}

/**
 * Get organization @id
 */
function strudel_schema_get_organization_id() {
    $org = strudel_schema_get_organization();
    return rtrim($org['url'], '/') . '/#organization';
}

/**
 * Get website @id
 */
function strudel_schema_get_website_id() {
    return rtrim(home_url('/'), '/') . '/#website';
}

/**
 * Render settings page
 */
function strudel_schema_settings_page() {
    $org = strudel_schema_get_organization();
    $site = strudel_schema_get_website();
    $defaults = strudel_schema_get_defaults();
    ?>
    <div class="wrap">
        <h1><?php _e('Strudel Schema Settings', 'strudel-schema'); ?></h1>

        <form method="post" action="options.php">
            <?php settings_fields('strudel_schema_settings'); ?>

            <h2><?php _e('Organization', 'strudel-schema'); ?></h2>
            <p class="description">
                <?php _e('Global organization data used across all pages.', 'strudel-schema'); ?>
                <br>
                <code>@id: <?php echo esc_html(strudel_schema_get_organization_id()); ?></code>
            </p>

            <table class="form-table">
                <tr>
                    <th><label for="org_name"><?php _e('Organization Name', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="text" id="org_name" name="strudel_schema_organization[name]"
                               value="<?php echo esc_attr($org['name']); ?>" class="regular-text">
                    </td>
                </tr>
                <tr>
                    <th><label for="org_url"><?php _e('Website URL', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="url" id="org_url" name="strudel_schema_organization[url]"
                               value="<?php echo esc_attr($org['url']); ?>" class="regular-text">
                    </td>
                </tr>
                <tr>
                    <th><label for="org_logo"><?php _e('Logo URL', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="url" id="org_logo" name="strudel_schema_organization[logo]"
                               value="<?php echo esc_attr($org['logo']); ?>" class="regular-text">
                        <p class="description"><?php _e('Recommended: 112x112px minimum, PNG or JPG', 'strudel-schema'); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="org_description"><?php _e('Description', 'strudel-schema'); ?></label></th>
                    <td>
                        <textarea id="org_description" name="strudel_schema_organization[description]"
                                  rows="3" class="large-text"><?php echo esc_textarea($org['description']); ?></textarea>
                    </td>
                </tr>
                <tr>
                    <th><label for="org_email"><?php _e('Email', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="email" id="org_email" name="strudel_schema_organization[email]"
                               value="<?php echo esc_attr($org['email']); ?>" class="regular-text">
                    </td>
                </tr>
                <tr>
                    <th><label for="org_phone"><?php _e('Phone', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="tel" id="org_phone" name="strudel_schema_organization[phone]"
                               value="<?php echo esc_attr($org['phone']); ?>" class="regular-text">
                        <p class="description"><?php _e('Format: +972-XX-XXXXXXX', 'strudel-schema'); ?></p>
                    </td>
                </tr>
                <tr>
                    <th><label for="org_address"><?php _e('Address', 'strudel-schema'); ?></label></th>
                    <td>
                        <textarea id="org_address" name="strudel_schema_organization[address]"
                                  rows="2" class="large-text"><?php echo esc_textarea($org['address']); ?></textarea>
                    </td>
                </tr>
                <tr>
                    <th><label><?php _e('Social Profiles', 'strudel-schema'); ?></label></th>
                    <td>
                        <?php
                        $socials = !empty($org['social']) ? $org['social'] : [''];
                        foreach ($socials as $i => $social):
                        ?>
                        <input type="url" name="strudel_schema_organization[social][]"
                               value="<?php echo esc_attr($social); ?>" class="regular-text"
                               placeholder="https://facebook.com/..." style="margin-bottom: 5px; display: block;">
                        <?php endforeach; ?>
                        <input type="url" name="strudel_schema_organization[social][]"
                               value="" class="regular-text" placeholder="<?php _e('Add another...', 'strudel-schema'); ?>">
                        <p class="description"><?php _e('Facebook, Instagram, LinkedIn, etc.', 'strudel-schema'); ?></p>
                    </td>
                </tr>
            </table>

            <hr>

            <h2><?php _e('Website', 'strudel-schema'); ?></h2>
            <p class="description">
                <code>@id: <?php echo esc_html(strudel_schema_get_website_id()); ?></code>
            </p>

            <table class="form-table">
                <tr>
                    <th><label for="site_name"><?php _e('Site Name', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="text" id="site_name" name="strudel_schema_website[name]"
                               value="<?php echo esc_attr($site['name']); ?>" class="regular-text">
                    </td>
                </tr>
                <tr>
                    <th><label for="site_description"><?php _e('Site Description', 'strudel-schema'); ?></label></th>
                    <td>
                        <textarea id="site_description" name="strudel_schema_website[description]"
                                  rows="2" class="large-text"><?php echo esc_textarea($site['description']); ?></textarea>
                    </td>
                </tr>
                <tr>
                    <th><label for="site_language"><?php _e('Language', 'strudel-schema'); ?></label></th>
                    <td>
                        <input type="text" id="site_language" name="strudel_schema_website[language]"
                               value="<?php echo esc_attr($site['language']); ?>" class="small-text">
                        <p class="description"><?php _e('e.g., he-IL, en-US', 'strudel-schema'); ?></p>
                    </td>
                </tr>
            </table>

            <hr>

            <h2><?php _e('Default Settings', 'strudel-schema'); ?></h2>

            <table class="form-table">
                <tr>
                    <th><?php _e('Output Global Schema', 'strudel-schema'); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="strudel_schema_defaults[output_global_schema]"
                                   value="1" <?php checked($defaults['output_global_schema']); ?>>
                            <?php _e('Output Organization and WebSite schema on all pages', 'strudel-schema'); ?>
                        </label>
                        <p class="description">
                            <?php _e('When enabled, global schema is added to every page (unless in Inherit mode).', 'strudel-schema'); ?>
                        </p>
                    </td>
                </tr>
                <tr>
                    <th><label for="default_mode"><?php _e('Default Mode', 'strudel-schema'); ?></label></th>
                    <td>
                        <select id="default_mode" name="strudel_schema_defaults[default_mode]">
                            <option value="inherit" <?php selected($defaults['default_mode'], 'inherit'); ?>>
                                <?php _e('Inherit', 'strudel-schema'); ?>
                            </option>
                            <option value="extend" <?php selected($defaults['default_mode'], 'extend'); ?>>
                                <?php _e('Extend', 'strudel-schema'); ?>
                            </option>
                            <option value="override" <?php selected($defaults['default_mode'], 'override'); ?>>
                                <?php _e('Override', 'strudel-schema'); ?>
                            </option>
                        </select>
                        <p class="description">
                            <?php _e('Default mode for new pages/posts.', 'strudel-schema'); ?>
                        </p>
                    </td>
                </tr>
            </table>

            <hr>

            <h2><?php _e('Schema Preview', 'strudel-schema'); ?></h2>
            <p class="description"><?php _e('Global schema that will be output on pages:', 'strudel-schema'); ?></p>
            <pre style="background: #f0f0f1; padding: 15px; overflow-x: auto; max-height: 400px;"><?php
                echo esc_html(wp_json_encode(strudel_schema_build_global_schema(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            ?></pre>

            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/**
 * Build global schema (Organization + WebSite)
 */
function strudel_schema_build_global_schema() {
    $org = strudel_schema_get_organization();
    $site = strudel_schema_get_website();

    $graph = [
        '@context' => 'https://schema.org',
        '@graph' => [],
    ];

    // Organization
    $organization = [
        '@type' => 'Organization',
        '@id' => strudel_schema_get_organization_id(),
        'name' => $org['name'],
        'url' => $org['url'],
    ];

    if (!empty($org['logo'])) {
        $organization['logo'] = [
            '@type' => 'ImageObject',
            '@id' => rtrim($org['url'], '/') . '/#logo',
            'url' => $org['logo'],
            'contentUrl' => $org['logo'],
        ];
        $organization['image'] = ['@id' => rtrim($org['url'], '/') . '/#logo'];
    }

    if (!empty($org['description'])) {
        $organization['description'] = $org['description'];
    }

    if (!empty($org['email'])) {
        $organization['email'] = $org['email'];
    }

    if (!empty($org['phone'])) {
        $organization['telephone'] = $org['phone'];
    }

    if (!empty($org['address'])) {
        $organization['address'] = $org['address'];
    }

    if (!empty($org['social'])) {
        $organization['sameAs'] = array_values(array_filter($org['social']));
    }

    $graph['@graph'][] = strudel_schema_cleanup_nulls($organization);

    // WebSite
    $website = [
        '@type' => 'WebSite',
        '@id' => strudel_schema_get_website_id(),
        'url' => home_url('/'),
        'name' => $site['name'],
        'description' => $site['description'],
        'inLanguage' => $site['language'],
        'publisher' => ['@id' => strudel_schema_get_organization_id()],
    ];

    // Add search action if site has search
    $website['potentialAction'] = [
        '@type' => 'SearchAction',
        'target' => [
            '@type' => 'EntryPoint',
            'urlTemplate' => home_url('/?s={search_term_string}'),
        ],
        'query-input' => 'required name=search_term_string',
    ];

    $graph['@graph'][] = strudel_schema_cleanup_nulls($website);

    return $graph;
}

/**
 * Output global schema on frontend
 */
add_action('wp_head', function () {
    $defaults = strudel_schema_get_defaults();

    // Only output if enabled
    if (empty($defaults['output_global_schema'])) {
        return;
    }

    // Don't output on pages in inherit mode (they don't want our schema)
    if (is_singular()) {
        $post_id = get_queried_object_id();
        if ($post_id) {
            $cfg = strudel_schema_get_config($post_id);
            if ($cfg['mode'] === 'inherit') {
                return;
            }
        }
    }

    $schema = strudel_schema_build_global_schema();

    echo "\n<!-- Strudel Schema Global -->\n";
    echo '<script type="application/ld+json">' . "\n";
    echo wp_json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    echo "\n</script>\n";
}, 5); // Priority 5 = before page-specific schema (priority 20)

/**
 * Add settings link to plugins page
 */
add_filter('plugin_action_links_' . plugin_basename(STRUDEL_SCHEMA_PATH . 'strudel-schema.php'), function ($links) {
    $settings_link = '<a href="' . admin_url('options-general.php?page=strudel-schema') . '">' . __('Settings', 'strudel-schema') . '</a>';
    array_unshift($links, $settings_link);
    return $links;
});
