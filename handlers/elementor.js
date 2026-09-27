// handlers/elementor.js
// Tool handlers for the "elementor" toolset (see toolsets.js / tool-definitions/elementor.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { ATOMIC_CONTAINER_TYPES, ATOMIC_WIDGET_TYPES, factory as atomicFactory, props as atomicProps, unwrap as atomicUnwrap, widgets as atomicWidgets, isAtomicType } from '../elementor-atomic.js';
import { BLOCKS_MANIFEST, getBlock, listBlocks, parseElementorData, spliceBlock } from '../elementor-blocks-library.js';
import { ELEMENTOR_META_KEYS, POST_NON_TAX_FIELDS, SEO_META_KEYS } from '../wp-meta-keys.js';
import { HEAVY_FETCH_TIMEOUT_MS } from '../mcp-hardening.js';
import { adaptModuleStructure, atomicStatusCache, extractPageState, fetchElementorStructureViaModule, moduleFeatureOn, probeAtomicStatus, probeElementorModule, regenerateElementorCss, statePayload, updatePageRouted, writeElementorData } from '../elementor-helpers.js';
import { applyReplaceText, walkElementorReplace } from '../elementor-replace-text.js';
import { buildGuidelines } from '../elementor-guidelines.js';
import { duplicateElementById, findElementById, findWidgets, insertElement, moveElementById, normalizeWidget, patchElementById, removeElementById, reorderChildren, summarizeTree } from '../elementor-tree.js';
import fs from 'fs';
import { NOT_HANDLED } from './not-handled.js';

