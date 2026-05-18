<?php
/**
 * Plugin Name: Agency OS Control Plane
 * Description: Atomic snapshot / publish-draft-over / replace-text endpoints for safe MCP-driven WordPress edits.
 * Version: 1.0.0
 *
 * INSTALLATION:
 * Upload to: wp-content/mu-plugins/agency-os-control-plane.php
 * (Can be installed via the /agency-os/v1/create-file endpoint exposed by agency-os-file-api.php)
 *
 * Endpoints (all require manage_options):
 *   POST   /agency-os/v1/snapshot/create      { post_id, label? }
 *   GET    /agency-os/v1/snapshot/list        ?post_id=N
 *   POST   /agency-os/v1/snapshot/restore     { post_id, snapshot_id }
 *   POST   /agency-os/v1/publish-draft-over   { draft_id, target_id }
 *   POST   /agency-os/v1/replace-text         { post_id, find, replace, regex?, case_insensitive?, dry_run? }
 *
 * Snapshots are stored in postmeta `_strudel_snapshots` as a JSON array,
 * auto-pruned to AGENCY_OS_MAX_SNAPSHOTS (newest first).
 * Every destructive op auto-creates a snapshot before writing.
 */

if (!defined('ABSPATH')) exit;

const AGENCY_OS_SNAPSHOT_META  = '_strudel_snapshots';
const AGENCY_OS_MAX_SNAPSHOTS  = 5;

/* ---------------------------------------------------------------- */
/*  Route registration                                              */
/* ---------------------------------------------------------------- */

add_action('rest_api_init', function () {
    $auth = function () { return current_user_can('manage_options'); };

    register_rest_route('agency-os/v1', '/snapshot/create', [
        'methods'             => 'POST',
        'callback'            => 'agency_os_cp_snapshot_create',
        'permission_callback' => $auth,
    ]);
    register_rest_route('agency-os/v1', '/snapshot/list', [
        'methods'             => 'GET',
        'callback'            => 'agency_os_cp_snapshot_list',
        'permission_callback' => $auth,
    ]);
    register_rest_route('agency-os/v1', '/snapshot/restore', [
        'methods'             => 'POST',
        'callback'            => 'agency_os_cp_snapshot_restore',
        'permission_callback' => $auth,
    ]);
    register_rest_route('agency-os/v1', '/publish-draft-over', [
        'methods'             => 'POST',
        'callback'            => 'agency_os_cp_publish_draft_over',
        'permission_callback' => $auth,
    ]);
    register_rest_route('agency-os/v1', '/replace-text', [
        'methods'             => 'POST',
        'callback'            => 'agency_os_cp_replace_text',
        'permission_callback' => $auth,
    ]);
});

/* ---------------------------------------------------------------- */
/*  Snapshot helpers                                                */
/* ---------------------------------------------------------------- */

