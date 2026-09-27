import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog, extractPreviousState, isWriteTool, sanitizeForAudit, targetOf } from './audit-log.js';

function fakePool() {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    }
  };
}

test('classifies read vs write tools', () => {
  for (const t of ['wp_get_post', 'wc_list_orders', 'wp_elementor_find_widgets', 'wp_yoast_get_meta', 'wp_rankmath_get_meta', 'wp_search', 'wp_audit_log', 'wp_refresh_clients']) {
    assert.equal(isWriteTool(t), false, t);
  }
  for (const t of ['wp_update_post', 'wp_bulk_update_posts', 'wp_elementor_update_widget', 'wp_yoast_update_meta', 'wp_install_plugin', 'wc_update_order', 'wp_replace_text']) {
    assert.equal(isWriteTool(t), true, t);
  }
});

test('redacts secrets and caps binaries, keeps post content', () => {
  const out = sanitizeForAudit({ password: 'x', content: 'a'.repeat(5000), file_base64: 'b'.repeat(1000), nested: { api_key: 'k' } });
  assert.equal(out.password, '<redacted>');
  assert.equal(out.nested.api_key, '<redacted>');
  assert.equal(out.content.length, 5000);
  assert.equal(out.file_base64, '<binary:1000 chars>');
});

test('extracts previous state from Elementor, single ACF and bulk ACF results', () => {
  assert.deepEqual(extractPreviousState({ previous_state: { a: 1 } }), { a: 1 });
  assert.deepEqual(extractPreviousState({ acf_update: { previous: { q: 'old' } } }), { acf: { q: 'old' } });
  assert.deepEqual(
    extractPreviousState({ results: [{ id: 1, acf: { previous: { q: 'o' } } }, { id: 2, success: false }] }),
    [{ id: 1, acf: { q: 'o' } }]
  );
  assert.equal(extractPreviousState({ id: 1 }), undefined);
});

test('target id from id / ids / post_ids', () => {
  assert.deepEqual(targetOf({ id: 5, post_type: 'services' }), { target_id: '5', post_type: 'services' });
  assert.deepEqual(targetOf({ post_ids: [1, 2] }), { target_id: '1,2', post_type: null });
});

test('records writes once the table exists, skips reads', async () => {
  const pool = fakePool();
  const audit = createAuditLog({ getDb: async () => pool });
  await audit.record({ tool: 'wp_get_post', args: { id: 1 } });
  assert.equal(pool.queries.length, 0);

  await audit.record({ tool: 'wp_update_post', client: 'PlanetMed', args: { id: 6917, acf: { q: 'new' } }, result: { acf_update: { previous: { q: 'old' } } } });
  assert.match(pool.queries[0].sql, /CREATE TABLE IF NOT EXISTS mcp_audit_log/);
  const insert = pool.queries[1];
  assert.match(insert.sql, /INSERT INTO mcp_audit_log/);
  assert.equal(insert.params[0], 'PlanetMed');
  assert.equal(insert.params[2], 'wp_update_post');
  assert.equal(insert.params[3], '6917');
  assert.equal(insert.params[5], true);
  assert.deepEqual(JSON.parse(insert.params[11]), { acf: { q: 'old' } });

  await audit.record({ tool: 'wp_update_post', args: { id: 1 }, error: 'boom' });
  assert.equal(pool.queries.length, 3, 'schema is created only once');
  assert.equal(pool.queries[2].params[5], false);
  assert.equal(pool.queries[2].params[6], 'boom');
});

test('never throws when the database fails, and is a no-op without a DB', async () => {
  const errors = [];
  const broken = createAuditLog({ getDb: async () => ({ query: async () => { throw new Error('down'); } }), log: { error: m => errors.push(m) } });
  await broken.record({ tool: 'wp_update_post', args: {} });
  assert.match(errors[0], /audit log write failed/);

  const none = createAuditLog({ getDb: async () => null });
  await none.record({ tool: 'wp_update_post', args: {} });
  await assert.rejects(none.query({}), /DATABASE_URL/);
});

test('disabled logger writes nothing', async () => {
  const pool = fakePool();
  await createAuditLog({ getDb: async () => pool, enabled: false }).record({ tool: 'wp_update_post', args: {} });
  assert.equal(pool.queries.length, 0);
});

test('backs off after the table cannot be created instead of failing every write', async () => {
  let t = 0;
  let calls = 0;
  const errors = [];
  const pool = { query: async () => { calls++; throw new Error('permission denied for schema public'); } };
  const audit = createAuditLog({ getDb: async () => pool, log: { error: m => errors.push(m) }, now: () => t });
  t = 1000;
  await audit.record({ tool: 'wp_update_post', args: {} });
  await audit.record({ tool: 'wp_update_post', args: {} });
  assert.equal(calls, 1, 'second write within the backoff does not hit the DB');
  assert.equal(errors.length, 1);
  t += 6 * 60 * 1000;
  await audit.record({ tool: 'wp_update_post', args: {} });
  assert.equal(calls, 2, 'retries after the backoff window');
});
