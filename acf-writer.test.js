import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcfInput, updatePostWithAcf, verifyAcfWrite, acfFailureMessage } from './acf-writer.js';

function fakeWp({ current, afterWrite }) {
  const calls = [];
  const wpReq = async (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    if (!options.method) return current;
    return afterWrite(options.body);
  };
  return { wpReq, calls };
}

test('writes four FAQ pairs, sends them under `acf` (not meta), and verifies them', async () => {
  const acf = {};
  for (let i = 1; i <= 4; i++) {
    acf[`pm_faq_question_${i}`] = `Question ${i}`;
    acf[`pm_faq_answer_${i}`] = `<p>Answer ${i}</p>`;
  }
  const existing = { ...Object.fromEntries(Object.keys(acf).map(k => [k, ''])), pm_other: 'keep' };
  const { wpReq, calls } = fakeWp({
    current: { id: 6917, acf: existing },
    afterWrite: body => ({ id: 6917, acf: { ...existing, ...body.acf } })
  });

  const { acf: result } = await updatePostWithAcf({ wpReq, restBase: 'posts', id: 6917, acf });

  assert.equal(result.success, true);
  assert.equal(result.written.length, 8);
  assert.equal(calls[0].endpoint, '/wp/v2/posts/6917?context=edit&_fields=id,acf');
  assert.deepEqual(calls[1].options.body, { acf });
  assert.equal(calls[1].options.body.meta, undefined);
  assert.equal('pm_other' in calls[1].options.body.acf, false, 'unsent fields are not touched');
});

test('refuses to write when the post has no REST acf field', async () => {
  const { wpReq, calls } = fakeWp({ current: { id: 1 }, afterWrite: () => assert.fail('must not write') });
  await assert.rejects(
    updatePostWithAcf({ wpReq, restBase: 'posts', id: 1, acf: { a: 'x' } }),
    /ACF is not exposed over REST.*Nothing was written/
  );
  assert.equal(calls.length, 1);
});

test('refuses unknown field names before writing', async () => {
  const { wpReq } = fakeWp({ current: { id: 1, acf: { known: '' } }, afterWrite: () => assert.fail('must not write') });
  await assert.rejects(
    updatePostWithAcf({ wpReq, restBase: 'posts', id: 1, acf: { known: 'a', typo_field: 'b' } }),
    /typo_field.*Available: known/
  );
});

test('treats an empty PHP array acf as "no fields", not as missing ACF', async () => {
  const { wpReq } = fakeWp({ current: { id: 1, acf: [] }, afterWrite: () => assert.fail('must not write') });
  await assert.rejects(updatePostWithAcf({ wpReq, restBase: 'posts', id: 1, acf: { a: 'x' } }), /Unknown or non-REST/);
});

test('reports a silent drop as failure (HTTP 200 but value unchanged)', async () => {
  const { wpReq } = fakeWp({
    current: { id: 1, acf: { q: 'old' } },
    afterWrite: () => ({ id: 1, acf: { q: 'old' } })
  });
  const { acf } = await updatePostWithAcf({ wpReq, restBase: 'posts', id: 1, acf: { q: 'new' } });
  assert.equal(acf.success, false);
  assert.deepEqual(acf.failed, ['q']);
  assert.match(acfFailureMessage('posts', 1, acf), /q: expected "new", stored "old"/);
});

test('"" and null clear a field and verify against an empty stored value', () => {
  const v = verifyAcfWrite({ a: '', b: null }, { a: null, b: '' });
  assert.equal(v.success, true);
  assert.deepEqual(v.written, ['a', 'b']);
});

test('field keys pass through and are reported as unverified, not verified', async () => {
  const { wpReq, calls } = fakeWp({
    current: { id: 1, acf: { q: '' } },
    afterWrite: () => ({ id: 1, acf: { q: 'x' } })
  });
  const { acf } = await updatePostWithAcf({ wpReq, restBase: 'posts', id: 1, acf: { field_abc123: 'x' } });
  assert.equal(acf.success, true);
  assert.deepEqual(acf.unverified, ['field_abc123']);
  assert.deepEqual(acf.written, []);
  assert.deepEqual(calls[1].options.body.acf, { field_abc123: 'x' });
});

test('normalizes CRLF/whitespace and numeric strings when verifying', () => {
  assert.equal(verifyAcfWrite({ a: 'x\r\ny ', n: '42' }, { a: 'x\ny', n: 42 }).success, true);
});

test('parses JSON-string input and rejects empty/non-object input', () => {
  assert.deepEqual(parseAcfInput('{"a":1}'), { a: 1 });
  assert.throws(() => parseAcfInput({}), /empty/);
  assert.throws(() => parseAcfInput([1]), /must be an object/);
  assert.throws(() => parseAcfInput('nope'), /non-JSON/);
});
