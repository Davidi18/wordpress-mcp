# Elementor 4.0 Atomic Elements — Examples for Building Agents

This is the reference to hand to an agent that builds Elementor 4.0 ("atomic" /
V4) pages through this MCP server. It answers the common "I don't know the
schema, I need to see an example" blocker.

There are **two ways** to build. Prefer the first.

---

## Way 1 (recommended): `wp_elementor_add_atomic` — flat params, no schema needed

With this tool the agent does **not** need to know the `$$type` JSON at all — it
passes plain values and the server builds valid atomic JSON for it.

**Before building**, check support once:

```
wp_elementor_capabilities   →   look at the `atomic` field:
  { "supported": true, "registered_types": ["e-flexbox","e-div-block"], ... }
```

If `atomic.supported` is `false`, atomic elements won't persist — enable the
"Atomic Elements" / V4 experiment in Elementor → Settings → Features. If the
`atomic` field says the probe route isn't installed, run
`wp_bootstrap_elementor_writer` once.

### Build a centered hero (container + 3 widgets)

1) Add the flexbox container:

```json
{
  "tool": "wp_elementor_add_atomic",
  "args": {
    "page_id": 123,
    "element_type": "e-flexbox",
    "tag": "section",
    "direction": "column",
    "align": "center",
    "gap": 20,
    "padding": 80,
    "background_color": "#0f172a",
    "position": "end"
  }
}
```

The response includes `element_id` — e.g. `"db4f9f79"`. Use it as the parent.

2) Add a heading inside it:

```json
{
  "tool": "wp_elementor_add_atomic",
  "args": {
    "page_id": 123,
    "element_type": "e-heading",
    "title": "Welcome",
    "tag": "h1",
    "position": { "parent_id": "db4f9f79", "position": "end" }
  }
}
```

3) A paragraph, then a button (same `parent_id`):

```json
{ "tool": "wp_elementor_add_atomic", "args": {
  "page_id": 123, "element_type": "e-paragraph",
  "content": "Atomic building works.",
  "position": { "parent_id": "db4f9f79", "position": "end" } } }
```

```json
{ "tool": "wp_elementor_add_atomic", "args": {
  "page_id": 123, "element_type": "e-button",
  "text": "Get started", "link": "/signup", "target_blank": true,
  "position": { "parent_id": "db4f9f79", "position": "end" } } }
```

### Supported `element_type` values + their params

| element_type | Params |
|---|---|
| `e-flexbox` | `tag`, `direction`, `justify`, `align`, `wrap`, `gap`(+`gap_unit`), `padding`(+`padding_unit`), `background_color`, `color`, `min_height`, `width`, `border_radius`, `css_id` |
| `e-div-block` | `tag`, `padding`, `background_color`, `color`, `width`, `min_height`, `border_radius`, `css_id` |
| `e-heading` | `title`, `tag` (h1–h6), `link`, `css_id` |
| `e-paragraph` | `content`, `link`, `css_id` |
| `e-button` | `text`, `link`, `target_blank`, `css_id` |
| `e-image` | `image_id` or `image_url`, `alt`, `link`, `css_id` |
| `e-svg` | `svg_id` or `svg_url`, `css_id` |
| `e-youtube` | `video_url`, `css_id` |
| `e-self-hosted-video` | `video_url`, `css_id` |
| `e-divider` | `css_id` |

Reading back: `wp_elementor_get_widget_settings` returns `settings_readable`
(flattened values) and `is_atomic:true` for V4 elements, so the agent never has
to parse `$$type` envelopes to inspect a page.

---

## Way 2 (advanced): hand-write `_elementor_data` JSON

Only needed if the agent writes raw `_elementor_data` (e.g. via
`wp_elementor_update_page`). It must emit the exact atomic shape. Below is a
**complete, valid** example: an `e-flexbox` hero with heading + paragraph +
button. (`version` should match the site's Elementor version; see
`wp_elementor_capabilities` → `atomic.elementor_version`.)

### The `$$type` cheat-sheet

Every settings value is `{ "$$type": "<type>", "value": <payload> }`:

| `$$type` | `value` |
|---|---|
| `string` | `"text"` |
| `number` | `42` |
| `boolean` | `true` |
| `size` | `{ "size": 24, "unit": "px" }` |
| `url` | `"https://…"` |
| `link` | `{ "destination": <url>, "tag": <string "a">, "isTargetBlank?": <boolean> }` |
| `html-v3` | `{ "content": <string>, "children": [] }` |
| `classes` | `[ "class-id", … ]` |
| `image` | `{ "src": { "id": <number>, "url": <url> } }` |

