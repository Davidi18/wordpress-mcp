// elementor-replace-links.js
// URL find/replace across Elementor widget settings. Parallel to
// elementor-replace-text.js but operates on URL-bearing fields:
//   - any nested object that has a `url` string property (link, image,
//     background_image, image_link, lightbox_image, etc. — generic, not a
//     whitelist, so future widget URL fields work without changes here)
//   - any setting key whose name ends in `_url` and whose value is a string
//   - array-valued settings (icon_list, social_icon_list, tabs, gallery,
//     image_carousel, ...) recursed at every depth
//
// Skips fields bound to dynamic tags via __dynamic__ (same convention as
// the text-replacement walker).

import { applyReplaceText } from './elementor-replace-text.js';

// True if v is a plain object with a .url string. We treat that as a "link/
// image" container regardless of the key name.
function isUrlContainer(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && typeof v.url === 'string';
}

// Walk a settings object and call cb(currentValue, setKey) for every URL we find.
// `setKey` is a function the caller invokes with a new value to update in place.
function visitUrlsInSettings(settings, dynamicSet, visit) {
  if (!settings || typeof settings !== 'object') return;
  for (const key of Object.keys(settings)) {
    if (dynamicSet.has(key)) continue;
    const v = settings[key];

    // 1) Direct string URL setting (e.g. `target_url`, anything ending in _url).
    if (typeof v === 'string' && key.endsWith('_url')) {
      visit(v, (next) => { settings[key] = next; }, key);
      continue;
    }

    // 2) { url: "..." } container.
    if (isUrlContainer(v)) {
      visit(v.url, (next) => { v.url = next; }, `${key}.url`);
      // continue — there may be other nested objects deeper, but the container
      // shape doesn't typically nest further; skip recursion to avoid touching
      // unrelated string fields like {url, is_external, nofollow}.
      continue;
    }

    // 3) Array of records — recurse into each.
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const item = v[i];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          // Treat each array item as its own settings object. We pass an empty
          // dynamic set because __dynamic__ doesn't apply inside array items.
          visitUrlsInSettings(item, new Set(), visit);
        }
      }
      continue;
    }
  }
}

// Walk an Elementor element tree and apply find/replace to every URL field.
// `counter` aggregates: { replacements, urls: { [field_path]: count } }.
// Returns nothing — mutates the tree in place (caller has parsed JSON and
// will re-stringify after).
export function walkElementorReplaceLinkUrls(elements, find, replace, regex, caseInsensitive, counter) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    if (el && typeof el === 'object' && el.settings && typeof el.settings === 'object') {
      const dynamic = (el.settings.__dynamic__ && typeof el.settings.__dynamic__ === 'object')
        ? new Set(Object.keys(el.settings.__dynamic__))
        : new Set();

      visitUrlsInSettings(el.settings, dynamic, (currentUrl, setKey, fieldPath) => {
        const [next, n] = applyReplaceText(currentUrl, find, replace, regex, caseInsensitive);
        if (n > 0) {
          setKey(next);
          counter.replacements += n;
          counter.urls[fieldPath] = (counter.urls[fieldPath] || 0) + n;
        }
      });
    }
    if (el && Array.isArray(el.elements)) {
      walkElementorReplaceLinkUrls(el.elements, find, replace, regex, caseInsensitive, counter);
    }
  }
}
