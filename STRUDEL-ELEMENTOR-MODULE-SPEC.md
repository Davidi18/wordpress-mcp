# Strudel Elementor Module — Implementation Spec (for `strudel-ai-optimizer`)

This spec describes a **new Elementor module** to add to the `strudel-ai-optimizer`
WordPress plugin. It is written to match the plugin's existing conventions
(procedural, manual `require_once`, `strudel_*` prefixes, WP-capability auth,
Elementor-not-assumed).

The MCP side (`wordpress-mcp`) will consume these endpoints and **fall back to the
existing pure-REST path when the module is absent**, so nothing breaks on sites
without an up-to-date plugin.

---

## 0. Guiding principles

1. **Additive & isolated.** New module in its own directory, loaded only when
   Elementor is present. Zero impact on the AI/Schema modules or on sites without
   Elementor.
2. **Graceful degradation is the MCP's job, presence-signalling is yours.** Every
   endpoint must be cheaply *probeable* so the MCP can decide rich-path vs. REST
   fallback. A single capability endpoint (below) reports what's available.
3. **Capabilities, not new auth.** Reuse the plugin's existing model: WP
   `current_user_can()` checks, driven by Application Password Basic auth. No new
   API keys.
4. **Version-robust against Elementor drift.** Wrap every Elementor internal call
   in `class_exists` / `method_exists` guards with a documented fallback.

---

## 1. Module wiring

**New directory:** `elementor/` (top-level, mirroring `schema/`).

Files:
- `elementor/rest.php`   — route registration + handlers
- `elementor/core.php`   — Elementor helper functions (CSS regen, widget introspection)

**Main plugin file (`strudel-ai-optimizer.php`)** — add a *guarded* load next to the
other `require_once` calls:

```php
// Elementor module — only when Elementor is active on the site.
add_action( 'elementor/loaded', function () {
    require_once STRUDELAI_PATH . 'elementor/core.php';
    require_once STRUDELAI_PATH . 'elementor/rest.php';
} );
```

> If there is no `STRUDELAI_PATH` constant, use `plugin_dir_path( __FILE__ )`.
> Guarding on the `elementor/loaded` action (rather than a bare `require`) ensures
> Elementor's classes are loaded before our handlers reference them.

**Prefixes:** functions `strudel_elementor_*`, any constants `STRUDEL_ELEMENTOR_*`.

**Namespace (REST):** `strudel-elementor/v1` — separate from `strudel-schema/v1` so
the module is self-contained and independently probeable.

---

## 2. Endpoints

### 2.1 Capability probe — `GET /strudel-elementor/v1/capabilities`

The MCP calls this once to learn what the module offers.

