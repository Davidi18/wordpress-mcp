// handlers/seo.js
// Tool handlers for the "seo" toolset (see toolsets.js / tool-definitions/seo.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { getYoastMeta, updateYoastMeta } from '../yoast-bulk-editor.js';
import { NOT_HANDLED } from './not-handled.js';

export async function handleSeo(name, args, ctx) {
  const { wpReq } = ctx;
  switch (name) {

    // ── RANKMATH SEO ──
    case 'wp_rankmath_update_meta': {
      const rmMeta = {};
      if (args.title !== undefined) rmMeta.rank_math_title = args.title;
      if (args.description !== undefined) rmMeta.rank_math_description = args.description;
      if (args.focus_keyword !== undefined) rmMeta.rank_math_focus_keyword = args.focus_keyword;
      if (args.robots !== undefined) rmMeta.rank_math_robots = args.robots;
      const endpoint = args.post_type === 'page' ? 'pages' : 'posts';
      const rmSaved = await wpReq(`/wp/v2/${endpoint}/${args.id}`, {
        method: 'POST',
        body: { meta: rmMeta }
      });
      // WordPress silently drops meta keys that aren't registered for REST, so
      // a 200 alone doesn't mean RankMath stored anything. Compare the echo.
      const savedMeta = rmSaved?.meta || {};
      const rmFailed = Object.entries(rmMeta)
        .filter(([key, expected]) => !Object.prototype.hasOwnProperty.call(savedMeta, key) ||
          JSON.stringify(savedMeta[key] ?? '') !== JSON.stringify(expected ?? ''))
        .map(([key, expected]) => ({ key, expected, stored: savedMeta[key] }));
      if (rmFailed.length) {
        throw new Error(
          `RankMath meta not stored for ${endpoint}/${args.id}: ${rmFailed.map(f => f.key in savedMeta
            ? `${f.key} (expected ${JSON.stringify(f.expected)}, stored ${JSON.stringify(f.stored)})`
            : `${f.key} (not exposed over REST — is RankMath active and its meta registered for REST?)`).join('; ')}`
        );
      }
      return { updated: true, verified: true, id: args.id, fields: Object.keys(rmMeta) };
    }


    case 'wp_rankmath_get_meta': {
      const endpoint2 = args.post_type === 'page' ? 'pages' : 'posts';
      const rmPost = await wpReq(`/wp/v2/${endpoint2}/${args.id}?context=edit`);
      const meta = rmPost?.meta || {};
      return {
        id: args.id,
        title: meta.rank_math_title || '',
        description: meta.rank_math_description || '',
        focus_keyword: meta.rank_math_focus_keyword || '',
        robots: meta.rank_math_robots || [],
        seo_score: meta.rank_math_seo_score || null,
        pillar_content: meta.rank_math_pillar_content || false,
        canonical_url: meta.rank_math_canonical_url || ''
      };
    }


    // ── YOAST SEO ──
    case 'wp_yoast_get_head': {
      const yoastData = await wpReq(`/yoast/v1/get_head?url=${encodeURIComponent(args.url)}`);
      if (yoastData?.code) {
        return { error: yoastData.message || 'Yoast API error', hint: 'Yoast SEO may not be installed on this site' };
      }
      return {
        status: yoastData?.status || 200,
        json: yoastData?.json || {},
        html: (yoastData?.html || '').substring(0, 2000)
      };
    }


    case 'wp_yoast_update_meta': {
      return await updateYoastMeta({
        wpReq,
        id: args.id,
        postType: args.post_type || 'post',
        restBase: args.rest_base,
        verify: args.verify !== false,
        title: args.title,
        description: args.description,
        focus_keyword: args.focus_keyword,
        robots_noindex: args.robots_noindex,
        robots_nofollow: args.robots_nofollow,
        canonical: args.canonical,
        og_title: args.og_title,
        og_description: args.og_description
      });
    }


    case 'wp_yoast_get_meta': {
      return await getYoastMeta({
        wpReq,
        id: args.id,
        postType: args.post_type || 'post',
        restBase: args.rest_base
      });
    }


    // ── REDIRECTS ──
    case 'wp_get_redirects': {
      const allRedirects = [];

      // Method 1: RankMath — uses updateRedirection endpoint with GET action
      try {
        const rmResult = await wpReq('/rankmath/v1/updateRedirection', {
          method: 'POST',
          body: {
            action: 'list',
            per_page: args.per_page || 50,
            page: args.page || 1,
            ...(args.search ? { search: args.search } : {})
          }
        });
        if (rmResult && (rmResult.redirections || rmResult.items || Array.isArray(rmResult))) {
          const items = rmResult.redirections || rmResult.items || rmResult;
          return {
            source: 'rankmath',
            total: rmResult.total || items.length,
            redirects: (Array.isArray(items) ? items : []).map(r => ({
              id: r.id,
              source: r.sources?.[0]?.pattern || r.url_from || '',
              target: r.url_to || '',
              type: r.header_code || 301,
              hits: r.hits || 0,
              status: r.status || 'active'
            }))
          };
        }
      } catch (e) { /* RankMath not available or different version */ }

      // Method 2: RankMath — try direct DB-backed REST endpoint (some versions)
      try {
        const rmDirect = await wpReq('/rankmath/v1/redirections');
        if (rmDirect && !rmDirect.code && (Array.isArray(rmDirect) || rmDirect.redirections)) {
          const items = rmDirect.redirections || rmDirect;
          return {
            source: 'rankmath-direct',
            total: items.length,
            redirects: (Array.isArray(items) ? items : []).map(r => ({
              id: r.id,
              source: r.sources?.[0]?.pattern || r.url || '',
              target: r.url_to || '',
              type: r.header_code || 301,
              hits: r.hits || 0,
              status: r.status || 'active'
            }))
          };
        }
      } catch (e) { /* not available */ }

      // Method 3: Redirection plugin
      // NOTE: the Redirection plugin's REST API uses 0-based page indexing.
      // Callers pass a 1-based `page` (default 1), so translate it here —
      // otherwise the default lands on the *second* page and returns an empty
      // list while still reporting a non-zero `total`.
      try {
        const reqPage = Math.max(0, (args.page ? Number(args.page) - 1 : 0));
        const rdParams = new URLSearchParams({
          per_page: String(args.per_page || 50),
          page: String(reqPage)
        });
        if (args.search) rdParams.set('filterBy[url]', args.search);
        const redirection = await wpReq('/redirection/v1/redirect?' + rdParams.toString());
        if (redirection && Array.isArray(redirection.items)) {
          return {
            source: 'redirection-plugin',
            total: redirection.total || redirection.items.length,
            page: reqPage,
            redirects: redirection.items.map(r => ({
              id: r.id,
              source: r.url,
              target: r.action_data?.url || '',
              type: r.action_code || 301,
              hits: r.hits || 0,
              last_access: r.last_access || null,
              enabled: r.enabled !== false
            }))
          };
        }
      } catch (e) { /* Redirection plugin not available */ }

      // Method 4: Check _wp_http_referer redirects in options (last resort)
      return { error: 'No redirect data found. Tried: RankMath API, RankMath direct, Redirection plugin.', hint: 'Check which redirect plugin is installed and active.' };
    }


    case 'wp_create_redirect': {
      // Collect per-plugin failures so the final error is actionable instead
      // of a blanket "no plugin found" when a plugin is in fact active.
      const attempts = [];

      // Try RankMath first
      try {
        const result = await wpReq('/rankmath/v1/updateRedirection', {
          method: 'POST',
          body: {
            action: 'update',
            redirection: {
              sources: [{ pattern: args.source, comparison: 'exact' }],
              url_to: args.target,
              header_code: args.type || 301,
              status: 'active'
            }
          }
        });
        if (result && !result.code) {
          return { created: true, source: 'rankmath', redirect: result };
        }
        attempts.push({ plugin: 'rankmath', response: result });
      } catch (e) { attempts.push({ plugin: 'rankmath', error: e.message }); }

      // Try Redirection plugin
      try {
        const result = await wpReq('/redirection/v1/redirect', {
          method: 'POST',
          body: {
            url: args.source,
            action_data: { url: args.target },
            action_type: 'url',
            action_code: args.type || 301,
            group_id: 1,
            match_type: 'url'
          }
        });
        // The Redirection plugin's create endpoint does NOT return the new row
        // as `{ id }`. On success it returns the refreshed paged LIST
        // ({ items, total, pages }) with the new redirect included. Other
        // versions may return the created object directly, so handle both.
        if (result) {
          if (result.id) {
            return { created: true, source: 'redirection-plugin', id: result.id };
          }
          if (Array.isArray(result.items)) {
            const match = result.items.find(r => r.url === args.source);
            return {
              created: true,
              source: 'redirection-plugin',
              id: match?.id ?? null,
              total: result.total,
              redirect: match || null
            };
          }
        }
        attempts.push({ plugin: 'redirection-plugin', response: result });
      } catch (e) { attempts.push({ plugin: 'redirection-plugin', error: e.message }); }

      return { error: 'No redirect plugin found (tried RankMath and Redirection plugin)', attempts };
    }
  }
  return NOT_HANDLED;
}
