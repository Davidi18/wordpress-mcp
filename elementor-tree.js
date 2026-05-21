// elementor-tree.js
// Surgical primitives for Elementor's _elementor_data tree.
//
// The tree is an array of top-level elements (sections or containers). Every
// element has: { id, elType, settings, elements: [...children] }. Widgets also
// carry { widgetType }. Sections wrap columns; containers wrap containers
// directly. Walks here are agnostic — they recurse on `elements` regardless of
// elType.
//
// Functions return NEW trees (deep enough to be immutable along the changed
// path). They never mutate input.

import crypto from 'crypto';

// 8-char hex matches Elementor's runtime-generated ids and the convention used
// by regenerateIds() in elementor-blocks-library.js.
function freshId() {
  return crypto.randomBytes(4).toString('hex');
}

// Walk every element in pre-order. Visitor receives (element, parent, index, depth).
// Return false from visitor to stop recursion into that subtree.
export function walk(tree, visit, parent = null, depth = 0) {
  if (!Array.isArray(tree)) return;
  for (let i = 0; i < tree.length; i++) {
    const el = tree[i];
    if (!el || typeof el !== 'object') continue;
    const cont = visit(el, parent, i, depth);
    if (cont === false) continue;
    if (Array.isArray(el.elements) && el.elements.length > 0) {
      walk(el.elements, visit, el, depth + 1);
    }
  }
}

// Find an element by id. Returns { element, parentArray, indexInParent, ancestors }
// or null. `parentArray` is the sibling array containing the element (= tree if at
// root, else parent.elements). `ancestors` is an ordered list of enclosing elements
// from root to immediate parent.
export function findElementById(tree, id) {
  if (!Array.isArray(tree)) return null;
  function recur(arr, ancestors) {
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el || typeof el !== 'object') continue;
      if (el.id === id) {
        return { element: el, parentArray: arr, indexInParent: i, ancestors };
      }
      if (Array.isArray(el.elements) && el.elements.length > 0) {
        const hit = recur(el.elements, [...ancestors, el]);
        if (hit) return hit;
      }
    }
    return null;
  }
  return recur(tree, []);
}

// Apply `patcher(element)` to the element with the given id. The patcher
// returns a new element object (don't mutate the argument). Returns the new
// tree, or null if the id was not found. Only the path from root to the
// target is cloned — siblings off the path keep their identity.
export function patchElementById(tree, id, patcher) {
  if (!Array.isArray(tree)) return null;
  let found = false;
  function recur(arr) {
    let copied = null;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el || typeof el !== 'object') continue;
      if (el.id === id) {
        const next = patcher(el);
        if (next === el) { found = true; continue; }
        if (!copied) copied = arr.slice();
        copied[i] = next;
        found = true;
        continue;
      }
      if (Array.isArray(el.elements) && el.elements.length > 0) {
        const childRes = recur(el.elements);
        if (childRes) {
          if (!copied) copied = arr.slice();
          copied[i] = { ...el, elements: childRes };
        }
      }
    }
    return copied;
  }
  const next = recur(tree);
  if (!found) return null;
  return next || tree;
}

// Remove the element with the given id. Returns { tree: newTree, removed }
// or { tree, removed: null } if not found.
export function removeElementById(tree, id) {
  if (!Array.isArray(tree)) return { tree, removed: null };
  let removed = null;
  function recur(arr) {
    let copied = null;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!el || typeof el !== 'object') continue;
      if (el.id === id) {
        if (!copied) copied = arr.slice();
        removed = el;
        copied.splice(copied.indexOf(el), 1);
        return copied;
      }
      if (Array.isArray(el.elements) && el.elements.length > 0) {
        const childRes = recur(el.elements);
        if (childRes) {
          if (!copied) copied = arr.slice();
          copied[i] = { ...el, elements: childRes };
        }
      }
    }
    return copied;
  }
  const next = recur(tree);
  return { tree: next || tree, removed };
}