- **Permission:** `edit_posts`
- **Response:**
```json
{
  "module_version": "1",
  "elementor_version": "3.25.4",
  "elementor_pro": false,
  "features": {
    "regenerate_css": true,
    "widget_schemas": true
  }
}
```
Notes: `module_version` is a small integer we bump when the contract changes (independent
of the plugin's semver). `features` lets us ship endpoints incrementally.

---

### 2.2 Slice 1 — `POST /strudel-elementor/v1/regenerate-css`

Fixes a real correctness bug: when the MCP writes `_elementor_data` over core REST,
Elementor's per-post CSS file is left stale. This regenerates it server-side.

- **Permission:** `current_user_can( 'edit_post', post_id )`
- **Body:**
```json
{ "post_id": 123, "scope": "post" }
```
`scope`: `"post"` (default) regenerates just that post; `"all"` clears the global
Elementor cache (heavy — only when the MCP explicitly asks, e.g. after a global-kit write).

- **Handler logic (`scope: "post"`):**
```php
if ( ! class_exists( '\Elementor\Core\Files\CSS\Post' ) ) {
    // Fallback: drop the cached CSS meta so Elementor rebuilds on next view.
    delete_post_meta( $post_id, '_elementor_css' );
    return [ 'regenerated' => true, 'method' => 'meta_clear' ];
}
$css = \Elementor\Core\Files\CSS\Post::create( $post_id );
$css->delete();   // remove stale file + meta
$css->update();   // regenerate now
return [ 'regenerated' => true, 'method' => 'post_css' ];
```

- **Handler logic (`scope: "all"`):** requires `manage_options`.
```php
\Elementor\Plugin::$instance->files_manager->clear_cache();
return [ 'regenerated' => true, 'method' => 'global' ];
```

- **Response:**
```json
{ "regenerated": true, "method": "post_css", "post_id": 123, "elementor_version": "3.25.4" }
```

---

### 2.3 Slice 2 — Widget schema discovery

Closes the biggest gap vs. the reference `elementor-mcp`: over pure REST the MCP
cannot see which widgets a site actually has, or their control schemas. Server-side
we can, via Elementor's live widget registry.

#### `GET /strudel-elementor/v1/widgets`
- **Permission:** `edit_posts`
- **Query:** `?search=`, `?category=` (optional filters)
- **Handler:** iterate `\Elementor\Plugin::$instance->widgets_manager->get_widget_types()`,
  return **lightweight metadata only** (no controls — keep the payload small):
```php
foreach ( $widgets as $name => $w ) {
    $out[] = [
        'name'       => $w->get_name(),
        'title'      => $w->get_title(),
        'categories' => $w->get_categories(),
        'keywords'   => $w->get_keywords(),
        'icon'       => $w->get_icon(),
        'is_pro'     => strpos( get_class( $w ), 'ElementorPro' ) !== false,
    ];
}
```
- **Cache:** wrap the full list in a transient (`strudel_elementor_widget_index`,
  TTL ~1h) keyed by Elementor version — instantiating every widget is not free.
  Invalidate on `elementor/init` version change is unnecessary; TTL is enough.

#### `GET /strudel-elementor/v1/widgets/{name}`
- **Permission:** `edit_posts`
- **Query:** `?tab=content` (default) returns only content-tab controls — the ones an
  AI needs to author a widget; `?tab=all` returns everything (style/advanced too).
- **Handler:** resolve the single widget, call `get_controls()`, and **flatten to an
  AI-friendly schema**: for each control emit `{ name, type, label, default, options }`.
  Skip section/tab separators. Respect the `tab` filter via each control's `tab` key.
- **Response shape:**
```json
{
  "name": "heading",
  "title": "Heading",
  "controls": [
    { "name": "title", "type": "text", "label": "Title", "default": "Add Your Heading Text Here" },
    { "name": "header_size", "type": "select", "label": "HTML Tag", "default": "h2",
      "options": { "h1": "H1", "h2": "H2", "h3": "H3" } }
  ]
}
```

---

## 3. Release checklist (per Chuck's Q1–Q3)

Because clients only receive changes after a version bump + backend redeploy:

1. Bump **both** `Version:` header and `define('STRUDELAI_VERSION', ...)` — keep synced.
2. Add a `CHANGELOG.md` entry (shown in WP "View details").
3. Rebuild + redeploy the backend Docker image (`ai-api.strudel.marketing`) so PUC
   serves the new zip.

---

## 4. Future (not this slice)

- **Fold the privileged writer into the plugin.** Today the MCP installs
  `agency-os/v1/elementor-data` (protected-meta writer) + `elementor-atomic-status`
  via the *Code Snippets* plugin. Once this module is deployed, it can register those
  same routes, so Strudel-equipped sites need no Code Snippets bootstrap at all. The
  MCP already prefers a present route and falls back otherwise, so this is a drop-in
  upgrade.
- **Global Kit writes** (colors / typography) through Elementor's Kit API, with CSS
  regen via `scope: "all"`.
- **Template Manager** save/apply, and (Pro) dynamic tags / theme builder / global
  classes.

---

## 5. What the MCP side will do (for context — no action needed in the plugin)

- Extend its capability check to probe `GET /strudel-elementor/v1/capabilities`.
- After every successful `_elementor_data` write (`wp_elementor_update_page`,
  `insert_widget`, `update_widget`, `add_atomic`, `publish_draft_over`), call
  `regenerate-css` for that post when the feature is present; skip silently otherwise.
- Add `wp_elementor_list_widget_types` / `wp_elementor_get_widget_schema` tools backed
  by 2.3, used only when the module is present.
