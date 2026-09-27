// handlers/core.js
// Tool handlers for the "core" toolset (see toolsets.js / tool-definitions/core.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { getAllClientConfigs, invalidateClientCache, loadClientsFromDB } from '../clients.js';
import { NOT_HANDLED } from './not-handled.js';

export async function handleCore(name, args, ctx) {
  const { wpReq, auditLog } = ctx;
  switch (name) {
    case 'wp_list_clients': {
      const clients = await getAllClientConfigs();
      return { 
        clients,
        count: clients.length,
        source: clients[0]?.source || 'none'
      };
    }


    case 'wp_refresh_clients': {
      invalidateClientCache();
      const clients = await loadClientsFromDB();
      return { 
        success: true,
        count: clients?.length || 0,
        message: clients ? 'Cache refreshed from database' : 'Using ENV fallback'
      };
    }


    // ── AUDIT LOG ──
    case 'wp_audit_log': {
      const rows = await auditLog.query({
        client: args.filter_client,
        tool: args.tool,
        target_id: args.target_id,
        since: args.since,
        failed_only: args.failed_only,
        limit: args.limit
      });
      return { count: rows.length, entries: rows };
    }


    // SITE INFO
    case 'wp_get_site_info': {
      const settings = await wpReq('/wp/v2/settings');
      return {
        title: settings.title,
        description: settings.description,
        url: settings.url,
        timezone: settings.timezone,
        language: settings.language,
        date_format: settings.date_format,
        time_format: settings.time_format,
        show_on_front: settings.show_on_front,
        page_on_front: settings.page_on_front || 0,
        page_for_posts: settings.page_for_posts || 0,
        posts_per_page: settings.posts_per_page || 10,
        default_category: settings.default_category || 1,
        default_post_format: settings.default_post_format || '0'
      };
    }
  }
  return NOT_HANDLED;
}
