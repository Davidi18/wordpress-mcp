// handlers/seo.js
// Tool handlers for the "seo" toolset (see toolsets.js / tool-definitions/seo.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { getYoastMeta, updateYoastMeta } from '../yoast-bulk-editor.js';
import { NOT_HANDLED } from './not-handled.js';

export async function handleSeo(name, args, ctx) {
  const { wpReq } = ctx;
  switch (name) {

    case 'wp_bootstrap_yoast_term_writer': {
      const routeLive = async () => {
        try {
          await wpReq('/agency-os/v1/yoast-term-meta?taxonomy=category&term_id=0', { timeoutMs: 12000 });
          return true;
        } catch (error) {
          return !error.message.includes('rest_no_route');
        }
      };
      if (!args.force && await routeLive()) return { success: true, verified: true, message: 'Yoast term-meta route already installed' };

      const snippetName = 'Agency OS Yoast Term Meta Writer';
      const snippetCode = `if (!defined('ABSPATH')) exit;
add_action('rest_api_init', function() {
    register_rest_route('agency-os/v1', '/yoast-term-meta', [
        ['methods' => 'GET', 'callback' => 'agency_os_get_yoast_term_meta', 'permission_callback' => function() { return current_user_can('edit_posts'); }],
        ['methods' => 'POST', 'callback' => 'agency_os_update_yoast_term_meta', 'permission_callback' => function() { return current_user_can('edit_posts'); }],
    ]);
});
function agency_os_yoast_term_target($r) {
    $taxonomy = sanitize_key($r->get_param('taxonomy')); $term_id = absint($r->get_param('term_id')); $tax = get_taxonomy($taxonomy);
    if (!$tax || !$tax->public || !$tax->show_in_rest) return new WP_Error('invalid_taxonomy', 'Public REST taxonomy not found', ['status' => 404]);
    $term = get_term($term_id, $taxonomy);
    if (!$term_id || !$term || is_wp_error($term)) return new WP_Error('invalid_term', 'Term not found', ['status' => 404]);
    if (!current_user_can('edit_term', $term_id)) return new WP_Error('forbidden', 'Cannot edit this term', ['status' => 403]);
    return [$taxonomy, $term_id];
}
function agency_os_yoast_term_values($taxonomy, $term_id) {
    $all = get_option('wpseo_taxonomy_meta', []); $raw = isset($all[$taxonomy][$term_id]) && is_array($all[$taxonomy][$term_id]) ? $all[$taxonomy][$term_id] : [];
    return ['title'=>(string)($raw['wpseo_title']??''),'description'=>(string)($raw['wpseo_desc']??''),'focus_keyword'=>(string)($raw['wpseo_focuskw']??''),'robots_noindex'=>(($raw['wpseo_noindex']??'')==='noindex'),'robots_nofollow'=>(($raw['wpseo_nofollow']??'')==='nofollow'),'canonical'=>(string)($raw['wpseo_canonical']??''),'og_title'=>(string)($raw['wpseo_opengraph-title']??''),'og_description'=>(string)($raw['wpseo_opengraph-description']??'')];
}
function agency_os_get_yoast_term_meta($r) {
    $target = agency_os_yoast_term_target($r); if (is_wp_error($target)) return $target;
    return ['taxonomy'=>$target[0], 'term_id'=>$target[1], 'meta'=>agency_os_yoast_term_values($target[0], $target[1])];
}
function agency_os_update_yoast_term_meta($r) {
    $target = agency_os_yoast_term_target($r); if (is_wp_error($target)) return $target; list($taxonomy,$term_id)=$target;
    $all=get_option('wpseo_taxonomy_meta',[]); if(!is_array($all))$all=[]; if(!isset($all[$taxonomy])||!is_array($all[$taxonomy]))$all[$taxonomy]=[];
    $raw=isset($all[$taxonomy][$term_id])&&is_array($all[$taxonomy][$term_id])?$all[$taxonomy][$term_id]:[];
    $map=['title'=>'wpseo_title','description'=>'wpseo_desc','focus_keyword'=>'wpseo_focuskw','canonical'=>'wpseo_canonical','og_title'=>'wpseo_opengraph-title','og_description'=>'wpseo_opengraph-description'];
    foreach($map as $input=>$key) if($r->has_param($input)) $raw[$key]=sanitize_text_field((string)$r->get_param($input));
    if($r->has_param('robots_noindex'))$raw['wpseo_noindex']=$r->get_param('robots_noindex')?'noindex':'index';
    if($r->has_param('robots_nofollow'))$raw['wpseo_nofollow']=$r->get_param('robots_nofollow')?'nofollow':'follow';
    if (class_exists('WPSEO_Taxonomy_Meta') && method_exists('WPSEO_Taxonomy_Meta', 'set_values')) {
        WPSEO_Taxonomy_Meta::set_values($term_id, $taxonomy, $raw);
    } else {
        $all[$taxonomy][$term_id]=$raw; update_option('wpseo_taxonomy_meta',$all,false);
    }
    $term=get_term($term_id,$taxonomy); if($term && !is_wp_error($term)) wp_update_term($term_id,$taxonomy,['name'=>$term->name]);
    clean_term_cache($term_id,$taxonomy);
    return ['updated'=>true,'taxonomy'=>$taxonomy,'term_id'=>$term_id,'meta'=>agency_os_yoast_term_values($taxonomy,$term_id)];
}`;
      let existing = null;
      try {
        const snippets = await wpReq('/code-snippets/v1/snippets');
        existing = (Array.isArray(snippets) ? snippets : []).find(s => s.name === snippetName) || null;
      } catch (error) {
        if (error.message.includes('rest_no_route')) return { success: false, verified: false, error: 'Code Snippets REST API not found.' };
        throw error;
      }
      const snippet = existing
        ? await wpReq(`/code-snippets/v1/snippets/${existing.id}`, { method: 'POST', body: { name: snippetName, code: snippetCode, scope: 'global', active: true } })
        : await wpReq('/code-snippets/v1/snippets', { method: 'POST', body: { name: snippetName, desc: 'Authenticated Yoast taxonomy-term metadata route for WordPress MCP.', code: snippetCode, scope: 'global', active: true } });
      await new Promise(resolve => setTimeout(resolve, 1000));
      const verified = await routeLive();
      return { success: verified, verified, via: 'code-snippet', snippet_id: snippet.id ?? existing?.id };
    }

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
        objectType: args.object_type,
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
        restBase: args.rest_base,
        objectType: args.object_type
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
