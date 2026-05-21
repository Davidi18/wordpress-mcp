// elementor-kit.js
// Read + write the active Elementor Kit (Site Settings → Global Colors / Fonts /
// Layout). The Kit is a post in the `elementor_library` post type with
// meta._elementor_template_type === 'kit'; its tokens live in
// meta._elementor_page_settings (stored as a JSON string).
//
// Updating the Kit cascades to every widget that references a global token
// (the `__globals__.color = "globals/colors?id=primary"` pattern). Widgets
// with hard-coded hex values do NOT pick up Kit changes — that's an
// Elementor limitation, not a bug in this code.

import crypto from 'crypto';

const KIT_META_KEY = '_elementor_page_settings';
const KIT_TEMPLATE_TYPE = 'kit';

const KNOWN_LAYOUT_KEYS = new Set([
  'container_width',
  'space_between_widgets',
  'viewport_md',
  'viewport_lg',
  'viewport_mobile',
  'viewport_tablet'
]);

// Read & decode the Kit's settings blob (JSON-string-encoded object).
function parseKitSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

// Find the active Kit. The active kit id is set in the WP option
// `elementor_active_kit`, exposed via /wp/v2/settings on most sites. If that
// fails, fall back to the most-recently-modified kit-type template.
export async function fetchActiveKit(wpReq, { kit_id } = {}) {
  if (kit_id) {
    const kit = await wpReq(`/wp/v2/elementor_library/${kit_id}?context=edit`);
    if (kit?.id) return kit;
    throw new Error(`Kit ${kit_id} not found`);
  }

  // Try the explicit pointer first.
  let activeId = null;
  try {
    const settings = await wpReq('/wp/v2/settings');
    if (settings && typeof settings.elementor_active_kit === 'number') {
      activeId = settings.elementor_active_kit;
    }
  } catch { /* settings endpoint may be locked down — fall through */ }

  if (activeId) {
    try {
      const kit = await wpReq(`/wp/v2/elementor_library/${activeId}?context=edit`);
      if (kit?.id) return kit;
    } catch { /* fall through to scan */ }
  }

  // Fallback: scan elementor_library for kit-type posts.
  const templates = await wpReq('/wp/v2/elementor_library?per_page=20&context=edit&status=publish');
  if (!Array.isArray(templates)) {
    throw new Error('No Elementor templates accessible via REST.');
  }
  const kits = templates.filter(t => t.meta?._elementor_template_type === KIT_TEMPLATE_TYPE);
  if (kits.length === 0) {
    throw new Error('No Elementor Kit found. Open Elementor → Site Settings on the WP admin once to initialize one.');
  }
  kits.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return kits[0];
}

// Apply a single color change to an array of { _id, title, color } entries.
// Returns { array, diff } where diff is null on no-op or { id, before, after }.
function upsertColorEntry(arr, id, color, title) {
  const list = Array.isArray(arr) ? [...arr] : [];
  const idx = list.findIndex(e => e._id === id);
  if (idx === -1) {
    const created = { _id: id, title: title || id, color };
    list.push(created);
    return { array: list, diff: { id, before: null, after: color, created: true } };
  }
  const before = list[idx].color;
  if (before === color) return { array: list, diff: null };
  list[idx] = { ...list[idx], color };
  if (title) list[idx].title = title;
  return { array: list, diff: { id, before, after: color, created: false } };
}

// Same for typography entries. `changes` is an object of typography_* keys.
function upsertTypographyEntry(arr, id, changes, title) {
  const list = Array.isArray(arr) ? [...arr] : [];
  const idx = list.findIndex(e => e._id === id);
  const patch = {};
  if (changes.font_family !== undefined) patch.typography_font_family = changes.font_family;
  if (changes.font_weight !== undefined) patch.typography_font_weight = String(changes.font_weight);
  if (changes.font_size !== undefined) patch.typography_font_size = changes.font_size;
  if (changes.line_height !== undefined) patch.typography_line_height = changes.line_height;
  if (changes.letter_spacing !== undefined) patch.typography_letter_spacing = changes.letter_spacing;
  if (changes.font_style !== undefined) patch.typography_font_style = changes.font_style;
  if (changes.text_transform !== undefined) patch.typography_text_transform = changes.text_transform;
  if (changes.text_decoration !== undefined) patch.typography_text_decoration = changes.text_decoration;
  // Enable flag (silently ignored without this).
  patch.typography_typography = 'custom';

  if (idx === -1) {
    const created = { _id: id, title: title || id, ...patch };
    list.push(created);
    return {
      array: list,
      diff: { id, before: null, after: changes, created: true }
    };
  }
  const before = {};
  for (const k of Object.keys(patch)) {
    if (k === 'typography_typography') continue;
    before[k] = list[idx][k] ?? null;
  }
  list[idx] = { ...list[idx], ...patch };
  if (title) list[idx].title = title;
  return {
    array: list,
    diff: { id, before, after: changes, created: false }
  };
}