export async function handleElementor(name, args, ctx) {
  const { clientConfig, wpReq } = ctx;
  switch (name) {

    // ELEMENTOR
    case 'wp_elementor_get_page': {
      const page = await wpReq(`/wp/v2/pages/${args.id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      return page;
    }


    case 'wp_elementor_get_page_by_slug': {
      const pages = await wpReq(`/wp/v2/pages?slug=${encodeURIComponent(args.slug)}&_fields=id`);
      if (pages && pages.length > 0) {
        return { id: pages[0].id };
      }
      throw new Error(`Page with slug '${args.slug}' not found.`);
    }


    case 'wp_elementor_create_page': {
      if (args.elementor_data && typeof args.elementor_data === 'string') {
        try { JSON.parse(args.elementor_data); } catch (e) {
          throw new Error('elementor_data is not valid JSON string.');
        }
      }
      const created = await wpReq('/wp/v2/pages', {
        method: 'POST',
        body: {
          title: args.title,
          status: args.status || 'draft',
          content: args.content || ''
        }
      });
      // Write _elementor_data through the privileged route (core REST rejects
      // protected meta writes), with a fallback to the core write inside.
      let elementorWrite = null;
      if (args.elementor_data) {
        elementorWrite = await writeElementorData(wpReq, created.id, args.elementor_data);
      }
      return { id: created.id, title: created.title?.rendered || args.title, elementor_write: elementorWrite };
    }


    case 'wp_elementor_update_page': {
      const updatePayload = {};
      if (args.title !== undefined) updatePayload.title = args.title;
      if (args.status !== undefined) updatePayload.status = args.status;
      if (args.content !== undefined) updatePayload.content = args.content;
      if (args.elementor_data) {
        if (typeof args.elementor_data === 'string') {
          try { JSON.parse(args.elementor_data); } catch (e) {
            throw new Error('elementor_data is not valid JSON string.');
          }
        }
        updatePayload.meta = { _elementor_data: args.elementor_data };
      }
      if (Object.keys(updatePayload).length === 0) {
        throw new Error('No update data provided (title, status, content, or elementor_data).');
      }
      const elementorWrite = await updatePageRouted(wpReq, args.id, updatePayload);
      return { updated: true, id: args.id, elementor_write: elementorWrite };
    }


    case 'wp_elementor_delete_page': {
      await wpReq(`/wp/v2/pages/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    case 'wp_elementor_download_page': {
      const pageData = await wpReq(`/wp/v2/pages/${args.id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      if (args.only_elementor_data) {
        const elementorData = pageData.meta?._elementor_data ?? '';
        fs.writeFileSync(
          args.file_path,
          typeof elementorData === 'string' ? elementorData : JSON.stringify(elementorData, null, 0)
        );
      } else {
        fs.writeFileSync(args.file_path, JSON.stringify(pageData, null, 0));
      }
      return { saved: true, path: args.file_path };
    }


    case 'wp_elementor_update_from_file': {
      const rawElementorData = fs.readFileSync(args.elementor_file_path, 'utf8');
      const parsedElementorData = JSON.parse(rawElementorData);
      const elementorData = typeof parsedElementorData === 'string'
        ? parsedElementorData
        : JSON.stringify(parsedElementorData, null, 0);
      const fileUpdatePayload = {
        meta: { _elementor_data: elementorData }
      };
      if (args.title !== undefined) fileUpdatePayload.title = args.title;
      if (args.status !== undefined) fileUpdatePayload.status = args.status;
      if (args.content_file_path) {
        fileUpdatePayload.content = fs.readFileSync(args.content_file_path, 'utf8');
      }
      const elementorWrite = await updatePageRouted(wpReq, args.id, fileUpdatePayload);
      return { updated: true, id: args.id, elementor_write: elementorWrite };
    }


    case 'wp_elementor_list_templates': {
      const tplParams = new URLSearchParams({
        per_page: String(args.per_page || 20),
        status: args.status || 'publish'
      });
      const templates = await wpReq(`/wp/v2/elementor_library?${tplParams}`);
      const result = (templates || []).map(t => ({
        id: t.id,
        title: t.title?.rendered || '',
        status: t.status,
        template_type: t.meta?._elementor_template_type || 'unknown',
        modified: t.modified
      }));
      if (args.template_type) {
        return result.filter(t => t.template_type === args.template_type);
      }
      return result;
    }


    case 'wp_elementor_get_template': {
      const template = await wpReq(`/wp/v2/elementor_library/${args.id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      return template;
    }


    case 'wp_elementor_list_revisions': {
      const revisions = await wpReq(`/wp/v2/pages/${args.id}/revisions?per_page=${args.per_page || 10}`);
      return (revisions || []).map(r => ({
        id: r.id,
        date: r.date,
        author: r.author,
        title: r.title?.rendered || '',
        has_elementor_data: !!(r.meta?._elementor_data)
      }));
    }


    case 'wp_elementor_list_blocks': {
      const blocks = listBlocks({ category: args.category });
      return {
        total: blocks.length,
        categories: [...new Set(BLOCKS_MANIFEST.map(b => b.category))].sort(),
        blocks
      };
    }


    case 'wp_elementor_get_block': {
      return await getBlock(args.block_id);
    }


    case 'wp_elementor_guidelines': {
      return await buildGuidelines(wpReq, {
        include_observed: args.include_observed !== false,
        sample_size: args.sample_size
      });
    }


    case 'wp_elementor_capabilities': {
      // Plugin slugs we look for. The values are the brand-friendly labels we
      // surface back. Keep this list short — the agent can probe specific
      // plugins via wp_list_plugins if it needs more.
      const KNOWN_ADDON_PACKS = {
        'elementor':                         'Elementor (core)',
        'elementor-pro':                     'Elementor Pro',
        'header-footer-elementor':           'Header Footer Elementor (HFE)',
        'ultimate-elementor':                'Ultimate Addons for Elementor (UAE)',
        'premium-addons-for-elementor':      'Premium Addons for Elementor',
        'powerpack-elements':                'PowerPack',
        'essential-addons-for-elementor-lite': 'Essential Addons',
        'happy-elementor-addons':            'Happy Addons',
        'jet-engine':                        'JetEngine',
        'jet-elements':                      'JetElements',
        'jet-tabs':                          'JetTabs',
        'jet-blocks':                        'JetBlocks',
        'jet-blog':                          'JetBlog',
        'jet-menu':                          'JetMenu',
        'jet-popup':                         'JetPopup',
        'jet-smart-filters':                 'JetSmartFilters',
        'elementskit-lite':                  'ElementsKit',
        'the-plus-addons-for-elementor':     'The Plus Addons',
        'exclusive-addons-for-elementor':    'Exclusive Addons',
        'master-addons':                     'Master Addons'
      };

      // Read installed plugins. /wp/v2/plugins returns entries shaped like
      // { plugin: "elementor/elementor", status, name, version, ... }.
      let plugins = [];
      try {
        plugins = await wpReq('/wp/v2/plugins?context=edit');
      } catch (e) {
        // Some sites lock down /wp/v2/plugins for non-admins. Continue with
        // partial info; agent can still query other endpoints.
      }
      if (!Array.isArray(plugins)) plugins = [];

      const detected = {};
      let elementorVersion = null;
      let proActive = false;
      let proVersion = null;
      for (const p of plugins) {
        const slug = (p.plugin || '').split('/')[0];
        if (!slug || !(slug in KNOWN_ADDON_PACKS)) continue;
        detected[slug] = {
          label: KNOWN_ADDON_PACKS[slug],
          active: p.status === 'active',
          version: p.version || null
        };
        if (slug === 'elementor' && p.status === 'active') elementorVersion = p.version || null;
        if (slug === 'elementor-pro' && p.status === 'active') {
          proActive = true;
          proVersion = p.version || null;
        }
      }

      // Active kit id, if exposed.
      let activeKitId = null;
      try {
        const settings = await wpReq('/wp/v2/settings');
        if (settings && typeof settings.elementor_active_kit === 'number') {
          activeKitId = settings.elementor_active_kit;
        }
      } catch { /* settings may be locked down */ }

      // Container experiment is ON by default from Elementor 3.6 (Aug 2022).
      // A robust check requires an option read; we surface it as a heuristic.
      const containerLikely = (() => {
        if (!elementorVersion) return null;
        const major = parseInt(elementorVersion.split('.')[0] || '0', 10);
        const minor = parseInt(elementorVersion.split('.')[1] || '0', 10);
        if (major > 3) return true;
        if (major === 3 && minor >= 6) return true;
        return false;
      })();

      // Atomic (V4) support can't be inferred from the version number — Elementor
      // ships it as opt-in experiments while ELEMENTOR_VERSION stays 3.x. The
      // authoritative answer comes from the PHP probe route installed by
      // wp_bootstrap_elementor_writer. Best-effort: if the route isn't installed
      // we report supported:null so the agent knows detection is unavailable.
      let atomic = {
        supported: null,
        detail: 'Probe route not installed or not responding — run wp_bootstrap_elementor_writer to enable atomic detection.'
      };
      const status = await probeAtomicStatus(wpReq, { clientKey: clientConfig?.name || 'default' });
      if (status) {
        atomic = {
          supported: !!status.atomic_supported,
          registered_types: status.registered_types || [],
          active_experiments: status.active_experiments || [],
          elementor_version: status.elementor_version ?? elementorVersion
        };
      }

      // Strudel Elementor module: server-side endpoints (CSS regen, widget
      // registry) available when the Strudel AI Optimizer plugin v0.6.0+ is
      // installed. present:false => plugin missing or pre-0.6.0.
      const moduleCaps = await probeElementorModule(wpReq, { clientKey: clientConfig?.name || 'default' });
      const strudelModule = moduleCaps
        ? {
            present: true,
            module_version: moduleCaps.module_version ?? null,
            elementor_active: moduleCaps.elementor_active !== false,
            features: {
              regenerate_css: moduleFeatureOn(moduleCaps, 'regenerate_css'),
              widget_schemas: moduleFeatureOn(moduleCaps, 'widget_schemas'),
              global_kit: moduleFeatureOn(moduleCaps, 'global_kit'),
              structure: moduleFeatureOn(moduleCaps, 'structure')
            }
          }
        : { present: false, detail: 'Strudel Elementor module not detected (install/upgrade the Strudel AI Optimizer plugin to v0.6.0+).' };

      return {
        elementor: {
          installed: elementorVersion !== null || ('elementor' in detected),
          active: elementorVersion !== null,
          version: elementorVersion
        },
        elementor_pro: {
          installed: ('elementor-pro' in detected),
          active: proActive,
          version: proVersion
        },
        container_experiment_likely: containerLikely,
        atomic,
        strudel_module: strudelModule,
        active_kit_id: activeKitId,
        addon_packs: detected,
        plugins_endpoint_accessible: plugins.length > 0
      };
    }


    case 'wp_elementor_regenerate_css': {
      if (typeof args.page_id !== 'number') throw new Error('page_id (number) required');
      const scope = args.scope === 'all' ? 'all' : 'post';
      const result = await regenerateElementorCss(wpReq, args.page_id, {
        scope,
        clientKey: clientConfig?.name || 'default'
      });
      if (!result.regenerated) {
        const hint = {
          module_absent: 'Strudel AI Optimizer plugin missing or older than v0.6.0 — CSS regeneration endpoint not available.',
          elementor_inactive: 'Elementor is not active on this site.',
          feature_unavailable: 'The regenerate_css feature is not reported by the module.',
          request_failed: 'The regenerate-css request failed.'
        }[result.reason] || 'CSS regeneration was not performed.';
        return { ...result, page_id: args.page_id, hint };
      }
      return { ...result, page_id: args.page_id };
    }


    case 'wp_elementor_list_widget_types': {
      const caps = await probeElementorModule(wpReq, { clientKey: clientConfig?.name || 'default' });
      if (!moduleFeatureOn(caps, 'widget_schemas')) {
        return {
          available: false,
          reason: !caps ? 'module_absent' : (caps.elementor_active === false ? 'elementor_inactive' : 'feature_unavailable'),
          hint: 'Requires the Strudel AI Optimizer plugin (v0.6.0+) with Elementor active. Fall back to wp_elementor_list_blocks for curated blocks.'
        };
      }
      const qs = [];
      if (args.search) qs.push(`search=${encodeURIComponent(args.search)}`);
      if (args.category) qs.push(`category=${encodeURIComponent(args.category)}`);
      const path = `/strudel-elementor/v1/widgets${qs.length ? `?${qs.join('&')}` : ''}`;
      const widgets = await wpReq(path, { timeoutMs: 12000 });
      const list = Array.isArray(widgets) ? widgets : (widgets?.widgets || []);
      return { available: true, count: list.length, widgets: list };
    }


    case 'wp_elementor_get_widget_schema': {
      if (!args.widget || typeof args.widget !== 'string') throw new Error('widget (string) required');
      const caps = await probeElementorModule(wpReq, { clientKey: clientConfig?.name || 'default' });
      if (!moduleFeatureOn(caps, 'widget_schemas')) {
        return {
          available: false,
          reason: !caps ? 'module_absent' : (caps.elementor_active === false ? 'elementor_inactive' : 'feature_unavailable'),
          hint: 'Requires the Strudel AI Optimizer plugin (v0.6.0+) with Elementor active.'
        };
      }
      const tab = args.tab === 'all' ? 'all' : 'content';
      const schema = await wpReq(
        `/strudel-elementor/v1/widgets/${encodeURIComponent(args.widget)}?tab=${tab}`,
        { timeoutMs: 12000 }
      );
      return { available: true, tab, ...schema };
    }



    case 'wp_elementor_insert_block': {
      const block = await getBlock(args.block_id);
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const currentSections = parseElementorData(page.meta?._elementor_data);

      let position = args.position ?? 'end';
      if (typeof position === 'string' && /^\d+$/.test(position)) {
        position = parseInt(position, 10);
      }

      const merged = spliceBlock(currentSections, block.content, position);
      const serialized = JSON.stringify(merged);

      await writeElementorData(wpReq, args.page_id, serialized);

      return {
        inserted: true,
        page_id: args.page_id,
        block_id: args.block_id,
        block_title: block.title,
        sections_added: block.content.length,
        total_sections: merged.length,
        position
      };
    }


    // ── SURGICAL PRIMITIVES ──
    case 'wp_elementor_get_page_structure': {
      if (!args.page_id) throw new Error('page_id required');
      const clientKey = clientConfig?.name || 'default';

      // Prefer the server-side slim endpoint (Strudel module v0.8.0+): a few-KB
      // map instead of the whole _elementor_data blob, which is what times out
      // on heavy pages. Returns null -> fall back to the core full-page read.
      const mod = await fetchElementorStructureViaModule(wpReq, args.page_id, {
        clientKey,
        maxDepth: Number.isInteger(args.max_depth) ? args.max_depth : undefined
      });
      if (mod) {
        const adapted = adaptModuleStructure(mod);
        // Title via a tiny fields-limited read (small/fast) to keep the contract.
        let pageTitle = '';
        try {
          const meta = await wpReq(`/wp/v2/pages/${args.page_id}?_fields=id,title`, { timeoutMs: 10000, maxRetries: 1 });
          pageTitle = meta?.title?.rendered || '';
        } catch { /* title is best-effort */ }
        return {
          page_id: Number(args.page_id),
          page_title: pageTitle,
          stats: adapted.stats,
          widget_types: adapted.widget_types,
          tree: adapted.tree,
          source: 'strudel_module'
        };
      }

      // Fallback: core full-page read. Transfers the entire _elementor_data blob,
      // so use the longer ceiling to avoid timing out on large pages.
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,title,meta`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const tree = parseElementorData(page.meta?._elementor_data);
      const summary = summarizeTree(tree, { max_snippet_length: args.max_snippet_length });
      return {
        page_id: page.id,
        page_title: page.title?.rendered || '',
        stats: summary.stats,
        tree: summary.tree,
        source: 'core'
      };
    }


    case 'wp_elementor_get_widget_settings': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const tree = parseElementorData(page.meta?._elementor_data);
      const hit = findElementById(tree, args.element_id);
      if (!hit) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);
      // Atomic (V4) elements store every value in a $$type envelope, which is
      // noisy to read. When we detect one, also return a flattened, readable
      // view of its settings (heading title, link target, sizes as "24px", …).
      const isAtomic = isAtomicType(hit.element.elType) || isAtomicType(hit.element.widgetType);
      return {
        page_id: page.id,
        element_id: hit.element.id,
        elType: hit.element.elType,
        widgetType: hit.element.widgetType || null,
        is_atomic: isAtomic,
        settings: hit.element.settings || {},
        ...(isAtomic ? { settings_readable: atomicUnwrap(hit.element.settings || {}) } : {}),
        child_count: Array.isArray(hit.element.elements) ? hit.element.elements.length : 0,
        ancestors_ids: hit.ancestors.map(a => a.id)
      };
    }


    case 'wp_elementor_update_widget': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      if (!args.settings_patch || typeof args.settings_patch !== 'object') {
        throw new Error('settings_patch (object) required');
      }
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const hit = findElementById(tree, args.element_id);
      if (!hit) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);

      const beforeSettings = hit.element.settings || {};
      const newTree = patchElementById(tree, args.element_id, (el) => ({
        ...el,
        settings: args.replace_settings
          ? { ...args.settings_patch }
          : { ...el.settings, ...args.settings_patch }
      }));
      if (!newTree) throw new Error('Patch failed unexpectedly');

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;
      const verified = verifyBytes === serialized.length;

      return {
        updated: true,
        page_id: args.page_id,
        element_id: args.element_id,
        verified,
        bytes_written: serialized.length,
        changed_keys: args.replace_settings
          ? Object.keys(args.settings_patch)
          : Object.keys(args.settings_patch).filter(k => beforeSettings[k] !== args.settings_patch[k]),
        previous_state: previousState
      };
    }


    case 'wp_elementor_duplicate_widget': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      const where = args.position || 'after';
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, duplicateId } = duplicateElementById(tree, args.element_id, where);
      if (!duplicateId) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        duplicated: true,
        page_id: args.page_id,
        source_id: args.element_id,
        new_id: duplicateId,
        position: where,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }


    case 'wp_elementor_insert_widget': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.widget) throw new Error('widget (object) required');
      if (args.position === undefined) throw new Error('position required');

      const widget = normalizeWidget(args.widget);
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, insertedId } = insertElement(tree, widget, args.position);
      const serialized = JSON.stringify(newTree);

      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        inserted: true,
        page_id: args.page_id,
        element_id: insertedId,
        widgetType: widget.widgetType || null,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }


    case 'wp_elementor_find_widgets': {
      if (!args.page_id) throw new Error('page_id required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const tree = parseElementorData(page.meta?._elementor_data);
      const matches = findWidgets(tree, {
        widget_type: args.widget_type,
        text_contains: args.text_contains,
        setting_equals: args.setting_equals && typeof args.setting_equals === 'object' ? args.setting_equals : undefined
      });
      return { page_id: args.page_id, count: matches.length, matches };
    }


    case 'wp_elementor_move_element': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      if (args.position === undefined) throw new Error('position required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, movedId } = moveElementById(tree, args.element_id, args.position);
      if (!movedId) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        moved: true,
        page_id: args.page_id,
        element_id: args.element_id,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }


    case 'wp_elementor_reorder_children': {
      if (!args.page_id) throw new Error('page_id required');
      if (!Array.isArray(args.order)) throw new Error('order (array of element ids) required');
      const parentId = args.parent_id === undefined ? null : args.parent_id;
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, ok, order } = reorderChildren(tree, parentId, args.order);
      if (!ok) throw new Error(`Parent ${parentId} not found on page ${args.page_id}`);

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        reordered: true,
        page_id: args.page_id,
        parent_id: parentId,
        order,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }


    case 'wp_elementor_remove_element': {
      if (!args.page_id) throw new Error('page_id required');
      if (!args.element_id) throw new Error('element_id required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, removed } = removeElementById(tree, args.element_id);
      if (!removed) throw new Error(`Element ${args.element_id} not found on page ${args.page_id}`);

      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        removed: true,
        page_id: args.page_id,
        element_id: args.element_id,
        removed_type: removed.widgetType || removed.elType || null,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }


    case 'wp_elementor_batch_update_widgets': {
      if (!args.page_id) throw new Error('page_id required');
      if (!Array.isArray(args.edits) || args.edits.length === 0) throw new Error('edits (non-empty array) required');
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      let tree = parseElementorData(page.meta?._elementor_data);

      const applied = [];
      const notFound = [];
      for (const edit of args.edits) {
        if (!edit || !edit.element_id || !edit.settings_patch || typeof edit.settings_patch !== 'object') {
          throw new Error('each edit needs element_id and settings_patch (object)');
        }
        const next = patchElementById(tree, edit.element_id, (el) => ({
          ...el,
          settings: edit.replace_settings
            ? { ...edit.settings_patch }
            : { ...el.settings, ...edit.settings_patch }
        }));
        if (!next) { notFound.push(edit.element_id); continue; }
        tree = next;
        applied.push(edit.element_id);
      }
      if (applied.length === 0) {
        throw new Error(`No matching elements on page ${args.page_id} (not found: ${notFound.join(', ')})`);
      }

      const serialized = JSON.stringify(tree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        updated: true,
        page_id: args.page_id,
        applied,
        not_found: notFound,
        applied_count: applied.length,
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        previous_state: previousState
      };
    }


    case 'wp_elementor_add_atomic': {
      if (!args.page_id) throw new Error('page_id required');
      const elementType = args.element_type;
      if (!isAtomicType(elementType)) {
        throw new Error(`element_type must be an atomic type (${[...ATOMIC_CONTAINER_TYPES, ...ATOMIC_WIDGET_TYPES].join(', ')})`);
      }

      // Pre-write atomic-support check. The probe route is the authoritative
      // signal; if it's installed and says atomic won't persist, refuse rather
      // than silently writing data Elementor will drop. If the route is absent
      // we proceed but surface a warning, and we use its version to stamp the
      // element when available.
      let version = typeof args.version === 'string' ? args.version : '';
      let atomicWarning = null;
      const status = await probeAtomicStatus(wpReq, { clientKey: clientConfig?.name || 'default' });
      if (status) {
        if (!version && status.elementor_version) version = String(status.elementor_version);
        if (status.atomic_supported === false && !args.skip_atomic_check) {
          return {
            inserted: false,
            error: 'atomic_not_supported',
            message: 'Elementor 4.0 atomic elements are not active on this site, so the write would be silently dropped. Enable the "Atomic Elements" / V4 experiment in Elementor → Settings → Features, or pass skip_atomic_check:true to build anyway.',
            atomic: status
          };
        }
      } else {
        atomicWarning = 'Atomic-support probe route did not respond (run wp_bootstrap_elementor_writer, or it may be slow). Built without a pre-check — verify the element persisted, and confirm the atomic experiment is active if it did not.';
      }

      // Build the element from flat params via the atomic format module.
      let element;
      if (ATOMIC_CONTAINER_TYPES.includes(elementType)) {
        const settings = {};
        if (args.tag) settings.tag = atomicProps.string(args.tag);
        const styleProps = {};
        for (const k of ['direction', 'justify', 'align', 'wrap', 'gap', 'gap_unit',
          'row_gap', 'column_gap', 'padding', 'padding_unit', 'padding_top', 'padding_right',
          'padding_bottom', 'padding_left', 'margin_top', 'margin_bottom', 'background_color',
          'color', 'min_height', 'width', 'border_radius']) {
          if (args[k] !== undefined) styleProps[k] = args[k];
        }
        if (args.css_id) settings._cssid = atomicProps.string(args.css_id);
        element = elementType === 'e-flexbox'
          ? atomicFactory.createFlexbox(settings, [], styleProps, version)
          : atomicFactory.createDivBlock(settings, [], styleProps, version);
      } else {
        const builderMap = {
          'e-heading': () => atomicWidgets.heading({ title: args.title, tag: args.tag, link: args.link, css_id: args.css_id, version }),
          'e-paragraph': () => atomicWidgets.paragraph({ content: args.content, link: args.link, css_id: args.css_id, version }),
          'e-button': () => atomicWidgets.button({ text: args.text, link: args.link, target_blank: args.target_blank, css_id: args.css_id, version }),
          'e-image': () => atomicWidgets.image({ image_id: args.image_id, image_url: args.image_url, alt: args.alt, link: args.link, css_id: args.css_id, version }),
          'e-svg': () => atomicWidgets.svg({ svg_id: args.svg_id, svg_url: args.svg_url, css_id: args.css_id, version }),
          'e-youtube': () => atomicWidgets.youtube({ video_url: args.video_url, css_id: args.css_id, version }),
          'e-self-hosted-video': () => atomicWidgets.video({ video_url: args.video_url, video_id: args.video_id, css_id: args.css_id, version }),
          'e-divider': () => atomicWidgets.divider({ css_id: args.css_id, version })
        };
        element = builderMap[elementType]();
      }

      const position = args.position ?? 'end';
      const page = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      const previousState = extractPageState(page);
      const tree = parseElementorData(page.meta?._elementor_data);

      const { tree: newTree, insertedId } = insertElement(tree, element, position);
      const serialized = JSON.stringify(newTree);
      await writeElementorData(wpReq, args.page_id, serialized);

      const verify = await wpReq(`/wp/v2/pages/${args.page_id}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string' ? verify.meta._elementor_data.length : 0;

      return {
        inserted: true,
        page_id: args.page_id,
        element_id: insertedId,
        element_type: elementType,
        is_container: ATOMIC_CONTAINER_TYPES.includes(elementType),
        verified: verifyBytes === serialized.length,
        bytes_written: serialized.length,
        ...(atomicWarning ? { warning: atomicWarning } : {}),
        previous_state: previousState
      };
    }


    // ── CONTROL PLANE ──
    // Pure REST, stateless. Destructive ops return `previous_state` so the
    // caller can pass it back to wp_restore_page_state to roll back.
    case 'wp_publish_draft_over': {
      const draftId = args.draft_id;
      const targetId = args.target_id;
      const copySeo = args.copy_seo !== false;
      const copyFeaturedImage = args.copy_featured_image !== false;
      const copyTaxonomies = args.copy_taxonomies === true;
      const extraMetaKeys = Array.isArray(args.extra_meta_keys) ? args.extra_meta_keys : [];

      if (!draftId || !targetId) throw new Error('draft_id and target_id required');
      if (draftId === targetId) throw new Error('draft_id and target_id must differ');

      const draft = await wpReq(`/wp/v2/pages/${draftId}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      if (!draft || !draft.id) throw new Error(`Draft page ${draftId} not found`);
      const target = await wpReq(`/wp/v2/pages/${targetId}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      if (!target || !target.id) throw new Error(`Target page ${targetId} not found`);

      const previousState = extractPageState(target);

      const payload = {
        title: draft.title?.raw ?? draft.title?.rendered ?? '',
        content: draft.content?.raw ?? draft.content?.rendered ?? '',
        excerpt: draft.excerpt?.raw ?? ''
      };
      if (draft.template !== undefined && draft.template !== null) payload.template = draft.template;
      if (typeof draft.menu_order === 'number') payload.menu_order = draft.menu_order;
      if (copyFeaturedImage && draft.featured_media) payload.featured_media = draft.featured_media;

      const wantedMetaKeys = [...ELEMENTOR_META_KEYS];
      if (copySeo) wantedMetaKeys.push(...SEO_META_KEYS);
      if (extraMetaKeys.length) wantedMetaKeys.push(...extraMetaKeys);

      const meta = {};
      const copiedMetaKeys = [];
      const draftMeta = draft.meta || {};
      for (const key of wantedMetaKeys) {
        if (!(key in draftMeta)) continue;
        const value = draftMeta[key];
        if (value === '' || value === null) continue;
        meta[key] = (key === '_elementor_data' && typeof value !== 'string')
          ? JSON.stringify(value)
          : value;
        copiedMetaKeys.push(key);
      }
      if (Object.keys(meta).length > 0) payload.meta = meta;

      const copiedTaxonomies = [];
      if (copyTaxonomies) {
        for (const [k, v] of Object.entries(draft)) {
          if (POST_NON_TAX_FIELDS.has(k)) continue;
          if (Array.isArray(v) && v.every(x => Number.isInteger(x))) {
            payload[k] = v;
            copiedTaxonomies.push(k);
          }
        }
      }

      await updatePageRouted(wpReq, targetId, payload);

      const verify = await wpReq(`/wp/v2/pages/${targetId}?context=edit&_fields=id,meta`);
      const verifyBytes = typeof verify?.meta?._elementor_data === 'string'
        ? verify.meta._elementor_data.length
        : 0;
      const expectedElementor = meta._elementor_data;
      const verified = expectedElementor === undefined
        ? true
        : verifyBytes === expectedElementor.length;

      if (!verified) {
        throw new Error(
          `Verify failed: wrote ${expectedElementor.length} bytes of _elementor_data but read back ${verifyBytes}. ` +
          `Draft ${draftId} NOT deleted. Use wp_restore_page_state with the previous_state from a prior wp_get_page_state call if you need to recover target ${targetId}.`
        );
      }

      await wpReq(`/wp/v2/pages/${draftId}?force=true`, { method: 'DELETE' });

      return {
        published: true,
        target_id: targetId,
        deleted_draft_id: draftId,
        verified: true,
        elementor_bytes: verifyBytes,
        copied: {
          featured_image: copyFeaturedImage && !!draft.featured_media,
          template: payload.template !== undefined,
          menu_order: payload.menu_order !== undefined,
          excerpt: !!payload.excerpt,
          meta_keys: copiedMetaKeys,
          taxonomies: copiedTaxonomies
        },
        previous_state: previousState,
        rollback_hint: `To undo: call wp_restore_page_state with post_id=${targetId} and the previous_state above.`
      };
    }


    case 'wp_replace_text': {
      const postId = args.post_id;
      const find = args.find;
      const replace = args.replace ?? '';
      const regex = args.regex === true;
      const ci = args.case_insensitive === true;
      const dryRun = args.dry_run === true;

      if (!postId || typeof find !== 'string' || find === '') {
        throw new Error('post_id and non-empty find required');
      }

      const page = await wpReq(`/wp/v2/pages/${postId}?context=edit`, { timeoutMs: HEAVY_FETCH_TIMEOUT_MS });
      if (!page || !page.id) throw new Error(`Page ${postId} not found`);

      const counter = { replacements: 0, fields: {} };

      const contentRaw = page.content?.raw ?? '';
      const [newContent, contentHits] = applyReplaceText(contentRaw, find, replace, regex, ci);
      if (contentHits > 0) {
        counter.replacements += contentHits;
        counter.fields.post_content = contentHits;
      }

      const rawElementor = page.meta?._elementor_data;
      let newElementorString = null;
      let elementorChanged = false;
      if (typeof rawElementor === 'string' && rawElementor !== '') {
        let tree;
        try { tree = JSON.parse(rawElementor); } catch { tree = null; }
        if (Array.isArray(tree)) {
          walkElementorReplace(tree, find, replace, regex, ci, counter);
          newElementorString = JSON.stringify(tree);
          elementorChanged = newElementorString !== rawElementor;
        }
      }

      if (dryRun || counter.replacements === 0) {
        return {
          dry_run: dryRun,
          applied: false,
          post_id: postId,
          matches: counter.replacements,
          fields: counter.fields,
          would_change: {
            post_content: contentHits > 0,
            elementor_data: elementorChanged
          }
        };
      }

      const previousState = extractPageState(page);

      const writePayload = {};
      if (contentHits > 0) writePayload.content = newContent;
      if (elementorChanged) writePayload.meta = { _elementor_data: newElementorString };
      await updatePageRouted(wpReq, postId, writePayload);

      const after = await wpReq(`/wp/v2/pages/${postId}?context=edit&_fields=id,meta`);
      const afterBytes = typeof after?.meta?._elementor_data === 'string'
        ? after.meta._elementor_data.length
        : 0;
      const expectedBytes = elementorChanged
        ? newElementorString.length
        : (typeof rawElementor === 'string' ? rawElementor.length : 0);

      return {
        applied: true,
        post_id: postId,
        matches: counter.replacements,
        fields: counter.fields,
        content_changed: contentHits > 0,
        elementor_changed: elementorChanged,
        verified: afterBytes === expectedBytes,
        elementor_bytes: afterBytes,
        previous_state: previousState,
        rollback_hint: `To undo: call wp_restore_page_state with post_id=${postId} and the previous_state above.`
      };
    }


    case 'wp_get_page_state': {
      const postId = args.post_id;
      if (!postId) throw new Error('post_id required');
      // Heaviest read in the toolset: a full rollback snapshot needs the whole
      // _elementor_data blob, so it can't be slimmed. But scope it to only the
      // fields extractPageState() reads (drops _links / yoast_head / embedded
      // extras), and give it the 60s ceiling so it stops timing out at 30s.
      const page = await wpReq(
        `/wp/v2/pages/${postId}?context=edit&_fields=id,title,content,excerpt,status,template,menu_order,featured_media,meta`,
        { timeoutMs: HEAVY_FETCH_TIMEOUT_MS }
      );
      if (!page || !page.id) throw new Error(`Page ${postId} not found`);
      return { state: extractPageState(page) };
    }


    case 'wp_restore_page_state': {
      const postId = args.post_id;
      const state = args.state;
      if (!postId) throw new Error('post_id required');
      if (!state || typeof state !== 'object') throw new Error('state object required');

      const payload = statePayload(state);
      await updatePageRouted(wpReq, postId, payload);

      const after = await wpReq(`/wp/v2/pages/${postId}?context=edit&_fields=id,meta`);
      const afterBytes = typeof after?.meta?._elementor_data === 'string'
        ? after.meta._elementor_data.length
        : 0;
      const expectedElementor = payload.meta?._elementor_data;
      const verified = expectedElementor === undefined
        ? true
        : afterBytes === expectedElementor.length;

      return {
        restored: true,
        post_id: postId,
        verified,
        elementor_bytes: afterBytes,
        wrote: {
          title: !!payload.title,
          content: !!payload.content,
          excerpt: !!payload.excerpt,
          template: payload.template !== undefined,
          menu_order: payload.menu_order !== undefined,
          featured_media: payload.featured_media != null,
          meta_keys: payload.meta ? Object.keys(payload.meta) : []
        }
      };
    }


    case 'wp_bootstrap_elementor_writer': {
      const force = args.force || false;
      const steps = [];

      // Treat anything other than rest_no_route as "route is live". Bound the
      // probe so a slow site doesn't hang verification for the full 30s default.
      const routeLive = async () => {
        try {
          await wpReq('/agency-os/v1/elementor-data', { method: 'POST', body: JSON.stringify({}), timeoutMs: 12000 });
          return true;
        } catch (error) {
          return !error.message.includes('rest_no_route');
        }
      };

      if (!force && await routeLive()) {
        return { success: true, message: 'Elementor write route already installed', steps: ['Route is responding'] };
      }

      // The route is registered directly inside an active global snippet — no
      // mu-plugin, no file write. The function_exists guard avoids a fatal
      // redeclare if the File API mu-plugin also defines it on the same site.
      const snippetName = 'Agency OS Elementor Writer';
      const snippetCode = `if (!defined('ABSPATH')) exit;

add_action('rest_api_init', function() {
    register_rest_route('agency-os/v1', '/elementor-data', [
        'methods' => 'POST',
        'callback' => 'agency_os_set_elementor_data',
        'permission_callback' => function() { return current_user_can('edit_posts'); }
    ]);
    register_rest_route('agency-os/v1', '/elementor-atomic-status', [
        'methods' => 'GET',
        'callback' => 'agency_os_elementor_atomic_status',
        'permission_callback' => function() { return current_user_can('edit_posts'); }
    ]);
});

if (!function_exists('agency_os_set_elementor_data')) {
function agency_os_set_elementor_data($r) {
    $post_id = (int) $r->get_param('post_id');
    $data = $r->get_param('elementor_data');
    if (!$post_id || get_post_status($post_id) === false) return new WP_Error('not_found', 'Post not found', ['status' => 404]);
    if (!current_user_can('edit_post', $post_id)) return new WP_Error('forbidden', 'Cannot edit this post', ['status' => 403]);
    if (!is_string($data)) return new WP_Error('invalid', 'elementor_data must be a string', ['status' => 400]);
    json_decode($data, true);
    if (json_last_error() !== JSON_ERROR_NONE) return new WP_Error('invalid_json', 'Invalid JSON: ' . json_last_error_msg(), ['status' => 400]);
    // Raw meta write (NOT Document::save) so atomic/V4 elements persist byte-for-byte
    // instead of being silently sanitized away when the page editor isn't opted in.
    // This also keeps the byte-length verification used by the Node tools exact.
    update_post_meta($post_id, '_elementor_data', wp_slash($data));
    update_post_meta($post_id, '_elementor_edit_mode', 'builder');
    // Stamp the Elementor version that authored this data (atomic CSS generation
    // keys off it). Harmless for classic pages — mirrors Elementor's own save.
    if (defined('ELEMENTOR_VERSION')) update_post_meta($post_id, '_elementor_version', ELEMENTOR_VERSION);
    // Drop the cached CSS so Elementor regenerates it (incl. atomic local-class
    // styles) on next front-end view.
    delete_post_meta($post_id, '_elementor_css');
    if (class_exists('\\Elementor\\Plugin')) {
        $e = \Elementor\Plugin::instance();
        if (isset($e->files_manager) && method_exists($e->files_manager, 'clear_cache')) {
            $e->files_manager->clear_cache();
        }
    }
    $written = get_post_meta($post_id, '_elementor_data', true);
    return ['success' => true, 'post_id' => $post_id, 'bytes' => strlen(is_string($written) ? $written : '')];
}
}

if (!function_exists('agency_os_elementor_atomic_status')) {
function agency_os_elementor_atomic_status() {
    // Atomic (V4) support is NOT a version check: Elementor ships atomic as
    // opt-in experiments while ELEMENTOR_VERSION still reports 3.x. The
    // authoritative signal is whether the atomic element TYPES are registered
    // server-side, because Document::save() keeps only registered types.
    $registered_types = [];
    $active_experiments = [];
    if (class_exists('\\Elementor\\Plugin')) {
        $e = \Elementor\Plugin::instance();
        if (isset($e->elements_manager) && method_exists($e->elements_manager, 'get_element_types')) {
            $t = $e->elements_manager->get_element_types();
            if (is_array($t)) {
                foreach (['e-flexbox', 'e-div-block'] as $slug) {
                    if (isset($t[$slug])) $registered_types[] = $slug;
                }
            }
        }
        if (isset($e->experiments) && method_exists($e->experiments, 'is_feature_active')) {
            foreach (['e_atomic_elements', 'atomic_widgets'] as $f) {
                if ($e->experiments->is_feature_active($f)) $active_experiments[] = $f;
            }
        }
    }
    $version = defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null;
    $supported = !empty($registered_types)
        || !empty($active_experiments)
        || ($version && version_compare($version, '4.0.0', '>='));
    return [
        'atomic_supported'   => (bool) $supported,
        'registered_types'   => $registered_types,
        'active_experiments' => $active_experiments,
        'elementor_version'  => $version,
    ];
}
}`;

      // Reuse an existing snippet with this name if present (so re-running
      // updates in place instead of piling up duplicates).
      let existing = null;
      try {
        const all = await wpReq('/code-snippets/v1/snippets');
        existing = (Array.isArray(all) ? all : []).find(s => s.name === snippetName) || null;
      } catch (error) {
        if (error.message.includes('rest_no_route')) {
          return {
            success: false,
            error: 'Code Snippets REST API not found. Install & activate the "Code Snippets" plugin first.',
            steps: ['Install the Code Snippets plugin, then re-run wp_bootstrap_elementor_writer.']
          };
        }
        steps.push('Could not list existing snippets: ' + error.message);
      }

      let snippet;
      if (existing) {
        steps.push(`Updating existing snippet (ID ${existing.id})...`);
        snippet = await wpReq(`/code-snippets/v1/snippets/${existing.id}`, {
          method: 'POST',
          body: { name: snippetName, code: snippetCode, scope: 'global', active: true }
        });
      } else {
        steps.push('Creating Elementor write-route snippet...');
        snippet = await wpReq('/code-snippets/v1/snippets', {
          method: 'POST',
          body: {
            name: snippetName,
            desc: 'Registers the privileged agency-os/v1/elementor-data REST route used by WordPress MCP to write _elementor_data.',
            code: snippetCode,
            scope: 'global',
            active: true
          }
        });
      }
      steps.push(`Snippet saved (ID ${snippet.id ?? existing?.id}), verifying route...`);

      await new Promise(resolve => setTimeout(resolve, 1000));
      const verified = await routeLive();
      steps.push(verified ? 'Elementor write route verified!' : 'Route not responding yet — it may need a moment to register.');

      // The snippet (re)registers the atomic-status route, so drop any cached
      // probe result for this client — otherwise a stale "not installed" negative
      // could linger for up to a minute and make capabilities/add_atomic lie.
      atomicStatusCache.delete(clientConfig?.name || 'default');

      return {
        success: verified,
        via: 'code-snippet',
        snippet_id: snippet.id ?? existing?.id,
        verified,
        message: verified
          ? 'Elementor write route installed via active Code Snippet (no mu-plugin).'
          : 'Snippet saved but route not verified yet. Re-run wp_check_file_api shortly.',
        steps
      };
    }
  }
  return NOT_HANDLED;
}
