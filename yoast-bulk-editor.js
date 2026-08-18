const CORE_TYPES = new Map([
  ['post', { contentType: 'post', restBase: 'posts' }],
  ['posts', { contentType: 'post', restBase: 'posts' }],
  ['page', { contentType: 'page', restBase: 'pages' }],
  ['pages', { contentType: 'page', restBase: 'pages' }]
]);

function validateTypeSlug(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw new Error(`Invalid Yoast ${label} "${value}".`);
  }
  return normalized;
}

export function normalizeYoastPostType(postType = 'post') {
  const value = validateTypeSlug(postType || 'post', 'post_type');
  return CORE_TYPES.get(value) || { contentType: value, restBase: value };
}

export async function resolveYoastPostType({ wpReq, postType = 'post', restBase } = {}) {
  const normalized = normalizeYoastPostType(postType);
  if (restBase !== undefined) {
    return {
      contentType: normalized.contentType,
      restBase: validateTypeSlug(restBase, 'rest_base'),
      source: 'explicit'
    };
  }

  if (CORE_TYPES.has(validateTypeSlug(postType || 'post', 'post_type'))) {
    return { ...normalized, source: 'builtin' };
  }

  try {
    const types = await wpReq('/wp/v2/types');
    const requested = validateTypeSlug(postType, 'post_type');
    for (const [key, value] of Object.entries(types || {})) {
      try {
        const contentType = validateTypeSlug(value?.slug || key, 'discovered post_type');
        const discoveredRestBase = validateTypeSlug(value?.rest_base || contentType, 'discovered rest_base');
        if (requested === key || requested === contentType || requested === discoveredRestBase) {
          return { contentType, restBase: discoveredRestBase, source: 'wp_types' };
        }
      } catch {
        // One malformed or non-standard type must not block discovery of all
        // remaining types returned by WordPress or a plugin.
      }
    }
  } catch {
    // Some sites restrict the types endpoint. Preserve the historical
    // same-slug behavior instead of blocking otherwise valid requests.
  }

  return { ...normalized, source: 'same_slug_fallback' };
}

function assertBulkResult(response, id, operation) {
  const result = response?.results?.find(item => Number(item?.id) === Number(id));
  if (!result?.success) {
    throw new Error(`Yoast ${operation} failed for post ${id}: ${JSON.stringify(response)}`);
  }
}

function isMissingRouteError(error) {
  return /(?:rest_no_route|404|no route)/i.test(error?.message || '');
}

function expectedFields(fields) {
  const expected = {};
  for (const key of [
    'title',
    'description',
    'focus_keyword',
    'robots_noindex',
    'robots_nofollow',
    'canonical',
    'og_title',
    'og_description'
  ]) {
    if (fields[key] !== undefined) expected[key] = fields[key];
  }
  return expected;
}

function compareReadback(expected, readback) {
  const matched = [];
  const mismatched = {};
  for (const [field, value] of Object.entries(expected)) {
    const actual = readback?.[field];
    if (actual === value) matched.push(field);
    else mismatched[field] = { expected: value, actual: actual ?? null };
  }
  return { matched, mismatched };
}