// Compute the new kit settings + a structured diff. Does NOT mutate input.
export function applyKitChanges(currentSettings, changes) {
  const next = { ...currentSettings };
  const diff = {
    system_colors: [],
    custom_colors: [],
    system_typography: [],
    custom_typography: [],
    layout: []
  };

  // System colors: keys are stable slug ids (primary/secondary/text/accent).
  if (changes.system_colors && typeof changes.system_colors === 'object') {
    let arr = next.system_colors;
    for (const [id, color] of Object.entries(changes.system_colors)) {
      const { array, diff: d } = upsertColorEntry(arr, id, color);
      arr = array;
      if (d) diff.system_colors.push(d);
    }
    next.system_colors = arr;
  }

  // Custom colors: keys may be _ids (existing) or new names. If value is
  // a string we treat it as { color: <value> }, else expect { color, title }.
  if (changes.custom_colors && typeof changes.custom_colors === 'object') {
    let arr = next.custom_colors;
    for (const [key, value] of Object.entries(changes.custom_colors)) {
      const color = typeof value === 'string' ? value : value?.color;
      const title = typeof value === 'object' ? value.title : undefined;
      if (!color) continue;
      // Resolve id: if `key` matches an existing _id use it, else use slug-of-key as new id.
      const list = Array.isArray(arr) ? arr : [];
      const existing = list.find(e => e._id === key || e.title === key);
      const id = existing?._id || key.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { array, diff: d } = upsertColorEntry(arr, id, color, title || key);
      arr = array;
      if (d) diff.custom_colors.push(d);
    }
    next.custom_colors = arr;
  }

  // System typography.
  if (changes.system_typography && typeof changes.system_typography === 'object') {
    let arr = next.system_typography;
    for (const [id, t] of Object.entries(changes.system_typography)) {
      const { array, diff: d } = upsertTypographyEntry(arr, id, t || {});
      arr = array;
      if (d) diff.system_typography.push(d);
    }
    next.system_typography = arr;
  }

  // Custom typography.
  if (changes.custom_typography && typeof changes.custom_typography === 'object') {
    let arr = next.custom_typography;
    for (const [key, t] of Object.entries(changes.custom_typography)) {
      const list = Array.isArray(arr) ? arr : [];
      const existing = list.find(e => e._id === key || e.title === key);
      const id = existing?._id || key.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const { array, diff: d } = upsertTypographyEntry(arr, id, t || {}, t?.title || key);
      arr = array;
      if (d) diff.custom_typography.push(d);
    }
    next.custom_typography = arr;
  }

  // Layout & spacing knobs (top-level on settings, not inside arrays).
  if (changes.layout && typeof changes.layout === 'object') {
    for (const [k, v] of Object.entries(changes.layout)) {
      if (!KNOWN_LAYOUT_KEYS.has(k)) continue;
      const before = next[k] ?? null;
      next[k] = v;
      // Cheap deep-eq via JSON; fine for these small shapes.
      if (JSON.stringify(before) !== JSON.stringify(v)) {
        diff.layout.push({ key: k, before, after: v });
      }
    }
  }

  return { next, diff };
}

// Total count of items in the diff — used to short-circuit no-op writes.
export function diffSize(diff) {
  return diff.system_colors.length
    + diff.custom_colors.length
    + diff.system_typography.length
    + diff.custom_typography.length
    + diff.layout.length;
}

// Write new settings back to the Kit post.
//   meta._elementor_page_settings is stored as a JSON string by Elementor.
// Returns the verify result (re-read settings).
export async function writeKitSettings(wpReq, kitId, newSettings) {
  const serialized = JSON.stringify(newSettings);
  await wpReq(`/wp/v2/elementor_library/${kitId}`, {
    method: 'POST',
    body: { meta: { [KIT_META_KEY]: serialized } }
  });
  const verify = await wpReq(`/wp/v2/elementor_library/${kitId}?context=edit&_fields=id,meta`);
  const verifyRaw = verify?.meta?.[KIT_META_KEY];
  const verified = typeof verifyRaw === 'string'
    ? verifyRaw.length === serialized.length
    : false;
  return { verified, written_bytes: serialized.length, read_back_bytes: typeof verifyRaw === 'string' ? verifyRaw.length : 0 };
}

export { parseKitSettings, KIT_META_KEY };
