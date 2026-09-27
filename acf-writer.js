// acf-writer.js
// Write ACF fields through the core WP REST `acf` key (ACF >= 5.11, field group
// "Show in REST API" enabled) and verify what WordPress actually stored.
//
// Why a dedicated path: posting `acf` to a post type whose field groups are not
// REST-exposed returns HTTP 200 and silently drops the payload, and writing the
// same names via `meta` bypasses ACF entirely. Both look like success. So:
//   1. preflight GET — the post must expose an `acf` object that contains every
//      requested field name, otherwise nothing is written;
//   2. POST { ...otherFields, acf } — ACF updates only the fields sent;
//   3. compare the `acf` object in the response with what was requested.
//
// Clearing: `""` or `null` clears a field (ACF stores an empty value). A field
// marked required in ACF rejects null with a REST 400, which surfaces as-is.
// Field keys (`field_xxxxxxxx`) are passed through — ACF resolves them — but the
// REST response is keyed by field name, so they are reported as "unverified".

const FIELD_KEY_RE = /^field_[A-Za-z0-9]+$/;

export function isFieldKey(name) {
  return FIELD_KEY_RE.test(name);
}

export function parseAcfInput(acf) {
  let value = acf;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('acf must be an object of { field_name: value } (got a non-JSON string).');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('acf must be an object of { field_name: value }.');
  }
  if (Object.keys(value).length === 0) {
    throw new Error('acf is empty — pass at least one field.');
  }
  return value;
}

function normalizeForCompare(value) {
  if (value === null || value === undefined || value === '' || value === false) return '';
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function valuesMatch(expected, stored) {
  return normalizeForCompare(expected) === normalizeForCompare(stored);
}

// PHP serializes an empty associative array as `[]`.
function asAcfObject(acf) {
  if (Array.isArray(acf)) return acf.length === 0 ? {} : null;
  return acf && typeof acf === 'object' ? acf : null;
}

export function verifyAcfWrite(requested, responseAcf) {
  const stored = asAcfObject(responseAcf) || {};
  const fields = Object.entries(requested).map(([field, expected]) => {
    if (isFieldKey(field)) {
      return { field, status: 'unverified', reason: 'field keys are not echoed by REST; read back by field name to confirm' };
    }
    if (!Object.prototype.hasOwnProperty.call(stored, field)) {
      return { field, status: 'missing', expected };
    }
    if (valuesMatch(expected, stored[field])) {
      return { field, status: 'verified' };
    }
    return { field, status: 'mismatch', expected, stored: stored[field] };
  });
  const failed = fields.filter(f => f.status === 'missing' || f.status === 'mismatch');
  return {
    success: failed.length === 0,
    written: fields.filter(f => f.status === 'verified').map(f => f.field),
    unverified: fields.filter(f => f.status === 'unverified').map(f => f.field),
    failed: failed.map(f => f.field),
    fields
  };
}

export async function updatePostWithAcf({ wpReq, restBase, id, acf, body = {} }) {
  const requested = parseAcfInput(acf);
  const path = `/wp/v2/${restBase}/${id}`;

  const current = await wpReq(`${path}?context=edit&_fields=id,acf`);
  const currentAcf = asAcfObject(current?.acf);
  if (!currentAcf) {
    throw new Error(
      `ACF is not exposed over REST for ${restBase}/${id}: the post has no "acf" field. ` +
      'Requires ACF >= 5.11 with "Show in REST API" enabled on the field group assigned to this post type. Nothing was written.'
    );
  }
  const unknown = Object.keys(requested).filter(f => !isFieldKey(f) && !Object.prototype.hasOwnProperty.call(currentAcf, f));
  if (unknown.length) {
    throw new Error(
      `Unknown or non-REST ACF field(s) on ${restBase}/${id}: ${unknown.join(', ')}. ` +
      `Available: ${Object.keys(currentAcf).join(', ') || '(none)'}. Nothing was written.`
    );
  }

  const post = await wpReq(path, { method: 'POST', body: { ...body, acf: requested } });
  const verification = verifyAcfWrite(requested, post?.acf);
  return { post, acf: verification };
}

export function acfFailureMessage(restBase, id, verification) {
  const details = verification.fields
    .filter(f => f.status === 'missing' || f.status === 'mismatch')
    .map(f => f.status === 'missing'
      ? `${f.field}: not returned after write`
      : `${f.field}: expected ${JSON.stringify(f.expected)}, stored ${JSON.stringify(f.stored)}`)
    .join('; ');
  return `WordPress accepted the request for ${restBase}/${id} but ACF verification failed — ${details}. ` +
    'Other fields in the same request may already be saved.';
}
