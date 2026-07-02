# Strudel Elementor Module — Global Kit Spec (for `strudel-ai-optimizer`)

Adds **Global Kit read/write** (site-wide colors + typography) to the existing
`strudel-elementor/v1` module. Same conventions as the first spec: procedural,
`strudel_elementor_*` prefixes, WP-capability auth, Elementor-guarded, graceful
`/capabilities` gating.

The MCP side consumes these and falls back cleanly when the feature is absent.

---

## 0. Why this needs PHP (not pure REST)

Elementor stores site-wide design tokens on the **active Kit** post
(`post_type = elementor_library`, `_elementor_template_type = kit`; id in option
`elementor_active_kit`). The tokens live in postmeta **`_elementor_page_settings`**
(a serialized array), NOT in `_elementor_data`. That meta is protected (core REST
won't write it), and — critically — a change only takes visual effect once the
**Kit's global CSS is regenerated**. Both require running inside WordPress.

Shape of the relevant keys inside `_elementor_page_settings`:

```php
'system_colors' => [
  ['_id'=>'primary',   'title'=>'Primary',   'color'=>'#6EC1E4'],
  ['_id'=>'secondary', 'title'=>'Secondary', 'color'=>'#54595F'],
  ['_id'=>'text',      'title'=>'Text',      'color'=>'#7A7A7A'],
  ['_id'=>'accent',    'title'=>'Accent',    'color'=>'#61CE70'],
],
'custom_colors' => [ ['_id'=>'a1b2c3d4','title'=>'Brand Red','color'=>'#E01E37'], ... ],
'system_typography' => [
  ['_id'=>'primary','title'=>'Primary',
   'typography_typography'=>'custom',
   'typography_font_family'=>'Roboto',
   'typography_font_weight'=>'600'],
  ... (secondary / text / accent)
],
'custom_typography' => [ ['_id'=>'e5f6...','title'=>'Quotes','typography_typography'=>'custom', ...], ... ],
```

The four system `_id`s are fixed: `primary`, `secondary`, `text`, `accent`.
Custom entries carry a random `_id`.

---

## 1. Capability flag

Add to the `/capabilities` `features` map and bump `module_version`:

```json
"features": { "regenerate_css": true, "widget_schemas": true, "global_kit": true }
```

---

## 2. Endpoints (under `strudel-elementor/v1`)

### 2.1 `GET /strudel-elementor/v1/global-kit`

Read the active kit's tokens so the agent/MCP can see current state and round-trip
edits (returns the writable `_id`s).

- **Permission:** `edit_posts`
- **Response:**
```json
{
  "kit_id": 1234,
  "colors": {
    "system": [ { "_id":"primary","title":"Primary","color":"#6EC1E4" }, ... ],
    "custom": [ { "_id":"a1b2c3d4","title":"Brand Red","color":"#E01E37" } ]
  },
  "typography": {
    "system": [ { "_id":"primary","title":"Primary","font_family":"Roboto","font_weight":"600" }, ... ],
    "custom": [ ... ]
  }
}
```
Map Elementor's `typography_font_family`/`typography_font_weight`/… back to the
flat `font_family`/`font_weight`/… names in the response (drop the `typography_`
prefix; only include keys that are set).

### 2.2 `POST /strudel-elementor/v1/global-kit`

Partial, merge-based update. Anything omitted is left untouched.

- **Permission:** `manage_options` (site-wide change).
- **Body** (all fields optional; send only what you're changing):
```json
{
  "colors": {
    "system": [ { "_id":"primary", "color":"#0B5FFF" }, { "_id":"accent", "color":"#E01E37" } ],
    "custom": [ { "title":"Brand Ink", "color":"#101828" }, { "_id":"a1b2c3d4", "color":"#CC0000" } ]
  },
  "typography": {
    "system": [ { "_id":"primary", "font_family":"Inter", "font_weight":"700" } ],
    "custom": [ { "title":"Quotes", "font_family":"Georgia", "font_weight":"400" } ]
  }
}
```

- **Merge semantics:**
  - `colors.system[]` / `typography.system[]`: match by `_id` (must be one of
    primary/secondary/text/accent) and overwrite the given fields; leave others.
  - `colors.custom[]` / `typography.custom[]`: if `_id` given and exists → update;
    else create a new entry with a generated `_id` (`wp_generate_uuid4()` or an
    8-char hex) and the given `title`. `title` is required when creating.
  - Typography: map flat input → Elementor field names, and always set
    `typography_typography = 'custom'` on any typography entry you touch (without
    it Elementor ignores the values). Supported flat keys → Elementor keys:
    `font_family→typography_font_family`, `font_weight→typography_font_weight`,
    `font_size→typography_font_size` (object `{unit,size}`, unit default `px`),
    `line_height→typography_line_height`, `letter_spacing→typography_letter_spacing`,
    `text_transform→typography_text_transform`, `font_style→typography_font_style`.

- **Sanitization:** colors — accept `#hex` and `rgba(...)` (validate, reject
  anything else); font family/weight/transform — `sanitize_text_field`; sizes —
  numeric coercion. Reject unknown system `_id`s with a 400.

- **Persist + regenerate (must do both):**
```php
$kit_id = get_option( 'elementor_active_kit' );
$settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
$settings = is_array( $settings ) ? $settings : [];
// ... merge colors/typography into $settings ...
update_post_meta( $kit_id, '_elementor_page_settings', $settings );

// Regenerate the kit's global CSS so the change takes visual effect.
if ( class_exists( '\Elementor\Core\Files\CSS\Post' ) ) {
    $css = \Elementor\Core\Files\CSS\Post::create( $kit_id );
    $css->delete(); $css->update();
}
\Elementor\Plugin::$instance->files_manager->clear_cache(); // global, to flush dependent pages
```
> Prefer the kit document API if you're comfortable with it
> (`\Elementor\Plugin::$instance->kits_manager->get_active_kit()` →
> `update_settings()`), which handles validation/CSS internally. The raw-meta path
> above is the robust fallback. Either way, end with a global cache clear.

- **Response:**
```json
{ "updated": true, "kit_id": 1234, "regenerated": true,
  "changed": { "colors_system": 2, "colors_custom": 1, "typography_system": 1, "typography_custom": 1 } }
```

---

## 3. Release checklist

1. Bump `Version:` header + `STRUDELAI_VERSION` (kept in sync).
2. CHANGELOG entry.
3. Rebuild + redeploy backend so PUC serves the new zip.

---

## 4. What the MCP side will do (no action needed in the plugin)

- Gate on `capabilities.features.global_kit`.
- `wp_elementor_get_global_kit` (reads 2.1) and `wp_elementor_update_global_kit`
  (writes 2.2). The update tool needs no separate CSS-regen call — the endpoint
  regenerates server-side.
- Add a line to the server `instructions` map: "site-wide colors/fonts →
  wp_elementor_update_global_kit" so the agent reaches for it instead of editing
  each widget's color by hand.

---

## 5. E2E to run after deploy (on the strudel test site)

```
GET  /global-kit                                  -> current system+custom tokens
POST /global-kit {"colors":{"system":[{"_id":"accent","color":"#E01E37"}]}}
     -> {"updated":true,"regenerated":true}, and the accent color changes site-wide
POST /global-kit {"typography":{"system":[{"_id":"primary","font_family":"Inter","font_weight":"700"}]}}
     -> primary headings switch to Inter 700
POST /global-kit {"colors":{"system":[{"_id":"nope","color":"#000"}]}}  -> 400 (bad _id)
POST /global-kit {"colors":{"system":[{"_id":"text","color":"notacolor"}]}} -> 400 (bad color)
```
