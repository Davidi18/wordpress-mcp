# Elementor 4.0 "Atomic" Elements — Research & Implementation Plan

> Source studied: [`msrbuilds/elementor-mcp`](https://github.com/msrbuilds/elementor-mcp) (a PHP plugin).
> Goal: bring Elementor 4.0 atomic-element support into **our** Node.js MCP server.
>
> **Implementation status:**
> - ✅ **Phase 0** — atomic-support detection: `agency-os/v1/elementor-atomic-status`
>   probe route (in the `wp_bootstrap_elementor_writer` snippet) + `atomic` field
>   on `wp_elementor_capabilities`.
> - ✅ **Phase 1** — `elementor-atomic.js` format module (props/styles/factory +
>   widget builders) with a `node:test` suite.
> - ✅ **Phase 2** — `wp_elementor_add_atomic` builder tool (flat params → valid
>   atomic JSON, with a pre-write support check); `wp_elementor_get_widget_settings`
>   now returns `settings_readable`/`is_atomic` for V4 elements.
> - ✅ **Phase 3 (conservative)** — writer route stamps `_elementor_version` and
>   clears the CSS cache; kept raw-meta writes (not `Document::save()`) so atomic
>   data persists byte-for-byte and the tools' byte-length verification stays exact.
>
> Remaining: validate against a **live Elementor 4.0 site** (see §6 open questions).

---

## 1. Why this matters

Elementor 4.0 introduces a brand-new element system ("atomic" / "V4") that
changes the **shape of the data** stored in `_elementor_data`. Our server only
knows the **classic** model (`section` → `column` → `widget`, plus flex
`container`). On a site where the V4 experiment is on, classic widgets still
work, but we cannot build with the new atomic primitives (`e-flexbox`,
`e-div-block`, `e-heading`, `e-paragraph`, `e-button`, `e-image`, `e-svg`,
`e-youtube`, `e-self-hosted-video`, `e-divider`).

The valuable, portable knowledge in `elementor-mcp` is **the data format** —
not their PHP tooling. Once we can emit valid atomic JSON, our existing
tree primitives (`elementor-tree.js`) and write path do most of the rest.

### Architecture reminder (why we can't just copy their plugin)

| | **Us** | **elementor-mcp** |
|---|---|---|
| Runtime | Node.js server, talks to WP REST | PHP plugin **inside** WordPress |
| Elementor writes | raw `update_post_meta` via our `agency-os/v1/elementor-data` snippet | `Elementor\Document::save()` with raw-meta fallback |
| Can call Elementor PHP APIs? | No (only via snippet routes) | Yes, directly |

So we **port the format to JS**, and decide how much PHP-side help (capability
probe, optional `Document::save()`) we want to add to our snippet route.

---

## 2. The atomic data format (the core finding)

### 2.1 Two element categories

**Atomic containers** use a dedicated `elType` (no `widgetType`):

```jsonc
{
  "id": "a1b2c3d4",
  "elType": "e-flexbox",        // or "e-div-block"
  "settings": { /* $$type-wrapped props */ },
  "elements": [ /* children */ ],
  "isInner": false,
  "styles": { /* local style classes, see §2.4 */ },
  "interactions": [],
  "editor_settings": [],
  "version": "<ELEMENTOR_VERSION>"
}
```

**Atomic widgets** keep `elType: "widget"` but use an `e-`-prefixed
`widgetType` and the same extra top-level keys:

```jsonc
{
  "id": "e5f6a7b8",
  "elType": "widget",
  "widgetType": "e-heading",    // e-paragraph | e-button | e-image | e-svg | ...
  "settings": { /* $$type-wrapped props */ },
  "elements": [],
  "isInner": false,
  "styles": {},
  "interactions": [],
  "editor_settings": [],
  "version": "<ELEMENTOR_VERSION>"
}
```

> Key difference vs classic: the extra top-level keys
> (`styles`, `interactions`, `editor_settings`, `version`) and the
> **typed settings**. Classic widgets store plain values in `settings`;
> atomic elements wrap every value in a `$$type` envelope.

### 2.2 The `$$type` typed-prop system

Every settings value is `{ "$$type": "<type>", "value": <payload> }`:

| `$$type` | `value` shape | Used for |
|---|---|---|
| `string` | `"text"` | tags, enums, colors, plain strings |
| `number` | `42` | numeric scalars |
| `boolean` | `true` | flags |
| `size` | `{ "size": 24, "unit": "px" }` | gaps, padding, widths, radii (`px`/`em`/`rem`/`%`/`vw`/`vh`) |
| `url` | `"https://…"` | raw URLs |
| `link` | `{ "destination": <url>, "tag": <string "a">, "isTargetBlank?": <boolean> }` | linkable text/buttons |
| `html-v3` | `{ "content": <string>, "children": [] }` | rich text content (heading/paragraph/button label) |
| `classes` | `[ "class-id", … ]` | list of style-class ids applied to the element |
| `image` | `{ "src": { "id": <number>, "url": <url> } }` | image & svg references |

Note that compound types nest other typed props (e.g. `link.destination`
is itself a `url` prop; `image.src.id` is a `number` prop).

### 2.3 Per-element settings keys (verbatim from source)

| Element | `widgetType`/`elType` | Settings keys |
|---|---|---|
| Flexbox | `e-flexbox` (elType) | `tag` (string, default `div`), `classes`; layout via local style class (§2.4) |
| Div block | `e-div-block` (elType) | `tag` (string, default `div`), `classes`; styling via local class |
| Heading | `e-heading` | `title` (html-v3), `tag` (string `h1`–`h6`, default `h2`), `link?` (link), `_cssid?` (string), `classes` |
| Paragraph | `e-paragraph` | `paragraph` (html-v3), `link?`, `_cssid?`, `classes` |
| Button | `e-button` | `text` (html-v3), `link?` (link, supports `isTargetBlank`), `_cssid?`, `classes` |
| Image | `e-image` | `image` (image), `alt?` (string), `link?`, `_cssid?`, `classes` |
| SVG | `e-svg` | `svg` (image), `_cssid?`, `classes` |
| YouTube | `e-youtube` | `source` (string URL), `_cssid?`, `classes` |
| Self-hosted video | `e-self-hosted-video` | `source` (url), `_cssid?`, `classes` |
| Divider | `e-divider` | `_cssid?`, `classes` |

`classes` is always present (default empty `{ "$$type": "classes", "value": [] }`).
`_cssid` carries the optional CSS `id` attribute. Container valid `tag` enum:
`div, header, section, article, aside, footer`.

### 2.4 Styling: local style classes (the big shift)

In V4, **visual styling does not live in `settings`**. Instead each element has
a `styles` map; `settings.classes.value` lists the class ids that apply.

`build_flex_props`/`build_common_props` accept flat AI-friendly params and emit
**CSS-property-named, `$$type`-wrapped** props. A local class is generated:

```jsonc
// element.styles[classId] =
{
  "id": "e-<elementId>-<7hex>",      // also pushed into settings.classes.value
  "label": "local",
  "type": "class",
  "variants": [
    {
      "meta": { "breakpoint": "desktop", "state": null },  // state: hover|focus|active
      "props": {
        "flex-direction":      { "$$type": "string", "value": "column" },
        "justify-content":     { "$$type": "string", "value": "center" },
        "align-items":         { "$$type": "string", "value": "center" },
        "gap":                 { "$$type": "size", "value": { "size": 16, "unit": "px" } },
        "padding-block-start": { "$$type": "size", "value": { "size": 24, "unit": "px" } },
        "background-color":    { "$$type": "string", "value": "#ffffff" }
      },
      "custom_css": null
    }
  ]
}
```

Important mappings (logical CSS properties, kebab-case):

- Flex: `direction→flex-direction`, `justify→justify-content`,
  `align→align-items`, `wrap→flex-wrap`, `gap` (size), `row-gap`, `column-gap`.
- Box: `padding_top→padding-block-start`, `padding_right→padding-inline-end`,
  `padding_bottom→padding-block-end`, `padding_left→padding-inline-start`,
  `margin_top→margin-block-start`, `margin_bottom→margin-block-end`,
  `width`, `min-height`, `border-radius`. A single `padding` fills all four.
- Colors: `background_color→background-color`, `color→color` (string props).

To apply: push `classId` into `settings.classes.value` **and** add the style
def under `element.styles[classId]`. Breakpoints/states are expressed as extra
`variants[]` entries, not new classes.

---

## 3. Persistence & detection gotchas (learned from their source)

### 3.1 Atomic support is NOT a version check

`ELEMENTOR_VERSION` still reports **3.x** on sites running atomic (it ships as
opt-in experiments). The authoritative signal is **whether the atomic element
types are registered** (`elements_manager->get_element_types()` contains
`e-flexbox`/`e-div-block`), or the experiment `e_atomic_elements` /
`atomic_widgets` is active.

**Trap:** `e_opt_in_v4_page` (page-editor opt-in) can be ON while
`e_atomic_elements` is OFF. In that state, saving atomic JSON through
`Document::save()` **silently sanitizes the unknown elements away** — the write
returns success but `_elementor_data` ends up empty. Gate on element-type
registration, not the page-editor experiment.

### 3.2 Why our raw-meta route actually helps here — with caveats

Our `agency-os/v1/elementor-data` snippet does a **raw `update_post_meta`**
(no `Document::save()`), so atomic JSON is **not** silently sanitized — it
persists byte-for-byte. That sidesteps the §3.1 trap. **But** raw writes mean:

- **No validation.** `Document::save()` *throws* on invalid atomic settings;
  a raw write will happily persist malformed `$$type` props that can break the
  editor or front-end. We must emit correct JSON ourselves.
- **CSS regen.** V4 generates CSS from the `styles` map. Our snippet already
  `delete`s `_elementor_css`, which forces regeneration on next view — good,
  but verify it covers atomic local-class CSS on a live site.
- **Version flags.** Their fallback also sets `_elementor_edit_mode=builder`
  (we do) and `_elementor_version` (we don't currently). Worth adding.

---

## 4. Proposed implementation for our server

### Phase 0 — Capability detection (prerequisite)

Atomic support can't be inferred from the version number. Add a probe so the
agent never builds atomic JSON that won't persist:

- **Option A (preferred): tiny PHP probe route** in our snippet, e.g.
  `agency-os/v1/elementor-atomic-status`, returning whether `e-flexbox`/
  `e-div-block` are registered and which experiments are active. Authoritative.
- **Option B: heuristic** in `wp_elementor_capabilities` (version ≥ 3.30 + a
  flag). Cheap but unreliable; the source explicitly warns against version math.

Extend `wp_elementor_capabilities` output with `atomic_supported` (+ probe
detail). Recommend Option A.

### Phase 1 — Port the format to JS (`elementor-atomic.js`, new module)

Pure, dependency-free helpers mirroring their PHP (no Elementor runtime needed):

- `props.*` — `string/number/boolean/size/url/link/html/classes/image` builders
  emitting the `$$type` envelopes from §2.2.
- `unwrap()` — inverse, for AI-friendly reads (mirrors `Atomic_Props::unwrap`).
- `styles.buildFlexProps()/buildCommonProps()/createLocalClass()/applyToElement()`
  — §2.4 logic.
- `factory.createFlexbox()/createDivBlock()/createAtomicWidget()` plus
  per-widget convenience builders (heading/paragraph/button/image/svg/
  youtube/video/divider) — §2.1–2.3, including the extra top-level keys and
  `version`.
- Reuse `freshId()` from `elementor-tree.js` for ids (already 8-char hex).

This module is unit-testable in isolation against the JSON shapes above.

### Phase 2 — Wire into tools

Smallest-surface approach (avoid their 13-tool sprawl):

1. **Teach existing tools** the atomic shape. `wp_elementor_insert_widget`
   already takes `{ widgetType, settings, elements }`; document that an
   `e-`-prefixed `widgetType` triggers atomic envelope construction, and that
   container inserts may use `elType: "e-flexbox"`. `elementor-tree.js` walks on
   `elements` regardless of `elType`, so insert/move/remove/duplicate already
   work on atomic trees.
2. **Add a thin builder tool** `wp_elementor_add_atomic` (or extend
   `insert_widget`) that accepts flat params (text, tag, gap, padding, …) and
   builds valid atomic JSON via Phase 1 — so the agent isn't hand-writing
   `$$type` envelopes.
3. **Reads:** have `wp_elementor_get_widget_settings` optionally `unwrap()`
   atomic props for readability.

### Phase 3 (optional) — Harden the write route

Upgrade the writer snippet to attempt `Document::save()` first (validation +
native CSS regen) **only when atomic types are registered**, falling back to
raw meta otherwise — matching their robustness. Also set `_elementor_version`.
Optional; our raw write already persists atomic data.

---

## 5. Scope notes / what we are deliberately NOT copying

- Their **27 free + 30 Pro convenience widget tools** — sprawl; our generic
  insert + one atomic builder covers it.
- **AI Widget Builder** (spec→PHP `Widget_Base`) — requires running PHP inside
  WP; out of scope for a Node proxy.
- **Global classes (`g-` ids) manager, theme builder, dynamic tags** — separate
  gaps tracked elsewhere; not part of atomic-elements work.

## 6. Open questions to validate on a live V4 site

1. Does deleting `_elementor_css` regenerate CSS for atomic **local-class**
   styles after a raw meta write, or is a `Document::save()` pass required?
2. Exact `editor_settings` shape — source uses `array()` (empty); confirm `[]`
   vs `{}` when JSON-encoded (PHP `array()` → `[]`; an empty map may need `{}`).
3. Is per-element `version` required, and does a 3.x string there cause issues?
4. Confirm `e-svg`/`e-self-hosted-video`/`e-youtube` widgetType strings against
   a current Elementor build (these evolve during the experiment).

---

### Appendix A — Concrete example: a centered hero (atomic)

```jsonc
{
  "id": "11aa22bb",
  "elType": "e-flexbox",
  "settings": {
    "tag": { "$$type": "string", "value": "section" },
    "classes": { "$$type": "classes", "value": ["e-11aa22bb-0a1b2c3"] }
  },
  "styles": {
    "e-11aa22bb-0a1b2c3": {
      "id": "e-11aa22bb-0a1b2c3", "label": "local", "type": "class",
      "variants": [{
        "meta": { "breakpoint": "desktop", "state": null },
        "props": {
          "flex-direction":  { "$$type": "string", "value": "column" },
          "align-items":     { "$$type": "string", "value": "center" },
          "gap":             { "$$type": "size", "value": { "size": 16, "unit": "px" } },
          "padding-block-start": { "$$type": "size", "value": { "size": 80, "unit": "px" } },
          "padding-block-end":   { "$$type": "size", "value": { "size": 80, "unit": "px" } }
        },
        "custom_css": null
      }]
    }
  },
  "interactions": [], "editor_settings": [], "isInner": false, "version": "3.31.5",
  "elements": [
    {
      "id": "33cc44dd", "elType": "widget", "widgetType": "e-heading",
      "settings": {
        "title": { "$$type": "html-v3", "value": { "content": { "$$type": "string", "value": "Welcome" }, "children": [] } },
        "tag":   { "$$type": "string", "value": "h1" },
        "classes": { "$$type": "classes", "value": [] }
      },
      "styles": {}, "interactions": [], "editor_settings": [], "elements": [], "isInner": false, "version": "3.31.5"
    },
    {
      "id": "55ee66ff", "elType": "widget", "widgetType": "e-button",
      "settings": {
        "text": { "$$type": "html-v3", "value": { "content": { "$$type": "string", "value": "Get started" }, "children": [] } },
        "link": { "$$type": "link", "value": { "destination": { "$$type": "url", "value": "/signup" }, "tag": { "$$type": "string", "value": "a" } } },
        "classes": { "$$type": "classes", "value": [] }
      },
      "styles": {}, "interactions": [], "editor_settings": [], "elements": [], "isInner": false, "version": "3.31.5"
    }
  ]
}
```

---

*Source files studied in `msrbuilds/elementor-mcp`: `includes/class-atomic-props.php`,
`includes/class-atomic-styles.php`, `includes/class-element-factory.php`,
`includes/abilities/class-atomic-widget-abilities.php`,
`includes/abilities/class-atomic-layout-abilities.php`,
`includes/validators/class-element-validator.php`,
`includes/class-elementor-data.php`,
`tests/unit/regression/AtomicDetectionRegressionTest.php`.*