// Recursively rewrite every `id` in an element subtree to a freshly-generated
// 8-char hex id. Same algorithm as regenerateIds() in elementor-blocks-library.js,
// but kept local so this module has no cross-dependency.
export function regenerateIds(elements) {
  if (!Array.isArray(elements)) return elements;
  return elements.map(el => {
    if (!el || typeof el !== 'object') return el;
    const fresh = { ...el, id: freshId() };
    if (Array.isArray(el.elements) && el.elements.length > 0) {
      fresh.elements = regenerateIds(el.elements);
    }
    return fresh;
  });
}

// Duplicate the element with the given id. The clone is inserted into the same
// parent array, at the position controlled by `where`:
//   'after'  (default) — directly after the original
//   'before'           — directly before the original
//   'end'              — appended to the parent
//   'start'            — prepended to the parent
// Returns { tree, duplicateId } or { tree, duplicateId: null } if not found.
export function duplicateElementById(tree, id, where = 'after') {
  const hit = findElementById(tree, id);
  if (!hit) return { tree, duplicateId: null };
  const clone = JSON.parse(JSON.stringify(hit.element));
  const cloneTree = regenerateIds([clone]);
  const dup = cloneTree[0];
  const dupId = dup.id;

  // Strategy: patch the parent array via a recursive walk that replaces only the
  // changed path. If the target is at root, build a new top-level array.
  function spliceInto(arr) {
    const next = arr.slice();
    const idx = next.findIndex(e => e?.id === id);
    if (idx === -1) return arr;
    let insertAt;
    if (where === 'before') insertAt = idx;
    else if (where === 'start') insertAt = 0;
    else if (where === 'end') insertAt = next.length;
    else insertAt = idx + 1; // 'after'
    next.splice(insertAt, 0, dup);
    return next;
  }

  // At root.
  if (hit.ancestors.length === 0) {
    return { tree: spliceInto(tree), duplicateId: dupId };
  }

  // Nested: walk to the parent, replace its elements array.
  const parentId = hit.ancestors[hit.ancestors.length - 1].id;
  const next = patchElementById(tree, parentId, (parent) => ({
    ...parent,
    elements: spliceInto(parent.elements)
  }));
  return { tree: next || tree, duplicateId: dupId };
}

// Normalize a partial widget config into a full Elementor widget element.
// Fills in elType, elements, and a fresh id. Caller supplies widgetType +
// settings (and optionally elType for non-widget elements).
export function normalizeWidget(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('widget config must be an object');
  }
  const elType = input.elType || 'widget';
  if (elType === 'widget' && !input.widgetType) {
    throw new Error('widget config requires `widgetType` (e.g. "heading", "button", "shortcode")');
  }
  const out = {
    id: input.id || freshId(),
    elType,
    settings: input.settings && typeof input.settings === 'object' ? { ...input.settings } : {},
    elements: Array.isArray(input.elements) ? regenerateIds(input.elements) : [],
    isInner: !!input.isInner
  };
  if (elType === 'widget') out.widgetType = input.widgetType;
  return out;
}

