// elementor-helpers.js
// Elementor plumbing shared by the elementor tool handlers: capability probes
// (atomic status, Strudel module), CSS regeneration, routed _elementor_data
// writes and restore-able page state.
import { ELEMENTOR_META_KEYS, SEO_META_KEYS } from './wp-meta-keys.js';


// Short-lived cache of the Elementor atomic-support probe, keyed by client. The
// probe route calls Elementor's element registry, which is heavy on sites with
// many addon packs, so we avoid re-running it on every capabilities/add_atomic
// call. Positive results are cached for a minute; negatives only briefly, so a
// freshly-bootstrapped or just-enabled atomic experiment is picked up quickly.
export const ATOMIC_STATUS_TTL_MS = 60000;

export const ATOMIC_STATUS_NEG_TTL_MS = 5000;

export const atomicStatusCache = new Map();


// Fetch atomic-support status with a bounded timeout and no aggressive retry, so
// a missing or slow probe route degrades in ~8s instead of blocking the tool for
// the full 90s (30s × 3 GET retries). Returns the status object, or null when
// the route is absent / doesn't answer in time. Pass force:true to bypass cache.
export async function probeAtomicStatus(wpReq, { clientKey = 'default', force = false } = {}) {
  if (!force) {
    const hit = atomicStatusCache.get(clientKey);
    if (hit) {
      const ttl = hit.status ? ATOMIC_STATUS_TTL_MS : ATOMIC_STATUS_NEG_TTL_MS;
      if (Date.now() - hit.at < ttl) return hit.status;
    }
  }
  let status = null;
  try {
    const res = await wpReq('/agency-os/v1/elementor-atomic-status', {
      timeoutMs: 8000,
      maxRetries: 1
    });
    if (res && typeof res === 'object') status = res;
  } catch { /* route missing, locked down, or slow — treat as unknown */ }
  atomicStatusCache.set(clientKey, { at: Date.now(), status });
  return status;
}


// --- Strudel Elementor module (strudel-elementor/v1) ----------------------
// The Strudel AI Optimizer plugin (v0.6.0+) ships an Elementor module exposing
// server-side Elementor APIs the pure-REST path can't reach: CSS regeneration
// after an _elementor_data write, and the live widget registry. The module
// registers /capabilities UNCONDITIONALLY, so we can tell three states apart:
//   - call throws rest_no_route (404)  -> plugin missing or pre-0.6.0
//   - caps.elementor_active === false  -> plugin present, Elementor inactive
//   - caps.features.<x> === true       -> that rich feature is usable
// Positive probes cached for a minute; negatives briefly, so a freshly deployed
// or just-upgraded plugin is picked up quickly. Mirrors probeAtomicStatus.
export const ELEMENTOR_MODULE_TTL_MS = 60000;

export const ELEMENTOR_MODULE_NEG_TTL_MS = 5000;

export const elementorModuleCache = new Map();

export async function probeElementorModule(wpReq, { clientKey = wpReq?.clientKey || 'default', force = false } = {}) {
  if (!force) {
    const hit = elementorModuleCache.get(clientKey);
    if (hit) {
      const ttl = hit.caps ? ELEMENTOR_MODULE_TTL_MS : ELEMENTOR_MODULE_NEG_TTL_MS;
      if (Date.now() - hit.at < ttl) return hit.caps;
    }
  }
  let caps = null;
  try {
    const res = await wpReq('/strudel-elementor/v1/capabilities', {
      timeoutMs: 8000,
      maxRetries: 1
    });
    if (res && typeof res === 'object') caps = res;
  } catch { /* rest_no_route (plugin missing/old), locked down, or slow */ }
  elementorModuleCache.set(clientKey, { at: Date.now(), caps });
  return caps;
}


// True when the module reports a given feature is usable (module present,
// Elementor active, feature flag on). Tolerant of payload-shape drift.
export function moduleFeatureOn(caps, feature) {
  if (!caps || typeof caps !== 'object') return false;
  if (caps.elementor_active === false) return false;
  const features = caps.features && typeof caps.features === 'object' ? caps.features : null;
  if (features && feature in features) return features[feature] === true;
  // Looser payloads without a features map: assume on when Elementor is active.
  return caps.elementor_active !== false;
}


