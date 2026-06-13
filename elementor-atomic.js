// elementor-atomic.js
// Builders for Elementor 4.0 "atomic" (V4) elements.
//
// Atomic elements changed the shape of what goes into _elementor_data. Two
// things differ from the classic model:
//   1. Every settings value is wrapped in a typed envelope { $$type, value }.
//   2. Visual styling lives in a per-element `styles` map (local CSS classes),
//      referenced by id from settings.classes — not inline in `settings`.
//
// This module is pure (no Elementor runtime needed): it just emits the JSON
// shapes Elementor's atomic engine expects, so our existing tree primitives
// (elementor-tree.js) and write path can carry them. Format ported from
// msrbuilds/elementor-mcp (class-atomic-props/styles/element-factory.php).
//
// See ELEMENTOR-V4-ATOMIC-PLAN.md for the full format reference and the
// detection/persistence gotchas (atomic support is NOT a version check).

import crypto from 'crypto';

// 8-char hex matches Elementor's runtime ids and freshId() in elementor-tree.js.
function freshId() {
  return crypto.randomBytes(4).toString('hex');
}

// Atomic widget types (elType stays "widget", widgetType is e-prefixed).
export const ATOMIC_WIDGET_TYPES = [
  'e-heading', 'e-paragraph', 'e-button', 'e-image', 'e-svg',
  'e-youtube', 'e-self-hosted-video', 'e-divider'
];

// Atomic container types (used as elType directly, no widgetType).
export const ATOMIC_CONTAINER_TYPES = ['e-flexbox', 'e-div-block'];

// True if a widgetType/elType string belongs to the atomic (V4) system.
export function isAtomicType(type) {
  return ATOMIC_WIDGET_TYPES.includes(type) || ATOMIC_CONTAINER_TYPES.includes(type);
}

// ────────────────────────────────────────────────────────────────────────────
// props — the $$type typed-value system
//
// Every atomic settings value is { $$type: "<type>", value: <payload> }.
// Compound types nest other typed props (link.destination is itself a `url`).
// ────────────────────────────────────────────────────────────────────────────

export const props = {
  string(value) {
    return { $$type: 'string', value: String(value) };
  },

  number(value) {
    return { $$type: 'number', value };
  },

  boolean(value) {
    return { $$type: 'boolean', value: !!value };
  },

  // Number + CSS unit. unit ∈ px | em | rem | % | vw | vh.
  size(size, unit = 'px') {
    return { $$type: 'size', value: { size, unit } };
  },

  url(value) {
    return { $$type: 'url', value: String(value) };
  },

  // Rich-text content wrapper used by heading/paragraph/button labels.
  html(text) {
    return {
      $$type: 'html-v3',
      value: { content: props.string(text), children: [] }
    };
  },

  // Linkable target. isTargetBlank is only emitted when true (mirrors source).
  link(url, targetBlank = false) {
    const value = { destination: props.url(url), tag: props.string('a') };
    if (targetBlank) value.isTargetBlank = props.boolean(true);
    return { $$type: 'link', value };
  },

  // List of style-class ids applied to an element. Always present on atomic
  // elements (default empty).
  classes(classIds = []) {
    return { $$type: 'classes', value: Array.isArray(classIds) ? [...classIds] : [] };
  },

  // WordPress media reference (used for both images and SVGs).
  image(imageId = 0, imageUrl = '') {
    return {
      $$type: 'image',
      value: { src: { id: props.number(imageId), url: props.url(imageUrl) } }
    };
  }
};

// Recursively unwrap $$type values back to plain JS, for AI-friendly reads.
// Mirrors Atomic_Props::unwrap — size collapses to "<n><unit>", link/html
// collapse to their inner value, image returns { id, url }.
export function unwrap(prop) {
  if (Array.isArray(prop)) return prop.map(unwrap);
  if (!prop || typeof prop !== 'object') return prop;

  if (Object.prototype.hasOwnProperty.call(prop, '$$type')) {
    const type = prop.$$type;
    const value = prop.value ?? null;
    switch (type) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'url':
        return value;
      case 'size':
        return value && typeof value === 'object'
          ? `${value.size ?? 0}${value.unit ?? 'px'}`
          : value;
      case 'html-v3':
        return value && value.content ? unwrap(value.content) : value;
      case 'link':
        return value && value.destination ? unwrap(value.destination) : value;
      case 'classes':
        return Array.isArray(value) ? value : [];
      case 'image':
        if (value && value.src && typeof value.src === 'object') {
          return { id: unwrap(value.src.id ?? 0), url: unwrap(value.src.url ?? '') };
        }
        return value;
      default:
        return value && typeof value === 'object' ? unwrapObject(value) : value;
    }
  }

  return unwrapObject(prop);
}

function unwrapObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = unwrap(v);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// styles — local style classes
//
// In V4, layout/spacing/colors are stored as a local "class" in element.styles
// and referenced by id from settings.classes. build*Props() turn flat,
// AI-friendly params into $$type-wrapped, CSS-property-named props.
// ────────────────────────────────────────────────────────────────────────────

export const styles = {
  // Build a style-def + its class id. state ∈ null | hover | focus | active.
  createLocalClass(elementId, cssProps, breakpoint = 'desktop', state = null) {
    const classId = `e-${elementId}-${crypto.randomBytes(4).toString('hex').slice(0, 7)}`;
    return {
      classId,
      styleDef: {
        id: classId,
        label: 'local',
        type: 'class',
        variants: [
          { meta: { breakpoint, state }, props: cssProps, custom_css: null }
        ]
      }
    };
  },

  // Flex layout props. Accepts both shorthand (direction/justify/align/wrap)
  // and the explicit flex_* keys. Gaps are size props.
  buildFlexProps(params = {}) {
    const out = {};
    const stringMap = {
      direction: 'flex-direction', flex_direction: 'flex-direction',
      justify: 'justify-content', justify_content: 'justify-content',
      align: 'align-items', align_items: 'align-items',
      wrap: 'flex-wrap', flex_wrap: 'flex-wrap'
    };
    for (const [inKey, cssProp] of Object.entries(stringMap)) {
      if (params[inKey] !== undefined && params[inKey] !== '') {
        out[cssProp] = props.string(String(params[inKey]));
      }
    }
    if (params.gap !== undefined) {
      out.gap = props.size(Number(params.gap), params.gap_unit || 'px');
    }
    if (params.row_gap !== undefined) {
      out['row-gap'] = props.size(Number(params.row_gap), params.row_gap_unit || 'px');
    }
    if (params.column_gap !== undefined) {
      out['column-gap'] = props.size(Number(params.column_gap), params.column_gap_unit || 'px');
    }
    return out;
  },

  // Box-model + color props. Uses logical CSS properties (block/inline), which
  // is what Elementor's V4 generator emits.
  buildCommonProps(params = {}) {
    const out = {};
    const sizeMap = {
      padding_top: 'padding-block-start',
      padding_right: 'padding-inline-end',
      padding_bottom: 'padding-block-end',
      padding_left: 'padding-inline-start',
      margin_top: 'margin-block-start',
      margin_bottom: 'margin-block-end',
      width: 'width',
      min_height: 'min-height',
      border_radius: 'border-radius'
    };
    for (const [inKey, cssProp] of Object.entries(sizeMap)) {
      if (params[inKey] !== undefined) {
        out[cssProp] = props.size(Number(params[inKey]), params[`${inKey}_unit`] || 'px');
      }
    }
    // Single `padding` fills all four logical sides.
    if (params.padding !== undefined) {
      const sizeVal = props.size(Number(params.padding), params.padding_unit || 'px');
      out['padding-block-start'] = sizeVal;
      out['padding-block-end'] = sizeVal;
      out['padding-inline-start'] = sizeVal;
      out['padding-inline-end'] = sizeVal;
    }
    if (params.background_color !== undefined) {
      out['background-color'] = props.string(params.background_color);
    }
    if (params.color !== undefined) {
      out.color = props.string(params.color);
    }
    return out;
  },

  // Push a class id into settings.classes and add its def to element.styles.
  // Mutates the element in place (caller owns a fresh element).
  applyToElement(element, classId, styleDef) {
    if (!element.settings) element.settings = {};
    if (!element.settings.classes) element.settings.classes = props.classes([]);
    element.settings.classes.value.push(classId);
    if (!element.styles || Array.isArray(element.styles)) element.styles = {};
    element.styles[classId] = styleDef;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// factory — element builders
//
// Atomic elements carry extra top-level keys beyond the classic shape:
// styles, interactions, editor_settings, version. `styles` is a map (object);
// interactions/editor_settings are lists. `version` is the Elementor version
// string — unknown from Node, so it defaults to '' and can be set by the
// write path (see plan §4 Phase 3).
// ────────────────────────────────────────────────────────────────────────────

function atomicScaffold(extra = {}, version = '') {
  return {
    isInner: false,
    styles: {},
    interactions: [],
    editor_settings: [],
    version,
    ...extra
  };
}

export const factory = {
  // Atomic widget: elType stays "widget", widgetType is e-prefixed.
  // `settings` must already be $$type-wrapped (use props.* / the convenience
  // builders below). Ensures a default empty classes prop.
  createAtomicWidget(widgetType, settings = {}, version = '') {
    if (!settings.classes) settings.classes = props.classes([]);
    return {
      id: freshId(),
      elType: 'widget',
      widgetType,
      settings,
      elements: [],
      ...atomicScaffold({}, version)
    };
  },

  // Flexbox container. styleProps are flat layout params turned into a local
  // class; settings holds tag/classes ($$type-wrapped).
  createFlexbox(settings = {}, children = [], styleProps = {}, version = '') {
    const id = freshId();
    if (!settings.tag) settings.tag = props.string('div');
    if (!settings.classes) settings.classes = props.classes([]);

    const element = {
      id,
      elType: 'e-flexbox',
      settings,
      elements: children,
      ...atomicScaffold({}, version)
    };

    const css = { ...styles.buildFlexProps(styleProps), ...styles.buildCommonProps(styleProps) };
    if (Object.keys(css).length > 0) {
      const { classId, styleDef } = styles.createLocalClass(id, css);
      styles.applyToElement(element, classId, styleDef);
    }
    return element;
  },

  // Div block container (block-level, no flex layout by default).
  createDivBlock(settings = {}, children = [], styleProps = {}, version = '') {
    const id = freshId();
    if (!settings.tag) settings.tag = props.string('div');
    if (!settings.classes) settings.classes = props.classes([]);

    const element = {
      id,
      elType: 'e-div-block',
      settings,
      elements: children,
      ...atomicScaffold({}, version)
    };

    const css = styles.buildCommonProps(styleProps);
    if (Object.keys(css).length > 0) {
      const { classId, styleDef } = styles.createLocalClass(id, css);
      styles.applyToElement(element, classId, styleDef);
    }
    return element;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Convenience widget builders — take flat params, emit valid atomic widgets.
// Optional `css_id` becomes settings._cssid. version is threaded through.
// ────────────────────────────────────────────────────────────────────────────

function withCssId(settings, cssId) {
  if (cssId) settings._cssid = props.string(cssId);
  return settings;
}

export const widgets = {
  heading({ title = 'Heading', tag = 'h2', link, css_id, version } = {}) {
    const settings = { title: props.html(title), tag: props.string(tag) };
    if (link) settings.link = props.link(link);
    return factory.createAtomicWidget('e-heading', withCssId(settings, css_id), version);
  },

  paragraph({ content = 'Paragraph text', link, css_id, version } = {}) {
    const settings = { paragraph: props.html(content) };
    if (link) settings.link = props.link(link);
    return factory.createAtomicWidget('e-paragraph', withCssId(settings, css_id), version);
  },

  button({ text = 'Click Here', link, target_blank = false, css_id, version } = {}) {
    const settings = { text: props.html(text) };
    if (link) settings.link = props.link(link, target_blank);
    return factory.createAtomicWidget('e-button', withCssId(settings, css_id), version);
  },

  image({ image_id = 0, image_url = '', alt, link, css_id, version } = {}) {
    const settings = { image: props.image(image_id, image_url) };
    if (alt) settings.alt = props.string(alt);
    if (link) settings.link = props.link(link);
    return factory.createAtomicWidget('e-image', withCssId(settings, css_id), version);
  },

  svg({ svg_id = 0, svg_url = '', css_id, version } = {}) {
    const settings = { svg: props.image(svg_id, svg_url) };
    return factory.createAtomicWidget('e-svg', withCssId(settings, css_id), version);
  },

  youtube({ video_url = '', css_id, version } = {}) {
    const settings = { source: props.string(video_url) };
    return factory.createAtomicWidget('e-youtube', withCssId(settings, css_id), version);
  },

  video({ video_url = '', video_id = 0, css_id, version } = {}) {
    const settings = { source: props.url(video_url || '') };
    return factory.createAtomicWidget('e-self-hosted-video', withCssId(settings, css_id), version);
  },

  divider({ css_id, version } = {}) {
    return factory.createAtomicWidget('e-divider', withCssId({}, css_id), version);
  }
};