function agency_os_cp_load_snapshots(int $post_id): array {
    $raw = get_post_meta($post_id, AGENCY_OS_SNAPSHOT_META, true);
    if (empty($raw)) return [];
    if (is_string($raw)) {
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
    return is_array($raw) ? $raw : [];
}

function agency_os_cp_save_snapshots(int $post_id, array $snapshots): void {
    update_post_meta(
        $post_id,
        AGENCY_OS_SNAPSHOT_META,
        wp_slash(wp_json_encode($snapshots, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))
    );
}

function agency_os_cp_make_snapshot(int $post_id, string $label = '') {
    $post = get_post($post_id);
    if (!$post) return new WP_Error('post_not_found', "post {$post_id} not found", ['status' => 404]);

    $elementor_data = get_post_meta($post_id, '_elementor_data', true);
    $snapshot = [
        'id'             => 'snap_' . time() . '_' . wp_generate_password(4, false, false),
        'ts'             => time(),
        'label'          => $label,
        'post_status'    => $post->post_status,
        'post_title'     => $post->post_title,
        'post_content'   => $post->post_content,
        'elementor_data' => is_string($elementor_data) ? $elementor_data : '',
    ];

    $snapshots   = agency_os_cp_load_snapshots($post_id);
    $snapshots[] = $snapshot;
    usort($snapshots, fn($a, $b) => ($b['ts'] ?? 0) <=> ($a['ts'] ?? 0));
    $snapshots = array_slice($snapshots, 0, AGENCY_OS_MAX_SNAPSHOTS);
    agency_os_cp_save_snapshots($post_id, $snapshots);

    return $snapshot;
}

/* ---------------------------------------------------------------- */
/*  Snapshot endpoints                                              */
/* ---------------------------------------------------------------- */

function agency_os_cp_snapshot_create(WP_REST_Request $r) {
    $post_id = (int) $r->get_param('post_id');
    if (!$post_id) return new WP_Error('missing_post_id', 'post_id required', ['status' => 400]);
    $label = (string) ($r->get_param('label') ?? '');

    $snap = agency_os_cp_make_snapshot($post_id, $label);
    if (is_wp_error($snap)) return $snap;

    $all = agency_os_cp_load_snapshots($post_id);
    return [
        'snapshot_id'     => $snap['id'],
        'ts'              => $snap['ts'],
        'label'           => $snap['label'],
        'elementor_bytes' => strlen($snap['elementor_data']),
        'total_snapshots' => count($all),
        'pruned'          => count($all) >= AGENCY_OS_MAX_SNAPSHOTS,
    ];
}

function agency_os_cp_snapshot_list(WP_REST_Request $r) {
    $post_id = (int) $r->get_param('post_id');
    if (!$post_id) return new WP_Error('missing_post_id', 'post_id required', ['status' => 400]);

    $snapshots = agency_os_cp_load_snapshots($post_id);
    usort($snapshots, fn($a, $b) => ($b['ts'] ?? 0) <=> ($a['ts'] ?? 0));

    return [
        'post_id'   => $post_id,
        'count'     => count($snapshots),
        'max'       => AGENCY_OS_MAX_SNAPSHOTS,
        'snapshots' => array_map(fn($s) => [
            'snapshot_id'     => $s['id']             ?? null,
            'ts'              => $s['ts']             ?? null,
            'date'            => isset($s['ts']) ? gmdate('c', (int) $s['ts']) : null,
            'label'           => $s['label']          ?? '',
            'post_status'     => $s['post_status']    ?? null,
            'elementor_bytes' => strlen($s['elementor_data'] ?? ''),
        ], $snapshots),
    ];
}

function agency_os_cp_snapshot_restore(WP_REST_Request $r) {
    $post_id     = (int)    $r->get_param('post_id');
    $snapshot_id = (string) $r->get_param('snapshot_id');
    if (!$post_id || !$snapshot_id) {
        return new WP_Error('missing_args', 'post_id and snapshot_id required', ['status' => 400]);
    }

    $snapshots = agency_os_cp_load_snapshots($post_id);
    $target = null;
    foreach ($snapshots as $s) {
        if (($s['id'] ?? null) === $snapshot_id) { $target = $s; break; }
    }
    if (!$target) return new WP_Error('snapshot_not_found', "snapshot {$snapshot_id} not found on post {$post_id}", ['status' => 404]);

    // Auto-backup current state before restoring
    $backup = agency_os_cp_make_snapshot($post_id, 'pre-restore:' . $snapshot_id);
    if (is_wp_error($backup)) return $backup;

    $updated = wp_update_post([
        'ID'           => $post_id,
        'post_title'   => wp_slash($target['post_title']   ?? ''),
        'post_content' => wp_slash($target['post_content'] ?? ''),
        'post_status'  => $target['post_status'] ?? 'draft',
    ], true);
    if (is_wp_error($updated)) return $updated;

    $restored_elementor = (string) ($target['elementor_data'] ?? '');
    update_post_meta($post_id, '_elementor_data', wp_slash($restored_elementor));
    delete_post_meta($post_id, '_elementor_css');

    $verify = (string) get_post_meta($post_id, '_elementor_data', true);
    return [
        'restored'        => true,
        'post_id'         => $post_id,
        'snapshot_id'     => $snapshot_id,
        'auto_backup_id'  => $backup['id'] ?? null,
        'verified'        => strlen($verify) === strlen($restored_elementor),
        'elementor_bytes' => strlen($verify),
    ];
}

/* ---------------------------------------------------------------- */
/*  Publish-draft-over                                              */
/* ---------------------------------------------------------------- */

function agency_os_cp_publish_draft_over(WP_REST_Request $r) {
    $draft_id  = (int) $r->get_param('draft_id');
    $target_id = (int) $r->get_param('target_id');
    if (!$draft_id || !$target_id) {
        return new WP_Error('missing_args', 'draft_id and target_id required', ['status' => 400]);
    }
    if ($draft_id === $target_id) {
        return new WP_Error('same_id', 'draft_id and target_id must differ', ['status' => 400]);
    }

    $draft  = get_post($draft_id);
    $target = get_post($target_id);
    if (!$draft)  return new WP_Error('draft_not_found',  "draft post {$draft_id} not found",  ['status' => 404]);
    if (!$target) return new WP_Error('target_not_found', "target post {$target_id} not found", ['status' => 404]);

    // 1. Snapshot the target
    $backup = agency_os_cp_make_snapshot($target_id, "pre-publish-from-{$draft_id}");
    if (is_wp_error($backup)) return $backup;

    // 2. Copy fields from draft → target (keep target's status; do not un-publish)
    $draft_elementor = (string) (get_post_meta($draft_id, '_elementor_data', true) ?: '');
    $updated = wp_update_post([
        'ID'           => $target_id,
        'post_title'   => wp_slash($draft->post_title),
        'post_content' => wp_slash($draft->post_content),
    ], true);
    if (is_wp_error($updated)) return $updated;

    update_post_meta($target_id, '_elementor_data', wp_slash($draft_elementor));
    delete_post_meta($target_id, '_elementor_css');

    // 3. Delete the draft permanently
    $deleted = wp_delete_post($draft_id, true);
    if (!$deleted) {
        return new WP_Error(
            'draft_delete_failed',
            "target was updated but draft {$draft_id} could not be deleted. backup_id={$backup['id']}",
            ['status' => 500]
        );
    }

    $verify = (string) get_post_meta($target_id, '_elementor_data', true);
    return [
        'published'        => true,
        'target_id'        => $target_id,
        'deleted_draft_id' => $draft_id,
        'auto_backup_id'   => $backup['id'] ?? null,
        'verified'         => strlen($verify) === strlen($draft_elementor),
        'elementor_bytes'  => strlen($verify),
    ];
}

/* ---------------------------------------------------------------- */
/*  Replace-text                                                    */
/* ---------------------------------------------------------------- */

/**
 * Elementor widget settings keys that contain user-visible text.
 * Anything not in this list is left alone (style props, urls, etc.).
 */
const AGENCY_OS_CP_TEXT_KEYS = [
    'title', 'editor', 'text', 'description', 'caption', 'html',
    'text_above_form', 'text_below_form',
    'before_text', 'after_text', 'highlighted_text', 'rotating_text',
    'button_text', 'subheading', 'subtitle',
    'tab_title', 'tab_content',
    'placeholder', 'alert_title', 'alert_description',
    'price', 'period', 'currency_symbol',
    'testimonial_content', 'testimonial_name', 'testimonial_job',
];

function agency_os_cp_apply_replace(string $haystack, string $find, string $replace, bool $regex, bool $ci) {
    if ($regex) {
        $flags   = 'u' . ($ci ? 'i' : '');
        $pattern = '/' . str_replace('/', '\\/', $find) . '/' . $flags;
        $count   = 0;
        $result  = @preg_replace($pattern, $replace, $haystack, -1, $count);
        if ($result === null) return [$haystack, 0, 'regex_error'];
        return [$result, $count, null];
    }
    $count = 0;
    $result = $ci
        ? str_ireplace($find, $replace, $haystack, $count)
        : str_replace($find, $replace, $haystack, $count);
    return [$result, $count, null];
}

function agency_os_cp_walk_elementor(array &$elements, string $find, string $replace, bool $regex, bool $ci, array &$counter): void {
    foreach ($elements as &$el) {
        if (isset($el['settings']) && is_array($el['settings'])) {
            $dynamic_keys = isset($el['settings']['__dynamic__']) && is_array($el['settings']['__dynamic__'])
                ? $el['settings']['__dynamic__']
                : [];
            foreach (AGENCY_OS_CP_TEXT_KEYS as $key) {
                if (!isset($el['settings'][$key]) || !is_string($el['settings'][$key])) continue;
                if (isset($dynamic_keys[$key])) continue; // skip dynamic tags
                [$new, $n, $err] = agency_os_cp_apply_replace($el['settings'][$key], $find, $replace, $regex, $ci);
                if ($err === 'regex_error') {
                    $counter['regex_error'] = true;
                    return;
                }
                if ($n > 0) {
                    $el['settings'][$key]     = $new;
                    $counter['replacements'] += $n;
                    $counter['fields'][$key]  = ($counter['fields'][$key] ?? 0) + $n;
                }
            }
        }
        if (isset($el['elements']) && is_array($el['elements'])) {
            agency_os_cp_walk_elementor($el['elements'], $find, $replace, $regex, $ci, $counter);
            if (!empty($counter['regex_error'])) return;
        }
    }
}

function agency_os_cp_replace_text(WP_REST_Request $r) {
    $post_id = (int)    $r->get_param('post_id');
    $find    = (string) $r->get_param('find');
    $replace = (string) ($r->get_param('replace') ?? '');
    $regex   = (bool)   $r->get_param('regex');
    $ci      = (bool)   $r->get_param('case_insensitive');
    $dry     = (bool)   $r->get_param('dry_run');

    if (!$post_id || $find === '') {
        return new WP_Error('missing_args', 'post_id and non-empty find required', ['status' => 400]);
    }
    $post = get_post($post_id);
    if (!$post) return new WP_Error('post_not_found', "post {$post_id} not found", ['status' => 404]);

    $counter = ['replacements' => 0, 'fields' => []];

    // 1. post_content
    [$new_content, $content_hits, $content_err] = agency_os_cp_apply_replace(
        $post->post_content, $find, $replace, $regex, $ci
    );
    if ($content_err === 'regex_error') {
        return new WP_Error('regex_error', 'invalid regex pattern', ['status' => 400]);
    }
    if ($content_hits > 0) {
        $counter['replacements']         += $content_hits;
        $counter['fields']['post_content'] = $content_hits;
    }

    // 2. _elementor_data
    $raw_elementor      = get_post_meta($post_id, '_elementor_data', true);
    $new_elementor      = $raw_elementor;
    $elementor_changed  = false;
    if (is_string($raw_elementor) && $raw_elementor !== '') {
        $tree = json_decode($raw_elementor, true);
        if (is_array($tree)) {
            agency_os_cp_walk_elementor($tree, $find, $replace, $regex, $ci, $counter);
            if (!empty($counter['regex_error'])) {
                return new WP_Error('regex_error', 'invalid regex pattern', ['status' => 400]);
            }
            $new_elementor     = wp_json_encode($tree, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $elementor_changed = $new_elementor !== $raw_elementor;
        }
    }

    if ($dry || $counter['replacements'] === 0) {
        return [
            'dry_run'          => $dry,
            'post_id'          => $post_id,
            'matches'          => $counter['replacements'],
            'fields'           => (object) $counter['fields'],
            'applied'          => false,
            'would_change'     => [
                'post_content'   => $content_hits > 0,
                'elementor_data' => $elementor_changed,
            ],
        ];
    }

    // 3. Snapshot before writing
    $backup = agency_os_cp_make_snapshot($post_id, "pre-replace");
    if (is_wp_error($backup)) return $backup;

    if ($content_hits > 0) {
        $updated = wp_update_post(['ID' => $post_id, 'post_content' => wp_slash($new_content)], true);
        if (is_wp_error($updated)) return $updated;
    }
    if ($elementor_changed) {
        update_post_meta($post_id, '_elementor_data', wp_slash($new_elementor));
        delete_post_meta($post_id, '_elementor_css');
    }

    return [
        'applied'           => true,
        'post_id'           => $post_id,
        'matches'           => $counter['replacements'],
        'fields'            => (object) $counter['fields'],
        'auto_backup_id'    => $backup['id'] ?? null,
        'content_changed'   => $content_hits > 0,
        'elementor_changed' => $elementor_changed,
    ];
}
