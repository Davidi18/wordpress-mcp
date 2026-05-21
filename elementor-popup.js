// elementor-popup.js
// Build the meta payload for an Elementor Pro popup template.
//
// A popup is a post in the `elementor_library` post type with:
//   _elementor_template_type   = "popup"
//   _elementor_data            = JSON string — the popup's content (sections/widgets)
//   _elementor_page_settings   = JSON string — triggers / timing / animations
//   _elementor_conditions      = JSON string — display rules ("show on page X")
//
// Elementor Pro's full popup-settings schema is large (~50 knobs). This helper
// exposes a small ergonomic surface — the most common ~10 controls — and maps
// them to the wire format. Anything more exotic should be edited from the
// Elementor admin after creation.

// Map our ergonomic trigger object → Elementor's flat trigger_* settings.
function buildTriggerSettings(triggers = {}) {
  const out = {};
  if (triggers.page_load === true || typeof triggers.page_load_delay === 'number') {
    out.triggers_on_page_load = 'yes';
    if (typeof triggers.page_load_delay === 'number') {
      out.triggers_on_page_load_delay = triggers.page_load_delay;
    }
  }
  if (triggers.scroll === true || typeof triggers.scroll_percentage === 'number') {
    out.triggers_on_scroll = 'yes';
    out.triggers_on_scroll_direction = triggers.scroll_direction || 'down';
    if (typeof triggers.scroll_percentage === 'number') {
      out.triggers_on_scroll_range = { unit: '%', size: triggers.scroll_percentage };
    }
  }
  if (triggers.click_selector) {
    out.triggers_on_click = 'yes';
    out.triggers_on_click_selector = triggers.click_selector;
  }
  if (triggers.exit_intent === true) {
    out.triggers_on_page_exit_intent = 'yes';
  }
  if (typeof triggers.inactivity_seconds === 'number') {
    out.triggers_user_inactivity = 'yes';
    out.triggers_user_inactivity_time = triggers.inactivity_seconds;
  }
  return out;
}

// Map ergonomic timing → flat timing_* settings.
function buildTimingSettings(timing = {}) {
  const out = {};
  if (typeof timing.max_shows === 'number') {
    out.timing_show_up_to = 'yes';
    out.timing_show_up_to_times = timing.max_shows;
  }
  if (Array.isArray(timing.device_types) && timing.device_types.length > 0) {
    out.timing_show_on_devices = 'yes';
    out.timing_devices = timing.device_types;
  }
  if (timing.logged_in === 'logged_in_only') {
    out.timing_logged_in = 'yes';
    out.timing_logged_in_users = 'all';
  } else if (timing.logged_in === 'logged_out_only') {
    out.timing_logged_in = 'yes';
    out.timing_logged_in_users = 'guests';
  }
  if (typeof timing.session_max_shows === 'number') {
    out.timing_sessions = 'yes';
    out.timing_sessions_times = timing.session_max_shows;
  }
  return out;
}

// Map ergonomic conditions → Elementor's _elementor_conditions array.
// Rules:
//   include_everywhere:true  → [{ type:"include", name:"general" }]
//   include_page_ids:[1,2]   → [..., { type:"include", name:"singular", sub_name:"page", sub_id:"1" }, ...]
//   exclude_page_ids:[3]     → [..., { type:"exclude", ... }]
// If conditions is an array, it's passed through verbatim (escape hatch).
export function buildConditions(conditions) {
  if (Array.isArray(conditions)) return conditions;
  const rules = [];
  const c = conditions || {};
  if (c.include_everywhere) {
    rules.push({ type: 'include', name: 'general' });
  }
  for (const id of c.include_page_ids || []) {
    rules.push({ type: 'include', name: 'singular', sub_name: 'page', sub_id: String(id) });
  }
  for (const id of c.exclude_page_ids || []) {
    rules.push({ type: 'exclude', name: 'singular', sub_name: 'page', sub_id: String(id) });
  }
  for (const id of c.include_post_ids || []) {
    rules.push({ type: 'include', name: 'singular', sub_name: 'post', sub_id: String(id) });
  }
  for (const id of c.exclude_post_ids || []) {
    rules.push({ type: 'exclude', name: 'singular', sub_name: 'post', sub_id: String(id) });
  }
  // Default: if nothing specified, show everywhere. Without any include rule
  // the popup never activates.
  if (rules.length === 0) {
    rules.push({ type: 'include', name: 'general' });
  }
  return rules;
}

// Combine the user-facing inputs into the full settings object that goes into
// _elementor_page_settings. Animation/advanced knobs are passed through
// directly if specified.
export function buildPopupSettings({ triggers, timing, advanced } = {}) {
  return {
    ...buildTriggerSettings(triggers),
    ...buildTimingSettings(timing),
    ...(advanced && typeof advanced === 'object' ? advanced : {})
  };
}
