// toolsets.js
// Expose a subset of the tool catalog per connector. With 120+ tools some MCP
// hosts truncate or drop part of tools/list, so an agent silently loses tools.
// Pick toolsets per connector URL (`/mcp?toolsets=content,seo`) or globally via
// MCP_TOOLSETS. No selection = every tool (backwards compatible).
//
// Filtering applies to tools/list only; tools/call still accepts any tool, so a
// narrowed connector never breaks an agent that already knows a tool name.

export const TOOLSETS = ['core', 'content', 'seo', 'woo', 'elementor', 'admin'];

const ELEMENTOR_EXTRA = new Set([
  'wp_bootstrap_elementor_writer',
  'wp_publish_draft_over',
  'wp_replace_text',
  'wp_get_page_state',
  'wp_restore_page_state'
]);

const ADMIN = new Set([
  'wp_create_file',
  'wp_bootstrap_file_api',
  'wp_check_file_api',
  'wp_bootstrap_plugin_installer'
]);

const CORE = new Set(['wp_list_clients', 'wp_refresh_clients', 'wp_get_site_info']);

export function toolsetOf(name) {
  if (CORE.has(name)) return 'core';
  if (name.startsWith('wc_')) return 'woo';
  if (name.startsWith('wp_elementor_') || ELEMENTOR_EXTRA.has(name)) return 'elementor';
  if (/^wp_(rankmath|yoast)_/.test(name) || /^wp_(get|create)_redirects?$/.test(name)) return 'seo';
  if (ADMIN.has(name) || /_(plugin|plugins|plugin_zip|snippet|snippets)$/.test(name)) return 'admin';
  return 'content';
}

// Accepts "content,seo" / ["content","seo"] / "all" / empty. Returns a Set of
// toolset names, or null for "everything". Unknown names throw so a typo in a
// connector URL fails loudly instead of silently hiding tools.
export function parseToolsets(value) {
  if (value === undefined || value === null) return null;
  const parts = (Array.isArray(value) ? value : String(value).split(','))
    .map(s => String(s).trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0 || parts.includes('all')) return null;
  const unknown = parts.filter(p => !TOOLSETS.includes(p));
  if (unknown.length) {
    throw new Error(`Unknown toolset(s): ${unknown.join(', ')}. Valid: ${TOOLSETS.join(', ')}, all.`);
  }
  return new Set(['core', ...parts]);
}

export function filterTools(tools, selected) {
  if (!selected) return tools;
  return tools.filter(t => selected.has(toolsetOf(t.name)));
}