// Insert a new element into the tree. `position` can be:
//   'end' (default) / 'start' — at root level
//   integer N — root index N
//   { parent_id, position? } — inside parent, position defaults to 'end'
//   { after_id }   — directly after the element with that id (same parent)
//   { before_id }  — directly before
// Returns { tree, insertedId }.
export function insertElement(tree, newElement, position = 'end') {
  const inserted = newElement.id ? newElement : { ...newElement, id: freshId() };
  const insertedId = inserted.id;

  // Root-level shortcuts.
  if (position === 'end') return { tree: [...(tree || []), inserted], insertedId };
  if (position === 'start') return { tree: [inserted, ...(tree || [])], insertedId };
  if (Number.isInteger(position)) {
    const arr = [...(tree || [])];
    const idx = Math.max(0, Math.min(position, arr.length));
    arr.splice(idx, 0, inserted);
    return { tree: arr, insertedId };
  }

  // after_id / before_id — find the sibling, splice next to it inside the same parent.
  if (position && (position.after_id || position.before_id)) {
    const anchorId = position.after_id || position.before_id;
    const hit = findElementById(tree, anchorId);
    if (!hit) throw new Error(`Anchor element ${anchorId} not found`);
    const offset = position.after_id ? 1 : 0;

    if (hit.ancestors.length === 0) {
      const next = [...tree];
      next.splice(hit.indexInParent + offset, 0, inserted);
      return { tree: next, insertedId };
    }
    const parentId = hit.ancestors[hit.ancestors.length - 1].id;
    const next = patchElementById(tree, parentId, (parent) => {
      const arr = [...parent.elements];
      arr.splice(hit.indexInParent + offset, 0, inserted);
      return { ...parent, elements: arr };
    });
    return { tree: next || tree, insertedId };
  }

  // parent_id specified.
  if (position && position.parent_id) {
    const parentHit = findElementById(tree, position.parent_id);
    if (!parentHit) throw new Error(`Parent element ${position.parent_id} not found`);
    const innerPos = position.position ?? 'end';
    const next = patchElementById(tree, position.parent_id, (parent) => {
      const arr = [...(parent.elements || [])];
      let idx;
      if (innerPos === 'start') idx = 0;
      else if (innerPos === 'end') idx = arr.length;
      else if (Number.isInteger(innerPos)) idx = Math.max(0, Math.min(innerPos, arr.length));
      else idx = arr.length;
      arr.splice(idx, 0, inserted);
      return { ...parent, elements: arr };
    });
    return { tree: next || tree, insertedId };
  }

  throw new Error(`Unsupported position: ${JSON.stringify(position)}`);
}

// Strip HTML tags from a string and collapse whitespace. Used for snippets.
function stripHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extract a short human-readable snippet from a widget's settings.
function snippetOfWidget(widgetType, settings, maxLen) {
  const s = settings || {};
  let raw = '';
  switch (widgetType) {
    case 'heading': raw = s.title; break;
    case 'text-editor': raw = s.editor; break;
    case 'button': raw = s.text; break;
    case 'image-box':
    case 'icon-box': raw = s.title_text || s.description_text; break;
    case 'testimonial': raw = s.testimonial_content; break;
    case 'accordion':
    case 'toggle': raw = Array.isArray(s.tabs) && s.tabs[0]?.tab_title; break;
    case 'tabs': raw = Array.isArray(s.tabs) && s.tabs[0]?.tab_title; break;
    case 'shortcode': raw = s.shortcode; break;
    case 'html': raw = s.html; break;
    case 'icon-list': raw = Array.isArray(s.icon_list) && s.icon_list[0]?.text; break;
    case 'image': raw = s.image?.url || s.caption; break;
    case 'alert': raw = s.alert_title; break;
    case 'price-table': raw = s.heading || s.sub_heading; break;
    case 'call-to-action': raw = s.title; break;
    case 'flip-box': raw = s.title_text_a || s.title_text_b; break;
    case 'form': raw = s.form_name; break;
    case 'posts':
    case 'loop-grid': raw = s.template_id ? `template_id=${s.template_id}` : 'posts'; break;
    default:
      raw = s.title || s.text || s.heading || '';
  }
  const cleaned = stripHtml(raw || '');
  if (!cleaned) return '';
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 1) + '…' : cleaned;
}