// Best-effort CSS regeneration after an Elementor write. NEVER throws — a
// missing module, inactive Elementor, or slow route degrades to a no-op with a
// reason, so callers can attach the result without risking the underlying write.
export async function regenerateElementorCss(wpReq, postId, { scope = 'post', clientKey = wpReq?.clientKey || 'default' } = {}) {
  const caps = await probeElementorModule(wpReq, { clientKey });
  if (!caps) return { regenerated: false, reason: 'module_absent' };
  if (!moduleFeatureOn(caps, 'regenerate_css')) {
    return {
      regenerated: false,
      reason: caps.elementor_active === false ? 'elementor_inactive' : 'feature_unavailable'
    };
  }
  try {
    const res = await wpReq('/strudel-elementor/v1/regenerate-css', {
      method: 'POST',
      body: { post_id: postId, scope },
      timeoutMs: 12000,
      maxRetries: 1
    });
    return { regenerated: res?.regenerated !== false, method: res?.method || null, scope };
  } catch (error) {
    return { regenerated: false, reason: 'request_failed', detail: error.message };
  }
}


// Fetch a page's Elementor structure via the server-side slim endpoint when the
// Strudel module exposes it. The payload is a few KB (element tree + label +
// widget-type histogram) instead of the whole _elementor_data blob — the blob
// transfer is what times out on heavy pages. Returns null to signal the caller
// should fall back to the core full-page read (module absent, feature off, or a
// non-Elementor post). NEVER throws.
export async function fetchElementorStructureViaModule(wpReq, postId, { clientKey = wpReq?.clientKey || 'default', labels = true, maxDepth } = {}) {
  const caps = await probeElementorModule(wpReq, { clientKey });
  if (!moduleFeatureOn(caps, 'structure')) return null;
  const params = new URLSearchParams();
  if (labels === false) params.set('labels', '0');
  if (Number.isInteger(maxDepth)) params.set('max_depth', String(maxDepth));
  const qs = params.toString();
  const path = `/strudel-elementor/v1/structure/${postId}${qs ? `?${qs}` : ''}`;
  try {
    const res = await wpReq(path, { timeoutMs: 15000, maxRetries: 1 });
    if (!res || typeof res !== 'object' || !Array.isArray(res.tree)) return null;
    return res;
  } catch {
    // 404 (not an Elementor post), locked down, or slow -> fall back to core.
    return null;
  }
}


// Adapt the module's slim structure to the shape wp_elementor_get_page_structure
// has always returned (stats + tree with `snippet`), so consumers don't change.
// The module tree is small, so re-walking it here is cheap.
export function adaptModuleStructure(mod) {
  const stats = { sections: 0, columns: 0, containers: 0, widgets: 0, total: 0 };
  function node(el) {
    stats.total++;
    if (el.elType === 'section') stats.sections++;
    else if (el.elType === 'column') stats.columns++;
    else if (el.elType === 'container') stats.containers++;
    else if (el.elType === 'widget') stats.widgets++;
    const out = { id: el.id, elType: el.elType };
    if (el.widgetType) out.widgetType = el.widgetType;
    if (el.label) out.snippet = el.label;
    if (Number.isInteger(el.children_count)) out.children_count = el.children_count;
    if (Array.isArray(el.children)) out.children = el.children.map(node);
    return out;
  }
  const tree = Array.isArray(mod.tree) ? mod.tree.map(node) : [];
  return { stats, tree, widget_types: mod.widget_types || {} };
}


// Extract a normalized, restore-able state object from a page fetched via
// /wp/v2/pages/{id}?context=edit. Used by wp_publish_draft_over and
// wp_replace_text to return `previous_state`, and by wp_get_page_state /
// wp_restore_page_state as the canonical state shape.
export function extractPageState(page) {
  if (!page || typeof page !== 'object') return null;
  const meta = {};
  for (const key of [...ELEMENTOR_META_KEYS, ...SEO_META_KEYS]) {
    if (page.meta && page.meta[key] !== undefined) meta[key] = page.meta[key];
  }
  // Normalize _elementor_data to a string (Elementor stores it as a JSON
  // string in postmeta; some REST consumers return it parsed).
  if (meta._elementor_data !== undefined && typeof meta._elementor_data !== 'string') {
    meta._elementor_data = meta._elementor_data == null ? '' : JSON.stringify(meta._elementor_data);
  }
  return {
    post_id: page.id,
    title: page.title?.raw ?? page.title?.rendered ?? '',
    content: page.content?.raw ?? page.content?.rendered ?? '',
    excerpt: page.excerpt?.raw ?? '',
    status: page.status ?? '',
    template: page.template ?? '',
    menu_order: typeof page.menu_order === 'number' ? page.menu_order : 0,
    featured_media: page.featured_media ?? null,
    meta
  };
}


