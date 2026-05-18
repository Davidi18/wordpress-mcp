// elementor-guidelines.js
// Derive a site's Elementor design guidelines so agents can build on-style.
//
// Two signals are combined:
//   1. The active Elementor Kit (Site Settings → Global Colors/Fonts).
//      This is the explicit, designer-authored palette/typography.
//   2. Observed patterns from recent pages — useful when the kit is
//      empty/default, or to surface what's actually being used.

const KIT_SETTINGS_KEYS = [
  'system_colors',
  'custom_colors',
  'system_typography',
  'custom_typography',
  'container_width',
  'viewport_md',
  'viewport_lg',
  'space_between_widgets',
  'default_generic_fonts',
  'active_breakpoints'
];

// Kit's _elementor_page_settings can come back as object or JSON string.
function parseKitSettings(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

function pickKitTokens(settings) {
  if (!settings) return null;
  const out = {};
  for (const key of KIT_SETTINGS_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }

  const normalizeColors = (arr) => Array.isArray(arr)
    ? arr.map(c => ({ id: c._id, title: c.title, color: c.color })).filter(c => c.color)
    : [];

  const normalizeTypography = (arr) => Array.isArray(arr)
    ? arr.map(t => ({
        id: t._id,
        title: t.title,
        font_family: t.typography_font_family || null,
        font_weight: t.typography_font_weight || null,
        font_size: t.typography_font_size || null,
        line_height: t.typography_line_height || null
      })).filter(t => t.font_family || t.font_size)
    : [];

  return {
    colors: {
      system: normalizeColors(out.system_colors),
      custom: normalizeColors(out.custom_colors)
    },
    typography: {
      system: normalizeTypography(out.system_typography),
      custom: normalizeTypography(out.custom_typography)
    },
    layout: {
      container_width: out.container_width || null,
      viewport_md: out.viewport_md ?? null,
      viewport_lg: out.viewport_lg ?? null,
      space_between_widgets: out.space_between_widgets || null
    },
    fonts_fallback: out.default_generic_fonts || null,
    breakpoints: out.active_breakpoints || null
  };
}

async function fetchActiveKit(wpReq) {
  const templates = await wpReq('/wp/v2/elementor_library?per_page=20&context=edit&status=publish');
  if (!Array.isArray(templates)) return null;
  const kits = templates.filter(t => t.meta?._elementor_template_type === 'kit');
  if (kits.length === 0) return null;
  // Prefer the most recently modified kit (active kit is usually that one).
  kits.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  const kit = kits[0];
  const settings = parseKitSettings(kit.meta?._elementor_page_settings);
  const tokens = pickKitTokens(settings);
  return {
    kit_id: kit.id,
    kit_title: kit.title?.rendered || '',
    ...tokens
  };
}

// Walk an Elementor element tree and visit every widget's settings.
function walkSettings(elements, visit) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    if (el?.elType === 'widget' && el.settings) {
      visit(el.settings, el.widgetType);
    }
    if (Array.isArray(el?.elements)) walkSettings(el.elements, visit);
  }
}

const COLOR_KEYS = new Set([
  'color', 'title_color', 'description_color', 'text_color',
  'background_color', '_background_color',
  'primary_color', 'secondary_color', 'accent_color',
  'button_text_color', 'background_overlay_color', 'border_color'
]);

function bumpFreq(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topN(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

async function analyzePages(wpReq, sampleSize) {
  const limit = Math.max(1, Math.min(sampleSize || 10, 50));
  const pages = await wpReq(`/wp/v2/pages?per_page=${limit}&context=edit&status=publish&_fields=id,meta`);
  if (!Array.isArray(pages)) return null;

  const fonts = new Map();
  const colors = new Map();
  const weights = new Map();
  let widgetsScanned = 0;
  let pagesScanned = 0;

  for (const page of pages) {
    const raw = page.meta?._elementor_data;
    if (!raw) continue;
    let tree;
    try {
      tree = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    if (!Array.isArray(tree)) continue;
    pagesScanned++;
    walkSettings(tree, (settings) => {
      widgetsScanned++;
      if (settings.typography_font_family) bumpFreq(fonts, settings.typography_font_family);
      if (settings.typography_font_weight) bumpFreq(weights, String(settings.typography_font_weight));
      for (const key of Object.keys(settings)) {
        if (COLOR_KEYS.has(key) && typeof settings[key] === 'string' && settings[key].startsWith('#')) {
          bumpFreq(colors, settings[key].toLowerCase());
        }
      }
    });
  }

  return {
    pages_scanned: pagesScanned,
    widgets_scanned: widgetsScanned,
    common_fonts: topN(fonts, 5),
    common_weights: topN(weights, 5),
    common_colors: topN(colors, 8)
  };
}

export async function buildGuidelines(wpReq, { include_observed = true, sample_size = 10 } = {}) {
  const [kit, observed] = await Promise.all([
    fetchActiveKit(wpReq).catch(e => ({ error: e.message })),
    include_observed ? analyzePages(wpReq, sample_size).catch(e => ({ error: e.message })) : Promise.resolve(null)
  ]);

  const hasKit = kit && !kit.error && (
    kit.colors?.system?.length || kit.colors?.custom?.length ||
    kit.typography?.system?.length || kit.typography?.custom?.length
  );
  const hasObserved = observed && !observed.error && observed.widgets_scanned > 0;

  let source;
  if (hasKit && hasObserved) source = 'mixed';
  else if (hasKit) source = 'elementor_kit';
  else if (hasObserved) source = 'observed_patterns';
  else source = 'none';

  return {
    source,
    kit: kit && !kit.error ? kit : null,
    kit_error: kit?.error || null,
    observed: observed && !observed.error ? observed : null,
    observed_error: observed?.error || null,
    usage_hint: hasKit
      ? "Prefer referencing globals: set widget settings.__globals__ entries like '__globals__.color = \"globals/colors?id=<system_color_id>\"' and '__globals__.typography_typography = \"globals/typography?id=<system_typography_id>\"' so widgets inherit kit styling instead of hardcoded values."
      : "No Elementor Kit configured. Use the observed common_fonts/common_colors as a style reference, and prefer the most-used values for new widgets to stay consistent."
  };
}