export async function updateYoastMeta({
  wpReq,
  id,
  postType = 'post',
  restBase,
  touch = true,
  verify = true,
  ...fields
}) {
  const resolved = await resolveYoastPostType({ wpReq, postType, restBase });
  const { contentType, restBase: resolvedRestBase } = resolved;
  const methods = [];
  const protectedMeta = {};

  const searchItem = { id: Number(id) };
  if (fields.title !== undefined) searchItem.seo_title = fields.title;
  if (fields.description !== undefined) searchItem.meta_description = fields.description;
  if (fields.focus_keyword !== undefined) searchItem.focus_keyphrase = fields.focus_keyword;
  if (Object.keys(searchItem).length > 1) {
    try {
      const response = await wpReq('/yoast/v1/bulk_editor/update_search', {
        method: 'POST',
        body: { items: [searchItem] }
      });
      assertBulkResult(response, id, 'search metadata update');
      methods.push('yoast_bulk_editor_search');
    } catch (error) {
      if (!isMissingRouteError(error)) throw error;
      if (fields.title !== undefined) protectedMeta._yoast_wpseo_title = fields.title;
      if (fields.description !== undefined) protectedMeta._yoast_wpseo_metadesc = fields.description;
      if (fields.focus_keyword !== undefined) protectedMeta._yoast_wpseo_focuskw = fields.focus_keyword;
      methods.push('core_rest_search_fallback');
    }
  }

  const socialItem = { id: Number(id) };
  if (fields.og_title !== undefined) socialItem.social_title = fields.og_title;
  if (fields.og_description !== undefined) socialItem.social_description = fields.og_description;
  if (Object.keys(socialItem).length > 1) {
    try {
      const response = await wpReq('/yoast/v1/bulk_editor/update_social', {
        method: 'POST',
        body: { items: [socialItem] }
      });
      assertBulkResult(response, id, 'social metadata update');
      methods.push('yoast_bulk_editor_social');
    } catch (error) {
      if (!isMissingRouteError(error)) throw error;
      if (fields.og_title !== undefined) protectedMeta['_yoast_wpseo_opengraph-title'] = fields.og_title;
      if (fields.og_description !== undefined) protectedMeta['_yoast_wpseo_opengraph-description'] = fields.og_description;
      methods.push('core_rest_social_fallback');
    }
  }

  if (fields.robots_noindex !== undefined) protectedMeta._yoast_wpseo_meta_robots_noindex = fields.robots_noindex ? '1' : '0';
  if (fields.robots_nofollow !== undefined) protectedMeta._yoast_wpseo_meta_robots_nofollow = fields.robots_nofollow ? '1' : '0';
  if (fields.canonical !== undefined) protectedMeta._yoast_wpseo_canonical = fields.canonical;
  if (Object.keys(protectedMeta).length > 0) {
    await wpReq(`/wp/v2/${resolvedRestBase}/${id}`, {
      method: 'POST',
      body: { meta: protectedMeta }
    });
    methods.push('core_rest_protected_meta');
  }

  if (methods.length === 0) {
    throw new Error('No Yoast fields supplied.');
  }

  if (touch) {
    const post = await wpReq(`/wp/v2/${resolvedRestBase}/${id}?context=edit&_fields=id,title`);
    const currentTitle = post?.title?.raw ?? post?.title?.rendered;
    if (currentTitle !== undefined) {
      await wpReq(`/wp/v2/${resolvedRestBase}/${id}`, {
        method: 'POST',
        body: { title: currentTitle }
      });
      methods.push('native_post_touch');
    }
  }

  const baseResult = {
    updated: true,
    id: Number(id),
    post_type: contentType,
    rest_base: resolvedRestBase,
    type_resolution: resolved.source,
    methods
  };

  if (!verify) {
    return {
      ...baseResult,
      verified: null,
      verification: { skipped: true }
    };
  }

  try {
    const readback = await getYoastMeta({
      wpReq,
      id,
      postType: contentType,
      restBase: resolvedRestBase
    });
    const verification = compareReadback(expectedFields(fields), readback);
    return {
      ...baseResult,
      verified: Object.keys(verification.mismatched).length === 0,
      verification,
      readback
    };
  } catch (error) {
    return {
      ...baseResult,
      verified: false,
      verification: { matched: [], mismatched: {}, error: error.message }
    };
  }
}

export async function getYoastMeta({ wpReq, id, postType = 'post', restBase } = {}) {
  const resolved = await resolveYoastPostType({ wpReq, postType, restBase });
  const { contentType, restBase: resolvedRestBase } = resolved;
  const post = await wpReq(`/wp/v2/${resolvedRestBase}/${id}?context=edit&_fields=id,title,meta,yoast_head_json`);
  const postTitle = post?.title?.raw ?? post?.title?.rendered ?? '';
  const params = new URLSearchParams({
    content_type: contentType,
    per_page: '100',
    search: postTitle
  });
  let row = null;
  try {
    const response = await wpReq(`/yoast/v1/bulk_editor/posts?${params.toString()}`);
    row = response?.posts?.find(item => Number(item?.id) === Number(id));
    if (!row) {
      throw new Error(`Yoast Bulk Editor readback did not return ${contentType} ${id}.`);
    }
  } catch (error) {
    if (!isMissingRouteError(error)) throw error;
  }

  const meta = post?.meta || {};
  const head = post?.yoast_head_json || {};
  return {
    id: Number(id),
    post_type: contentType,
    rest_base: resolvedRestBase,
    type_resolution: resolved.source,
    title: row?.seo_title || meta._yoast_wpseo_title || head.title || '',
    description: row?.meta_description || meta._yoast_wpseo_metadesc || head.description || '',
    focus_keyword: row?.focus_keyphrase || meta._yoast_wpseo_focuskw || '',
    robots_noindex: meta._yoast_wpseo_meta_robots_noindex === '1' || head?.robots?.index === 'noindex',
    robots_nofollow: meta._yoast_wpseo_meta_robots_nofollow === '1' || head?.robots?.follow === 'nofollow',
    canonical: meta._yoast_wpseo_canonical || head.canonical || '',
    og_title: row?.social_title || meta['_yoast_wpseo_opengraph-title'] || head.og_title || row?.seo_title || '',
    og_description: row?.social_description || meta['_yoast_wpseo_opengraph-description'] || head.og_description || row?.meta_description || '',
    og_image: head.og_image?.[0]?.url || '',
    source: row ? 'yoast_bulk_editor' : (Object.keys(meta).some(key => key.includes('yoast')) ? 'meta' : 'yoast_head_json')
  };
}