// Build a /wp/v2/pages/{id} POST payload from a normalized state object.
// Skips empty/null meta values so they don't overwrite live fields with blanks.
export function statePayload(state) {
  const payload = {
    title: state.title ?? '',
    content: state.content ?? '',
    excerpt: state.excerpt ?? ''
  };
  if (state.template !== undefined && state.template !== null) payload.template = state.template;
  if (typeof state.menu_order === 'number') payload.menu_order = state.menu_order;
  if (state.featured_media != null) payload.featured_media = state.featured_media;
  if (state.meta && typeof state.meta === 'object') {
    const meta = {};
    for (const [k, v] of Object.entries(state.meta)) {
      if (v === '' || v === null) continue;
      meta[k] = (k === '_elementor_data' && typeof v !== 'string') ? JSON.stringify(v) : v;
    }
    if (Object.keys(meta).length > 0) payload.meta = meta;
  }
  return payload;
}


// Write `_elementor_data` through the privileged Agency OS route when it's
// installed, falling back to the core REST meta write otherwise.
//
// Why this exists: `_elementor_data` is a `_`-prefixed (protected) postmeta key
// that Elementor does NOT register for REST writes. Core REST therefore rejects
// attempts to set it via /wp/v2/pages/{id} ("rest_cannot_update" /
// "rest_protected_meta") even though reads succeed. The mu-plugin route does a
// direct `update_post_meta` behind an `edit_post` capability check, so writes
// land reliably. If the route isn't present we degrade to the old core write so
// nothing breaks on sites that haven't installed the bridge.
export async function writeElementorData(wpReq, pageId, data) {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  let result;
  try {
    const res = await wpReq('/agency-os/v1/elementor-data', {
      method: 'POST',
      body: { post_id: pageId, elementor_data: serialized }
    });
    result = { via: 'privileged', bytes: res?.bytes ?? serialized.length };
  } catch (error) {
    // Only fall back when the route itself is absent (rest_no_route). A plain
    // 404 from the route means "post not found" — a real error we must surface,
    // not a missing endpoint, so we don't mask it with a core write attempt.
    const notInstalled = /rest_no_route/.test(error.message);
    if (notInstalled) {
      await wpReq(`/wp/v2/pages/${pageId}`, {
        method: 'POST',
        body: { meta: { _elementor_data: serialized } }
      });
      result = { via: 'core', bytes: serialized.length };
    } else {
      throw error;
    }
  }
  // Regenerate Elementor's cached per-post CSS so the write actually shows
  // without an editor re-save. Best-effort and never-throws: on sites without
  // the Strudel Elementor module this returns a no-op reason after one cached
  // probe (no extra request). Especially important on the `via:'core'` path,
  // which — unlike the privileged route — does no cache clear server-side.
  result.css = await regenerateElementorCss(wpReq, pageId);
  return result;
}


// POST a page update, routing any `_elementor_data` in the payload through the
// privileged route while sending every other field (title, content, excerpt,
// SEO meta, …) via core REST. `body` is the full /wp/v2/pages/{id} payload.
export async function updatePageRouted(wpReq, pageId, body) {
  const payload = { ...body };
  let elementor;
  if (payload.meta && payload.meta._elementor_data !== undefined) {
    elementor = payload.meta._elementor_data;
    const { _elementor_data, ...restMeta } = payload.meta;
    if (Object.keys(restMeta).length > 0) payload.meta = restMeta;
    else delete payload.meta;
  }
  if (Object.keys(payload).length > 0) {
    await wpReq(`/wp/v2/pages/${pageId}`, { method: 'POST', body: payload });
  }
  if (elementor !== undefined) {
    return await writeElementorData(wpReq, pageId, elementor);
  }
  return null;
}
