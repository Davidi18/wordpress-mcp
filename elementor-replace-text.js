// Elementor text-replacement helpers.
// Walks a parsed _elementor_data tree and replaces text in widget settings
// (title, editor HTML, button text, descriptions, captions, etc.). Skips
// fields bound to dynamic tags via __dynamic__.

export const REPLACE_TEXT_KEYS = [
  'title', 'editor', 'text', 'description', 'caption', 'html',
  'text_above_form', 'text_below_form',
  'before_text', 'after_text', 'highlighted_text', 'rotating_text',
  'button_text', 'subheading', 'subtitle',
  'tab_title', 'tab_content',
  'placeholder', 'alert_title', 'alert_description',
  'price', 'period', 'currency_symbol',
  'testimonial_content', 'testimonial_name', 'testimonial_job'
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyReplaceText(haystack, find, replace, regex, caseInsensitive) {
  if (typeof haystack !== 'string' || haystack === '') return [haystack, 0];

  if (regex) {
    let re;
    try {
      re = new RegExp(find, 'g' + (caseInsensitive ? 'i' : ''));
    } catch (e) {
      throw new Error(`Invalid regex pattern: ${e.message}`);
    }
    let count = 0;
    const result = haystack.replace(re, () => { count++; return replace; });
    return [result, count];
  }

  if (find === '') return [haystack, 0];

  if (caseInsensitive) {
    const re = new RegExp(escapeRegex(find), 'gi');
    let count = 0;
    const result = haystack.replace(re, () => { count++; return replace; });
    return [result, count];
  }

  if (!haystack.includes(find)) return [haystack, 0];
  const parts = haystack.split(find);
  return [parts.join(replace), parts.length - 1];
}

export function walkElementorReplace(elements, find, replace, regex, caseInsensitive, counter) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    if (el && typeof el === 'object' && el.settings && typeof el.settings === 'object') {
      const dynamic = (el.settings.__dynamic__ && typeof el.settings.__dynamic__ === 'object')
        ? el.settings.__dynamic__
        : {};
      for (const key of REPLACE_TEXT_KEYS) {
        if (typeof el.settings[key] !== 'string') continue;
        if (key in dynamic) continue;
        const [next, n] = applyReplaceText(el.settings[key], find, replace, regex, caseInsensitive);
        if (n > 0) {
          el.settings[key] = next;
          counter.replacements += n;
          counter.fields[key] = (counter.fields[key] || 0) + n;
        }
      }
    }
    if (el && Array.isArray(el.elements)) {
      walkElementorReplace(el.elements, find, replace, regex, caseInsensitive, counter);
    }
  }
}
