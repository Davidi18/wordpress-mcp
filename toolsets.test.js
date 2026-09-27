import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTools, parseToolsets, toolsetOf } from './toolsets.js';

test('classifies tools by family', () => {
  assert.equal(toolsetOf('wc_list_orders'), 'woo');
  assert.equal(toolsetOf('wp_elementor_update_widget'), 'elementor');
  assert.equal(toolsetOf('wp_restore_page_state'), 'elementor');
  assert.equal(toolsetOf('wp_yoast_update_meta'), 'seo');
  assert.equal(toolsetOf('wp_create_redirect'), 'seo');
  assert.equal(toolsetOf('wp_install_plugin_zip'), 'admin');
  assert.equal(toolsetOf('wp_delete_snippet'), 'admin');
  assert.equal(toolsetOf('wp_list_clients'), 'core');
  assert.equal(toolsetOf('wp_update_post'), 'content');
  assert.equal(toolsetOf('wp_bulk_update_posts'), 'content');
});

test('no selection or "all" means every tool', () => {
  assert.equal(parseToolsets(undefined), null);
  assert.equal(parseToolsets(''), null);
  assert.equal(parseToolsets('all'), null);
});

test('selection always includes core and rejects typos', () => {
  assert.deepEqual([...parseToolsets(' Content,seo ')].sort(), ['content', 'core', 'seo']);
  assert.throws(() => parseToolsets('content,elementr'), /Unknown toolset\(s\): elementr/);
});

test('filters the tool list', () => {
  const tools = ['wp_update_post', 'wc_get_order', 'wp_list_clients', 'wp_yoast_get_meta'].map(name => ({ name }));
  assert.deepEqual(filterTools(tools, parseToolsets('seo')).map(t => t.name), ['wp_list_clients', 'wp_yoast_get_meta']);
  assert.equal(filterTools(tools, null).length, 4);
});
