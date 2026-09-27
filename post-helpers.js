// post-helpers.js
// Shared read/write paths for post-like resources (posts, pages, CPTs).
import { acfFailureMessage, updatePostWithAcf } from './acf-writer.js';



// Read a post plus opt-in extras (acf / meta / taxonomies). Extras use
// context=edit so ACF and meta come back as stored — the same shape the
// write path accepts — and a missing `acf` is reported, not silently omitted.
export async function readPostWithExtras(wpReq, restBase, args) {
  const include = new Set(
    (Array.isArray(args.include) ? args.include : String(args.include || '').split(','))
      .map(s => String(s).trim().toLowerCase())
      .filter(Boolean)
  );
  if (include.size === 0) {
    return { post: await wpReq(`/wp/v2/${restBase}/${args.id}`), extras: {} };
  }
  const params = new URLSearchParams({ context: 'edit' });
  if (include.has('acf') && args.acf_format) params.set('acf_format', args.acf_format);
  const post = await wpReq(`/wp/v2/${restBase}/${args.id}?${params}`);
  const extras = {};
  if (include.has('acf')) {
    if (post.acf && typeof post.acf === 'object') {
      extras.acf = Array.isArray(post.acf) ? {} : post.acf;
    } else {
      extras.acf = null;
      extras.acf_note = 'This post exposes no `acf` over REST (ACF missing, or the field group has "Show in REST API" off).';
    }
  }
  if (include.has('meta')) extras.meta = post.meta || {};
  if (include.has('taxonomies')) {
    extras.categories = post.categories || [];
    extras.tags = post.tags || [];
  }
  return { post, extras };
}


// Single write path for post updates. With `acf`, the write goes through
// acf-writer (preflight + read-back verification) and throws on a silent drop.
export async function writePost(wpReq, restBase, id, body, acf) {
  if (acf === undefined) {
    const post = await wpReq(`/wp/v2/${restBase}/${id}`, { method: 'POST', body });
    return { post, acf: null };
  }
  const result = await updatePostWithAcf({ wpReq, restBase, id, acf, body });
  if (!result.acf.success) {
    const err = new Error(acfFailureMessage(restBase, id, result.acf));
    err.acfVerification = result.acf;
    throw err;
  }
  return result;
}