Rules: atomic widgets keep `elType:"widget"` with an `e-`-prefixed `widgetType`;
atomic containers use `elType:"e-flexbox"`/`"e-div-block"`. Both carry the extra
top-level keys `styles`, `interactions`, `editor_settings`, `version`, and
`isInner`. Styling lives in `styles` (a local class), referenced by id from
`settings.classes.value` — not inline in `settings`.

### Full worked example (copy-paste)

```json
[
  {
    "id": "db4f9f79",
    "elType": "e-flexbox",
    "settings": {
      "tag": { "$$type": "string", "value": "section" },
      "classes": { "$$type": "classes", "value": ["e-db4f9f79-858908f"] }
    },
    "styles": {
      "e-db4f9f79-858908f": {
        "id": "e-db4f9f79-858908f",
        "label": "local",
        "type": "class",
        "variants": [
          {
            "meta": { "breakpoint": "desktop", "state": null },
            "props": {
              "flex-direction":  { "$$type": "string", "value": "column" },
              "align-items":     { "$$type": "string", "value": "center" },
              "gap":             { "$$type": "size", "value": { "size": 20, "unit": "px" } },
              "padding-block-start":  { "$$type": "size", "value": { "size": 80, "unit": "px" } },
              "padding-block-end":    { "$$type": "size", "value": { "size": 80, "unit": "px" } },
              "padding-inline-start": { "$$type": "size", "value": { "size": 80, "unit": "px" } },
              "padding-inline-end":   { "$$type": "size", "value": { "size": 80, "unit": "px" } },
              "background-color": { "$$type": "string", "value": "#0f172a" }
            },
            "custom_css": null
          }
        ]
      }
    },
    "interactions": [],
    "editor_settings": [],
    "version": "3.31.5",
    "isInner": false,
    "elements": [
      {
        "id": "a44a92cc",
        "elType": "widget",
        "widgetType": "e-heading",
        "settings": {
          "title": { "$$type": "html-v3", "value": { "content": { "$$type": "string", "value": "Welcome" }, "children": [] } },
          "tag":   { "$$type": "string", "value": "h1" },
          "classes": { "$$type": "classes", "value": [] }
        },
        "styles": {}, "interactions": [], "editor_settings": [], "version": "3.31.5", "isInner": false, "elements": []
      },
      {
        "id": "434e9b80",
        "elType": "widget",
        "widgetType": "e-paragraph",
        "settings": {
          "paragraph": { "$$type": "html-v3", "value": { "content": { "$$type": "string", "value": "Atomic building works." }, "children": [] } },
          "classes": { "$$type": "classes", "value": [] }
        },
        "styles": {}, "interactions": [], "editor_settings": [], "version": "3.31.5", "isInner": false, "elements": []
      },
      {
        "id": "c1d2e3f4",
        "elType": "widget",
        "widgetType": "e-button",
        "settings": {
          "text": { "$$type": "html-v3", "value": { "content": { "$$type": "string", "value": "Get started" }, "children": [] } },
          "link": { "$$type": "link", "value": { "destination": { "$$type": "url", "value": "/signup" }, "tag": { "$$type": "string", "value": "a" }, "isTargetBlank": { "$$type": "boolean", "value": true } } },
          "classes": { "$$type": "classes", "value": [] }
        },
        "styles": {}, "interactions": [], "editor_settings": [], "version": "3.31.5", "isInner": false, "elements": []
      }
    ]
  }
]
```

### Gotchas the agent must respect

- **Detection is not a version check.** A site can run atomic while
  `ELEMENTOR_VERSION` reports `3.x`. Trust `wp_elementor_capabilities.atomic`.
- **If atomic isn't active, raw writes are silently dropped** by Elementor on
  save. Way 1's pre-check guards this; for raw writes, verify the result.
- **All ids are 8-char hex**; local-class ids are `e-<elementId>-<7hex>` and must
  appear both in `settings.classes.value` and as a key under `styles`.
- **Don't put styling in `settings`** — colors/spacing/layout go in the `styles`
  local class, addressed by logical CSS props (`padding-block-start`, etc.).
