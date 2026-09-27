import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWithRetry } from './mcp-hardening.js';

async function withServer(statuses, fn) {
  let hits = 0;
  const server = http.createServer((req, res) => { res.statusCode = statuses[Math.min(hits, statuses.length - 1)]; hits++; res.end('{}'); });
  await new Promise(r => server.listen(0, r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/`, () => hits); } finally { server.close(); }
}

test('a GET is always attempted at least once, even with maxRetries 0', async () => {
  await withServer([200], async (url, hits) => {
    const res = await fetchWithRetry(url, {}, { maxRetries: 0, retryBaseMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(hits(), 1);
  });
});

test('GET retries a 503 up to maxRetries attempts', async () => {
  await withServer([503, 503, 200], async (url, hits) => {
    const res = await fetchWithRetry(url, {}, { maxRetries: 3, retryBaseMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(hits(), 3);
  });
});

test('POST is never retried', async () => {
  await withServer([503, 200], async (url, hits) => {
    const res = await fetchWithRetry(url, { method: 'POST' }, { maxRetries: 3, retryBaseMs: 1 });
    assert.equal(res.status, 503);
    assert.equal(hits(), 1);
  });
});
