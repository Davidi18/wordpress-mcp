import test from 'node:test';
import assert from 'node:assert/strict';
import { getYoastMeta, normalizeYoastPostType, updateYoastMeta } from './yoast-bulk-editor.js';

test('normalizes core and custom post types', () => {
  assert.deepEqual(normalizeYoastPostType('page'), { contentType: 'page', restBase: 'pages' });
  assert.deepEqual(normalizeYoastPostType('posts'), { contentType: 'post', restBase: 'posts' });
  assert.deepEqual(normalizeYoastPostType('service'), { contentType: 'service', restBase: 'service' });
  assert.throws(() => normalizeYoastPostType('../service'), /Invalid Yoast post_type/);
});

test('updates a service title through Yoast Bulk Editor and touches the CPT', async () => {
  const calls = [];
  const wpReq = async (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    if (endpoint === '/yoast/v1/bulk_editor/update_search') {
      return { results: [{ id: 4027, success: true }] };
    }
    if (endpoint.includes('?context=edit')) {
      return { id: 4027, title: { raw: 'סטטיסטיקה לתזה ולדוקטורט' } };
    }
    return { id: 4027 };
  };

  const result = await updateYoastMeta({
    wpReq,
    id: 4027,
    postType: 'service',
    title: 'סטטיסטיקה לדוקטורט ולתזה - ליווי, ניתוח נתונים ופרק ממצאים'
  });

  assert.deepEqual(result.methods, ['yoast_bulk_editor_search', 'native_post_touch']);
  assert.deepEqual(calls[0], {
    endpoint: '/yoast/v1/bulk_editor/update_search',
    options: {
      method: 'POST',
      body: {
        items: [{
          id: 4027,
          seo_title: 'סטטיסטיקה לדוקטורט ולתזה - ליווי, ניתוח נתונים ופרק ממצאים'
        }]
      }
    }
  });
  assert.equal(calls[1].endpoint, '/wp/v2/service/4027?context=edit&_fields=id,title');
  assert.deepEqual(calls[2], {
    endpoint: '/wp/v2/service/4027',
    options: { method: 'POST', body: { title: 'סטטיסטיקה לתזה ולדוקטורט' } }
  });
});

test('updates social metadata through the official Yoast route', async () => {
  const calls = [];
  const wpReq = async (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    return { results: [{ id: 10, success: true }] };
  };

  const result = await updateYoastMeta({
    wpReq,
    id: 10,
    postType: 'post',
    og_title: 'Social title',
    og_description: 'Social description',
    touch: false
  });

  assert.deepEqual(result.methods, ['yoast_bulk_editor_social']);
  assert.equal(calls[0].endpoint, '/yoast/v1/bulk_editor/update_social');
  assert.deepEqual(calls[0].options.body.items[0], {
    id: 10,
    social_title: 'Social title',
    social_description: 'Social description'
  });
});

test('fails honestly when Yoast rejects an update', async () => {
  const wpReq = async () => ({ results: [{ id: 4027, success: false }] });
  await assert.rejects(
    updateYoastMeta({ wpReq, id: 4027, postType: 'service', title: 'New title', touch: false }),
    /Yoast search metadata update failed/
  );
});

test('falls back to correctly named Yoast postmeta when Bulk Editor is unavailable', async () => {
  const calls = [];
  const wpReq = async (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    if (endpoint.startsWith('/yoast/')) throw new Error('WordPress API error (404): rest_no_route');
    return { id: 10 };
  };

  const result = await updateYoastMeta({
    wpReq,
    id: 10,
    postType: 'page',
    title: 'Fallback title',
    og_title: 'Fallback social title',
    touch: false
  });

  assert.deepEqual(result.methods, [
    'core_rest_search_fallback',
    'core_rest_social_fallback',
    'core_rest_protected_meta'
  ]);
  assert.deepEqual(calls.at(-1), {
    endpoint: '/wp/v2/pages/10',
    options: {
      method: 'POST',
      body: {
        meta: {
          _yoast_wpseo_title: 'Fallback title',
          '_yoast_wpseo_opengraph-title': 'Fallback social title'
        }
      }
    }
  });
});

test('reads service metadata from Yoast Bulk Editor by post id', async () => {
  const wpReq = async endpoint => {
    if (endpoint.startsWith('/wp/v2/service/4027')) {
      return {
        id: 4027,
        title: { raw: 'סטטיסטיקה לתזה ולדוקטורט' },
        yoast_head_json: {
          canonical: 'https://planetmed.pro/service/example/',
          robots: { index: 'index', follow: 'follow' },
          og_title: 'Fallback OG title'
        }
      };
    }
    if (endpoint.startsWith('/yoast/v1/bulk_editor/posts?')) {
      return {
        posts: [{
          id: 4027,
          seo_title: 'Stored SEO title',
          meta_description: 'Stored description',
          focus_keyphrase: 'Stored keyphrase',
          social_title: '',
          social_description: ''
        }]
      };
    }
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };

  const result = await getYoastMeta({ wpReq, id: 4027, postType: 'service' });
  assert.equal(result.title, 'Stored SEO title');
  assert.equal(result.og_title, 'Fallback OG title');
  assert.equal(result.canonical, 'https://planetmed.pro/service/example/');
  assert.equal(result.source, 'yoast_bulk_editor');
});
