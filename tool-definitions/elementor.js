// MCP tool definitions — "elementor" toolset (see toolsets.js). Handlers live in executeTool.
import { ATOMIC_WIDGET_TYPES, ATOMIC_CONTAINER_TYPES } from '../elementor-atomic.js';

export default [
  {
    name: 'wp_bootstrap_elementor_writer',
    description: 'Install the privileged Elementor routes (agency-os/v1/elementor-data for writes + agency-os/v1/elementor-atomic-status for Elementor 4.0 atomic-support detection) as an ACTIVE Code Snippet — no mu-plugin and no file write required. This is the recommended way to enable reliable _elementor_data writes (core REST refuses to write that protected meta) and to let wp_elementor_capabilities report whether atomic/V4 elements will persist. Idempotent: re-running updates the snippet in place. Requires the "Code Snippets" plugin.',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Reinstall/refresh the snippet even if the route already responds', default: false }
      }
    }
  },
  // ELEMENTOR (7 endpoints)
  {
    name: 'wp_elementor_get_page',
    description: 'Get a WordPress page with full Elementor data (_elementor_data meta). Returns the complete page object including Elementor widgets/sections.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_get_page_by_slug',
    description: 'Find a page ID by its slug (URL-friendly name)',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The page slug to find' }
      },
      required: ['slug']
    }
  },
  {
    name: 'wp_elementor_create_page',
    description: 'Create a new WordPress page with Elementor data',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        status: { type: 'string', description: 'Page status (publish, draft, pending, private)', default: 'draft' },
        content: { type: 'string', description: 'Standard WordPress content (optional)' },
        elementor_data: { type: 'string', description: 'Elementor page data as JSON string' }
      },
      required: ['title', 'elementor_data']
    }
  },
  {
    name: 'wp_elementor_update_page',
    description: 'Update an existing page with Elementor data',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        title: { type: 'string', description: 'Page title' },
        status: { type: 'string', description: 'Page status' },
        content: { type: 'string', description: 'Standard WordPress content' },
        elementor_data: { type: 'string', description: 'Elementor page data as JSON string' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_delete_page',
    description: 'Delete a WordPress page (Elementor or regular)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_download_page',
    description: 'Download a page and save it to a local file. Can save full page or only Elementor data.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        file_path: { type: 'string', description: 'Absolute path to save the file' },
        only_elementor_data: { type: 'boolean', description: 'Save only _elementor_data (not full page object)', default: false }
      },
      required: ['id', 'file_path']
    }
  },
  {
    name: 'wp_elementor_update_from_file',
    description: 'Update a page with Elementor data read from a local file',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        elementor_file_path: { type: 'string', description: 'Absolute path to the Elementor data JSON file' },
        title: { type: 'string', description: 'Page title (optional)' },
        status: { type: 'string', description: 'Page status (optional)' },
        content_file_path: { type: 'string', description: 'Absolute path to content file (optional)' }
      },
      required: ['id', 'elementor_file_path']
    }
  },
  {
    name: 'wp_elementor_list_templates',
    description: 'List Elementor templates (saved sections, pages, global widgets) from the Elementor Library',
    inputSchema: {
      type: 'object',
      properties: {
        template_type: { type: 'string', description: 'Filter by type: page, section, global, kit, container' },
        per_page: { type: 'number', description: 'Results per page', default: 20 },
        status: { type: 'string', description: 'Template status (publish, draft)', default: 'publish' }
      }
    }
  },
  {
    name: 'wp_elementor_get_template',
    description: 'Get a specific Elementor template by ID (includes _elementor_data)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Template ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_list_revisions',
    description: 'List revisions for a page — useful for comparing versions or rolling back Elementor changes',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        per_page: { type: 'number', description: 'Number of revisions to return', default: 10 }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_elementor_list_blocks',
    description: 'List curated, professionally-designed Elementor blocks/templates that can be inserted into a page. Use this BEFORE building a layout from scratch — pick a block here and insert it instead of hand-crafting widgets. Categories include: about, contact, homepage, landing-page, pricing, portfolio, coming-soon.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (about, contact, homepage, landing-page, pricing, portfolio, coming-soon)' }
      }
    }
  },
  {
    name: 'wp_elementor_get_block',
    description: 'Get the full Elementor JSON for a curated block by id (returned from wp_elementor_list_blocks). Use this to preview structure before inserting, or to extract sections for a custom composition.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: { type: 'string', description: 'Block id from wp_elementor_list_blocks (e.g. "obfx/contact-us")' }
      },
      required: ['block_id']
    }
  },
  {
    name: 'wp_elementor_capabilities',
    description: 'Discover what Elementor features are available on the site BEFORE building. Returns: elementor_version, elementor_pro (active + version), active_kit_id, container_experiment_likely (heuristic based on version), atomic (whether Elementor 4.0 atomic/V4 elements like e-flexbox/e-heading are supported and will persist — authoritative when the probe route from wp_bootstrap_elementor_writer is installed), and detected popular Elementor addon plugins (UAE, Essential Addons, JetEngine, etc.). Use this to decide whether to use Pro-only widgets, atomic V4 elements (wp_elementor_add_atomic), or fall back to classic/Free alternatives.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wp_elementor_guidelines',
    description: 'Return the site\'s Elementor design guidelines: color palette, typography, layout constants, and observed common patterns. Use this BEFORE creating/modifying widgets so new content matches the site\'s style instead of using default-ugly values. Pulls from the active Elementor Kit (Site Settings) and optionally analyzes recent pages.',
    inputSchema: {
      type: 'object',
      properties: {
        include_observed: { type: 'boolean', description: 'Also analyze recent pages to surface commonly-used colors/fonts/weights', default: true },
        sample_size: { type: 'number', description: 'Number of recent pages to analyze for observed patterns', default: 10 }
      }
    }
  },
  {
    name: 'wp_elementor_insert_block',
    description: 'Insert a curated block into an existing page. Fetches the block, regenerates element ids to avoid collisions, and appends (or inserts at the given position) into the page _elementor_data. Use this instead of hand-writing widget JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Target page id' },
        block_id: { type: 'string', description: 'Block id from wp_elementor_list_blocks' },
        position: { type: 'string', description: 'Insert position: "end" (default), "start", or a zero-based index as string', default: 'end' }
      },
      required: ['page_id', 'block_id']
    }
  },
  // ── STRUDEL ELEMENTOR MODULE — server-side Elementor APIs (plugin v0.6.0+) ──
  // These wrap the strudel-elementor/v1 endpoints from the Strudel AI Optimizer
  // plugin. They only work on sites running that plugin with Elementor active;
  // otherwise they return a clear "module unavailable" status instead of failing.
  {
    name: 'wp_elementor_regenerate_css',
    description: 'Regenerate Elementor\'s cached CSS for a page after its _elementor_data was written. Core REST writes to _elementor_data leave Elementor\'s per-post CSS file stale, so style/layout changes may not show until an editor re-save. This forces a server-side regeneration via the Strudel Elementor module. Requires the Strudel AI Optimizer plugin (v0.6.0+) with Elementor active — returns { regenerated:false, reason } when unavailable (safe no-op). Use scope:"all" (admin-only) after a global Kit/colors/typography change.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page/post id whose Elementor CSS to regenerate' },
        scope: { type: 'string', enum: ['post', 'all'], description: '"post" (default) regenerates just this page; "all" clears the global Elementor CSS cache (requires manage_options).', default: 'post' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'wp_elementor_list_widget_types',
    description: 'List the Elementor widget types actually registered on this site (core, Pro, and addon-pack widgets), with title, categories, keywords and an is_pro flag. Unlike the curated block library, this reflects the live registry — use it to discover what widgets are available before authoring. Requires the Strudel AI Optimizer plugin (v0.6.0+) with Elementor active.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional filter on widget name/title' },
        category: { type: 'string', description: 'Optional filter on widget category (e.g. "basic", "pro-elements")' }
      }
    }
  },
  {
    name: 'wp_elementor_get_widget_schema',
    description: 'Get the control schema for a single Elementor widget type from the live registry: each control\'s name, type, label, default, and options. Use this to learn exactly which settings keys a widget accepts before building it with wp_elementor_insert_widget. Defaults to content-tab controls (what you need to author); pass tab:"all" for style/advanced too. Requires the Strudel AI Optimizer plugin (v0.6.0+) with Elementor active.',
    inputSchema: {
      type: 'object',
      properties: {
        widget: { type: 'string', description: 'Widget type name from wp_elementor_list_widget_types (e.g. "heading", "button", "image")' },
        tab: { type: 'string', enum: ['content', 'all'], description: '"content" (default) returns only content-tab controls; "all" also returns style/advanced controls.', default: 'content' }
      },
      required: ['widget']
    }
  },
  // ── SURGICAL PRIMITIVES — address Elementor elements by id ──
  // Inspect, patch, duplicate, or insert a single element without touching the
  // rest of the page. Mutating tools return `previous_state` for rollback.
  {
    name: 'wp_elementor_get_page_structure',
    description: 'Return a compact navigable summary of a page\'s Elementor tree: every element\'s id, elType, widgetType, and a short text snippet — without the heavy `settings` payload. Use this BEFORE wp_elementor_update_widget / wp_elementor_duplicate_widget so you know which id to act on. Much cheaper than parsing the full _elementor_data. When the Strudel Elementor module (v0.8.0+) is installed the summary is built SERVER-SIDE and only a few KB cross the wire (avoids the timeouts seen on heavy pages); otherwise it falls back to a full-page read. `source` in the response is "strudel_module" or "core". The module path also returns a `widget_types` histogram.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        max_snippet_length: { type: 'number', description: 'Max chars per widget snippet (default 80) — core fallback path only', default: 80 },
        max_depth: { type: 'number', description: 'Limit tree depth (module path only). Nodes past the limit report children_count instead of expanding. Omit for the full tree.' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'wp_elementor_get_widget_settings',
    description: 'Read the full settings of a single Elementor element by id. Works for any element (widget, column, section, container) — use wp_elementor_get_page_structure first to find the id you need.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        element_id: { type: 'string', description: 'Element id (8-char hex from get_page_structure)' }
      },
      required: ['page_id', 'element_id']
    }
  },
  {
    name: 'wp_elementor_update_widget',
    description: 'Patch the settings of a single Elementor element (widget, section, column, or container). Default behavior is a SHALLOW merge into existing settings — settings_patch keys overwrite, untouched keys are preserved. Pass replace_settings:true to swap the entire settings object instead. Returns `previous_state` for rollback.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        element_id: { type: 'string', description: 'Element id' },
        settings_patch: { type: 'object', description: 'Settings to merge (or replace) into the element. Top-level keys overwrite existing same-named keys in the element\'s settings object.' },
        replace_settings: { type: 'boolean', description: 'If true, replace the settings object entirely instead of shallow-merging.', default: false }
      },
      required: ['page_id', 'element_id', 'settings_patch']
    }
  },
  {
    name: 'wp_elementor_duplicate_widget',
    description: 'Duplicate an element (widget, section, column, container) within the same page. Ids are regenerated for the clone and any descendants. Default position is "after" (right after the original, in the same parent). Use this for card-grid patterns: build one card, duplicate N times, then patch each copy.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        element_id: { type: 'string', description: 'Element id to duplicate' },
        position: { type: 'string', enum: ['after', 'before', 'start', 'end'], description: '"after" / "before" (relative to original, same parent), or "start" / "end" (of the parent container).', default: 'after' }
      },
      required: ['page_id', 'element_id']
    }
  },
  {
    name: 'wp_elementor_insert_widget',
    description: 'Insert a new Elementor element (typically a single widget) into a page at a precise location. Use this for surgical additions: a shortcode mid-page, an HTML widget with scoped CSS next to a target, an extra button in an existing column. For multi-section blocks, prefer wp_elementor_insert_block.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        widget: {
          type: 'object',
          description: 'Widget config: { widgetType: "shortcode" | "heading" | "button" | ... , settings: {...} }. elType defaults to "widget". Optional `elements: []` for nested children. id is auto-generated.'
        },
        position: {
          description: 'Insertion target. Strings "start" / "end" or an integer = root-level position. Object forms: { after_id: "abc12345" } / { before_id: "abc12345" } = sibling of that element; { parent_id: "col1", position: "end"|"start"|N } = inside that parent.'
        }
      },
      required: ['page_id', 'widget', 'position']
    }
  },
  {
    name: 'wp_elementor_find_widgets',
    description: 'Search a page\'s Elementor tree for widgets matching criteria, returning their ids, widgetType, ancestor-id chain, and a text snippet. Use this to LOCATE elements by what they are or contain (e.g. every "button", or the heading containing "Contact us") instead of eyeballing wp_elementor_get_page_structure. The returned ids feed wp_elementor_update_widget / _move_element / _remove_element / _duplicate_widget. Pure-REST — works on any Elementor site with no plugin needed.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        widget_type: { type: 'string', description: 'Exact widgetType to match (e.g. "heading", "button", "image")' },
        text_contains: { type: 'string', description: 'Case-insensitive substring to match against any text field (title, editor, button text, testimonial, tab titles, etc.)' },
        setting_equals: { type: 'object', description: 'Match widgets whose settings[key] strictly equals the given value, for each key/value pair provided.' }
      },
      required: ['page_id']
    }
  },
  {
    name: 'wp_elementor_move_element',
    description: 'Relocate an element (widget, column, section, or container) to a new place in the page, preserving its id and all children. Use this to restructure a page without rebuilding it — e.g. move a CTA section above the fold, or move a widget into a different column. Returns `previous_state` for rollback. Pure-REST — no plugin needed.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        element_id: { type: 'string', description: 'Id of the element to move' },
        position: {
          description: 'Destination. Strings "start"/"end" or an integer = root level. Object forms: { after_id: "abc12345" } / { before_id: "abc12345" } = sibling of that element; { parent_id: "col1", position: "end"|"start"|N } = inside that parent. The destination must not be inside the element being moved.'
        }
      },
      required: ['page_id', 'element_id', 'position']
    }
  },
  {
    name: 'wp_elementor_reorder_children',
    description: 'Reorder the direct children of a container/section/column (or the root-level sections) to match a given id order. Children you omit keep their relative order and follow the ones you listed. Ideal for re-sequencing cards in a grid or sections on a page after you know their ids (from wp_elementor_get_page_structure / _find_widgets). Returns `previous_state` for rollback. Pure-REST — no plugin needed.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        parent_id: { type: ['string', 'null'], description: 'Id of the container whose children to reorder. Pass null to reorder the root-level (top) sections/containers.' },
        order: { type: 'array', items: { type: 'string' }, description: 'Child element ids in the desired order. Ids not currently children are ignored; current children you omit are appended after, keeping their relative order.' }
      },
      required: ['page_id', 'order']
    }
  },
  {
    name: 'wp_elementor_remove_element',
    description: 'Delete an element (widget, column, section, or container) and all its children from a page by id. Returns `previous_state` so the removal can be undone with wp_restore_page_state. Pure-REST — no plugin needed. To find the id first, use wp_elementor_get_page_structure or wp_elementor_find_widgets.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        element_id: { type: 'string', description: 'Id of the element to remove' }
      },
      required: ['page_id', 'element_id']
    }
  },
  {
    name: 'wp_elementor_batch_update_widgets',
    description: 'Apply several element setting-patches to a page in ONE write (one fetch, one save, one rollback state) instead of calling wp_elementor_update_widget N times. Much cheaper and atomic for multi-element edits — e.g. recolor every button, or set text on each card in a duplicated grid. Each edit is a shallow merge by default (pass replace_settings:true per edit to swap the whole settings object). Returns `previous_state` for rollback. Pure-REST — no plugin needed.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        edits: {
          type: 'array',
          description: 'List of per-element edits, applied in order.',
          items: {
            type: 'object',
            properties: {
              element_id: { type: 'string', description: 'Element id to patch' },
              settings_patch: { type: 'object', description: 'Settings to merge (or replace) into the element' },
              replace_settings: { type: 'boolean', description: 'Replace the whole settings object instead of shallow-merging.', default: false }
            },
            required: ['element_id', 'settings_patch']
          }
        }
      },
      required: ['page_id', 'edits']
    }
  },
  {
    name: 'wp_elementor_add_atomic',
    description: 'Legacy/frozen: if the official Elementor MCP is connected (Elementor >= 4.3), prefer it for V4 atomic building. Add an Elementor 4.0 "atomic" (V4) element to a page using flat, AI-friendly params — no need to hand-write the $$type-wrapped JSON the atomic engine requires. Builds e-flexbox/e-div-block containers (with layout styles applied as a local style class) and atomic widgets (e-heading, e-paragraph, e-button, e-image, e-svg, e-youtube, e-self-hosted-video, e-divider). IMPORTANT: atomic elements only persist on sites where the atomic experiment is active — call wp_elementor_capabilities first (the `atomic` field) or rely on this tool\'s built-in pre-check (run wp_bootstrap_elementor_writer once so the check is authoritative). To nest widgets inside a container, add the container first, then add children with position:{ parent_id: <returned element_id> }.',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id' },
        element_type: {
          type: 'string',
          enum: [...ATOMIC_CONTAINER_TYPES, ...ATOMIC_WIDGET_TYPES],
          description: 'Atomic element type: e-flexbox | e-div-block (containers) or e-heading | e-paragraph | e-button | e-image | e-svg | e-youtube | e-self-hosted-video | e-divider (widgets).'
        },
        position: {
          description: 'Insertion target (default "end"). Strings "start"/"end" or integer = root level. Objects: { after_id } / { before_id } = sibling; { parent_id, position? } = inside a container.'
        },
        // Widget content
        title: { type: 'string', description: 'e-heading: heading text.' },
        content: { type: 'string', description: 'e-paragraph: paragraph text.' },
        text: { type: 'string', description: 'e-button: button label.' },
        tag: { type: 'string', description: 'HTML tag. Heading: h1–h6 (default h2). Containers: div/header/section/article/aside/footer (default div).' },
        link: { type: 'string', description: 'Optional URL for heading/paragraph/button/image.' },
        target_blank: { type: 'boolean', description: 'e-button: open link in a new tab.' },
        image_id: { type: 'number', description: 'e-image: WordPress media attachment id.' },
        image_url: { type: 'string', description: 'e-image: image URL (if not using a media id).' },
        alt: { type: 'string', description: 'e-image: alt text.' },
        svg_id: { type: 'number', description: 'e-svg: media attachment id.' },
        svg_url: { type: 'string', description: 'e-svg: SVG URL.' },
        video_url: { type: 'string', description: 'e-youtube: YouTube URL. e-self-hosted-video: video URL.' },
        css_id: { type: 'string', description: 'Optional CSS id attribute for the element.' },
        // Container layout/style params (applied as a local style class)
        direction: { type: 'string', description: 'e-flexbox: flex-direction (row|column|row-reverse|column-reverse).' },
        justify: { type: 'string', description: 'e-flexbox: justify-content (flex-start|center|flex-end|space-between|space-around|space-evenly).' },
        align: { type: 'string', description: 'e-flexbox: align-items (flex-start|center|flex-end|stretch|baseline).' },
        wrap: { type: 'string', description: 'e-flexbox: flex-wrap (nowrap|wrap|wrap-reverse).' },
        gap: { type: 'number', description: 'e-flexbox: gap between children.' },
        gap_unit: { type: 'string', description: 'Unit for gap (default px).' },
        padding: { type: 'number', description: 'Containers: padding on all sides.' },
        padding_unit: { type: 'string', description: 'Unit for padding (default px).' },
        background_color: { type: 'string', description: 'Containers: background color (hex/rgba).' },
        color: { type: 'string', description: 'Containers: text color.' },
        min_height: { type: 'number', description: 'Containers: min-height.' },
        width: { type: 'number', description: 'Containers: width.' },
        border_radius: { type: 'number', description: 'Containers: border-radius.' },
        version: { type: 'string', description: 'Optional Elementor version string to stamp on the element. Auto-filled from the site when the atomic probe route is installed.' },
        skip_atomic_check: { type: 'boolean', description: 'Skip the pre-write atomic-support check and build anyway. Default false.', default: false }
      },
      required: ['page_id', 'element_type']
    }
  },
  // ── CONTROL PLANE (publish-draft-over / replace-text / restore-page-state) ──
  // Pure REST — no plugin installation on the WordPress site required.
  // Stateless: destructive ops return a full `previous_state` in their response
  // so the caller can pass it back to wp_restore_page_state for rollback.
  {
    name: 'wp_publish_draft_over',
    description: 'Promote a draft on top of an existing canonical page: copy title/content/_elementor_data plus (by default) Elementor page settings, featured image, SEO meta (Yoast + RankMath), excerpt, template, and menu_order from the draft into the target page (preserving target id, URL, and status). Verifies the write, then permanently deletes the draft. Returns `previous_state` (the target\'s pre-write state) — hold on to it if you want to roll back via wp_restore_page_state. Use this to ship a redesign without changing the live URL.',
    inputSchema: {
      type: 'object',
      properties: {
        draft_id: { type: 'number', description: 'Source draft page id (will be deleted on success)' },
        target_id: { type: 'number', description: 'Live target page id (will be overwritten with draft content)' },
        copy_seo: { type: 'boolean', description: 'Also copy Yoast + RankMath SEO meta keys present on the draft', default: true },
        copy_featured_image: { type: 'boolean', description: 'Also copy featured_media id from draft', default: true },
        copy_taxonomies: { type: 'boolean', description: 'Also copy taxonomy term ids (categories, tags, custom tax) from draft', default: false },
        extra_meta_keys: { type: 'array', items: { type: 'string' }, description: 'Additional postmeta keys to copy from draft.meta (must be registered with show_in_rest)', default: [] }
      },
      required: ['draft_id', 'target_id']
    }
  },
  {
    name: 'wp_replace_text',
    description: 'Bulk find/replace across a page: post_content + Elementor widget text fields (title, editor HTML, button text, descriptions, captions, tab titles, testimonials, etc.). Skips dynamic-tag fields. Defaults to literal case-sensitive match; set regex=true or case_insensitive=true. Use dry_run=true to preview matches without writing. On a real (non-dry) write, returns `previous_state` (the page\'s pre-write state) — hold on to it for rollback via wp_restore_page_state.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'Page id' },
        find: { type: 'string', description: 'String to find (or regex pattern body if regex=true)' },
        replace: { type: 'string', description: 'Replacement string (default empty = deletion)', default: '' },
        regex: { type: 'boolean', description: 'Treat `find` as a JS regex pattern (without delimiters or flags)', default: false },
        case_insensitive: { type: 'boolean', description: 'Match case-insensitively', default: false },
        dry_run: { type: 'boolean', description: 'Report matches without writing', default: false }
      },
      required: ['post_id', 'find']
    }
  },
  {
    name: 'wp_get_page_state',
    description: 'Read a page and return a normalized, restore-able `state` object — exactly the shape that wp_restore_page_state accepts. Use this to capture a baseline before a multi-step edit you want to be able to undo.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'Page id to capture' }
      },
      required: ['post_id']
    }
  },
  {
    name: 'wp_restore_page_state',
    description: 'Write a previously-captured `state` object back onto a page. Restores title, content, excerpt, template, menu_order, featured_media, and the captured meta (Elementor + SEO keys). Verifies _elementor_data byte-length matches the input. Pair with `previous_state` returned by wp_publish_draft_over / wp_replace_text, or with the output of wp_get_page_state.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'number', description: 'Page id to restore onto (authoritative — overrides state.post_id)' },
        state: { type: 'object', description: 'State object: { title, content, excerpt, template, menu_order, featured_media, meta: { ... } }' }
      },
      required: ['post_id', 'state']
    }
  }
];
