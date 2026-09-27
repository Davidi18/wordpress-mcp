// Server-level guidance surfaced to the model at `initialize` (MCP `instructions`).
// This is always in the agent's context, so it's where we prevent the
// "one hammer for every nail" failure: with 100+ tools an agent tends to fall
// back on fetch-whole-page + rewrite-JSON for everything. This gives it the
// decision tree instead. Keep it a concise PLAYBOOK, not a catalog — tools/list
// is the catalog.
export const SERVER_INSTRUCTIONS = `WordPress + Elementor control plane. Multi-client: if more than one client is configured, pass a \`client\` argument on every call.

ELEMENTOR EDITING — follow this workflow instead of hand-editing page JSON:

1. ORIENT (once per site): call wp_elementor_capabilities. It reports Elementor version, Pro, atomic (V4) support, and strudel_module (whether the server-side module for live widget schemas + CSS regen is installed). Decide classic vs atomic, Pro vs free, from this — don't assume.

2. LOCATE by id — never guess ids:
   - wp_elementor_get_page_structure = cheap map of the whole tree (ids, types, text snippets), no heavy settings.
   - wp_elementor_find_widgets = search by widgetType / contained text / settings match.
   - wp_elementor_get_widget_settings = full settings of one element; wp_elementor_get_widget_schema = which setting keys a widget type accepts (use before authoring an unfamiliar widget).

3. EDIT SURGICALLY — pick the tool that fits the job (do NOT download the page and rewrite _elementor_data by hand for small edits):
   - one element's settings ......... wp_elementor_update_widget
   - many elements in one write ...... wp_elementor_batch_update_widgets  (cheaper + atomic; prefer over calling update_widget in a loop)
   - move an element ................. wp_elementor_move_element
   - reorder siblings ............... wp_elementor_reorder_children
   - clone an element ............... wp_elementor_duplicate_widget
   - add a widget / a curated block .. wp_elementor_insert_widget / wp_elementor_insert_block
   - add a V4 atomic element ......... wp_elementor_add_atomic
   - delete an element .............. wp_elementor_remove_element
   - find/replace text page-wide .... wp_replace_text

4. Match the brand: wp_elementor_guidelines returns the site's colors/typography/spacing tokens — read it before inventing values.

5. SAFETY: every mutating Elementor tool returns \`previous_state\` and verifies the written byte length. To undo, pass that state to wp_restore_page_state. Elementor CSS is regenerated automatically after each write (via the Strudel module when present) — no manual regeneration step needed.

ACF FIELDS: read current values first with wp_get_post / wp_get_page / wp_get_custom_post and include: ["acf"]. Write them with the \`acf\` argument of wp_update_post / wp_update_page / wp_update_custom_post, or \`updates.acf\` in wp_bulk_update_posts (many posts). Never write ACF fields through \`meta\` — it can return 200 without changing the ACF value. ACF writes are read back and fail loudly if not stored.

HISTORY: every write through this server is logged. To see what changed on a site or post (and the previous values), call wp_audit_log — it needs no client argument.

Anti-pattern to avoid: fetching a whole page and re-writing _elementor_data for a change a surgical tool already covers. The surgical tools preserve element ids, are cheaper, roll back, and self-verify.`;