// Build a navigable structural summary of an Elementor tree. Each element
// produces a node with { id, elType, widgetType?, snippet?, children: [...] }.
// Children are recurred at every depth, so the full tree shape is preserved
// without the heavy `settings` payload.
export function summarizeTree(tree, { max_snippet_length = 80 } = {}) {
  if (!Array.isArray(tree)) return [];
  const stats = { sections: 0, columns: 0, containers: 0, widgets: 0, total: 0 };

  function node(el) {
    stats.total++;
    if (el.elType === 'section') stats.sections++;
    else if (el.elType === 'column') stats.columns++;
    else if (el.elType === 'container') stats.containers++;
    else if (el.elType === 'widget') stats.widgets++;

    const out = { id: el.id, elType: el.elType };
    if (el.widgetType) out.widgetType = el.widgetType;
    if (el.elType === 'widget') {
      const snip = snippetOfWidget(el.widgetType, el.settings, max_snippet_length);
      if (snip) out.snippet = snip;
    } else if (el.elType === 'section' || el.elType === 'container') {
      const struct = el.settings?.structure;
      if (struct) out.structure = struct;
    }
    if (Array.isArray(el.elements) && el.elements.length > 0) {
      out.children = el.elements.map(node);
    }
    return out;
  }

  const nodes = tree.map(node);
  return { stats, tree: nodes };
}

// Recurse a settings object collecting every URL value (from {url:...} containers,
// _url-suffixed string keys, and arrays of records). Used by the url_contains
// filter below and by external consumers that want to inspect URLs.
export function collectUrls(settings) {
  const urls = [];
  if (!settings || typeof settings !== 'object') return urls;
  function walkObj(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && k.endsWith('_url')) {
        urls.push(v);
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.url === 'string') {
        urls.push(v.url);
        continue;
      }
      if (Array.isArray(v)) {
        for (const item of v) walkObj(item);
      }
    }
  }
  walkObj(settings);
  return urls;
}

// Search the tree for widgets matching the given criteria. Used by both the
// per-page primitive and the cross-page wp_elementor_find_widgets tool.
// Filters:
//   widget_type    — exact match on widgetType
//   text_contains  — case-insensitive substring on any text field
//   url_contains   — case-insensitive substring on any URL field (link.url,
//                    image.url, background_image.url, *_url strings, arrays)
//   setting_equals — { key: value } — strict equality on settings[key]
// Returns an array of { id, widgetType, ancestors_ids, snippet }.
export function findWidgets(tree, { widget_type, text_contains, url_contains, setting_equals } = {}, { max_snippet_length = 80 } = {}) {
  if (!Array.isArray(tree)) return [];
  const needle = text_contains ? String(text_contains).toLowerCase() : null;
  const urlNeedle = url_contains ? String(url_contains).toLowerCase() : null;
  const setKeys = setting_equals ? Object.keys(setting_equals) : null;
  const TEXT_KEYS = ['title','editor','text','description','description_text','title_text','caption','html','button_text','testimonial_content','testimonial_name','testimonial_job','heading','sub_heading','tab_title','tab_content','shortcode','alert_title'];
  const matches = [];

  function recur(arr, ancestors) {
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue;
      if (el.elType === 'widget') {
        let ok = true;
        if (widget_type && el.widgetType !== widget_type) ok = false;
        if (ok && needle) {
          const s = el.settings || {};
          const hit = TEXT_KEYS.some(k => {
            const v = s[k];
            if (typeof v === 'string') return stripHtml(v).toLowerCase().includes(needle);
            if (Array.isArray(v)) {
              return v.some(item => typeof item === 'object' && Object.values(item).some(iv =>
                typeof iv === 'string' && stripHtml(iv).toLowerCase().includes(needle)
              ));
            }
            return false;
          });
          if (!hit) ok = false;
        }
        if (ok && urlNeedle) {
          const urls = collectUrls(el.settings);
          if (!urls.some(u => u.toLowerCase().includes(urlNeedle))) ok = false;
        }
        if (ok && setKeys) {
          for (const k of setKeys) {
            if (el.settings?.[k] !== setting_equals[k]) { ok = false; break; }
          }
        }
        if (ok) {
          matches.push({
            id: el.id,
            widgetType: el.widgetType,
            ancestors_ids: ancestors.map(a => a.id),
            snippet: snippetOfWidget(el.widgetType, el.settings, max_snippet_length)
          });
        }
      }
      if (Array.isArray(el.elements) && el.elements.length > 0) {
        recur(el.elements, [...ancestors, el]);
      }
    }
  }
  recur(tree, []);
  return matches;
}
