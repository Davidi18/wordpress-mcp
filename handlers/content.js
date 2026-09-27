// handlers/content.js
// Tool handlers for the "content" toolset (see toolsets.js / tool-definitions/content.js).
// Returns NOT_HANDLED for tool names this toolset doesn't own.
import { readPostWithExtras, writePost } from '../post-helpers.js';
import { resolveYoastPostType, updateYoastMeta } from '../yoast-bulk-editor.js';
import { NOT_HANDLED } from './not-handled.js';

export async function handleContent(name, args, ctx) {
  const { wpReq, currentAuthHeader } = ctx;
  switch (name) {

    // POSTS
    case 'wp_get_posts': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'publish'
      });
      if (args.search) params.append('search', args.search);
      if (args.author) params.append('author', String(args.author));
      if (args.categories) params.append('categories', args.categories);
      
      const posts = await wpReq(`/wp/v2/posts?${params}`);
      return { posts: posts.map(p => ({ id: p.id, title: p.title.rendered, excerpt: p.excerpt.rendered, date: p.date, link: p.link })) };
    }


    case 'wp_get_post': {
      const { post, extras } = await readPostWithExtras(wpReq, 'posts', args);
      return { 
        id: post.id, 
        title: post.title.rendered, 
        content: post.content.rendered, 
        excerpt: post.excerpt.rendered,
        date: post.date,
        status: post.status,
        link: post.link,
        ...extras
      };
    }


    case 'wp_create_post': {
      const postData = {
        title: args.title,
        content: args.content,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags
      };
      if (args.slug) postData.slug = args.slug;
      if (args.featured_media) postData.featured_media = args.featured_media;
      if (args.meta) postData.meta = args.meta;
      const post = await wpReq('/wp/v2/posts', {
        method: 'POST',
        body: JSON.stringify(postData)
      });
      return {
        id: post.id,
        title: post.title.rendered,
        slug: post.slug,
        link: post.link,
        status: post.status,
        date: post.date,
        modified: post.modified,
        excerpt: post.excerpt?.rendered,
        author: post.author,
        categories: post.categories,
        tags: post.tags,
        featured_media: post.featured_media
      };
    }


    case 'wp_update_post': {
      const updates = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.content !== undefined) updates.content = args.content;
      if (args.status !== undefined) updates.status = args.status;
      if (args.excerpt !== undefined) updates.excerpt = args.excerpt;
      if (args.meta !== undefined) updates.meta = args.meta;
      // Yoast SEO shorthand
      if (args.yoast_title !== undefined || args.yoast_desc !== undefined || args.yoast_canonical !== undefined) {
        updates.meta = updates.meta || {};
        if (args.yoast_title !== undefined) updates.meta['yoast_wpseo_title'] = args.yoast_title;
        if (args.yoast_desc !== undefined) updates.meta['yoast_wpseo_metadesc'] = args.yoast_desc;
        if (args.yoast_canonical !== undefined) updates.meta['yoast_wpseo_canonical'] = args.yoast_canonical;
      }

      const { post, acf: acfUpdate } = await writePost(wpReq, 'posts', args.id, updates, args.acf);
      return {
        ...(acfUpdate ? { acf_update: acfUpdate } : {}),
        id: post.id,
        title: post.title.rendered,
        slug: post.slug,
        link: post.link,
        status: post.status,
        date: post.date,
        modified: post.modified,
        excerpt: post.excerpt?.rendered,
        author: post.author,
        categories: post.categories,
        tags: post.tags,
        featured_media: post.featured_media
      };
    }


    case 'wp_delete_post': {
      await wpReq(`/wp/v2/posts/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    // PAGES
    case 'wp_get_pages': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'publish'
      });
      if (args.search) params.append('search', args.search);
      
      const pages = await wpReq(`/wp/v2/pages?${params}`);
      return { pages: pages.map(p => ({ id: p.id, title: p.title.rendered, link: p.link })) };
    }


    case 'wp_get_page': {
      const { post: page, extras } = await readPostWithExtras(wpReq, 'pages', args);
      return {
        id: page.id,
        title: page.title.rendered,
        content: page.content.rendered,
        date: page.date,
        status: page.status,
        link: page.link,
        ...extras
      };
    }


    case 'wp_create_page': {
      const page = await wpReq('/wp/v2/pages', {
        method: 'POST',
        body: JSON.stringify({
          title: args.title,
          content: args.content,
          status: args.status || 'draft',
          ...(args.excerpt !== undefined ? { excerpt: args.excerpt } : {}),
          parent: args.parent
        })
      });
      return {
        id: page.id,
        title: page.title.rendered,
        slug: page.slug,
        link: page.link,
        status: page.status,
        date: page.date,
        modified: page.modified,
        parent: page.parent,
        author: page.author,
        featured_media: page.featured_media,
        menu_order: page.menu_order
      };
    }


    case 'wp_update_page': {
      const updates = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.content !== undefined) updates.content = args.content;
      if (args.status !== undefined) updates.status = args.status;
      // Pass excerpt through even when it's an empty string, so callers can
      // clear an existing excerpt with excerpt: "".
      if (args.excerpt !== undefined) updates.excerpt = args.excerpt;
      if (args.meta !== undefined) updates.meta = args.meta;
      // Yoast SEO shorthand
      if (args.yoast_title !== undefined || args.yoast_desc !== undefined || args.yoast_canonical !== undefined) {
        updates.meta = updates.meta || {};
        if (args.yoast_title !== undefined) updates.meta['yoast_wpseo_title'] = args.yoast_title;
        if (args.yoast_desc !== undefined) updates.meta['yoast_wpseo_metadesc'] = args.yoast_desc;
        if (args.yoast_canonical !== undefined) updates.meta['yoast_wpseo_canonical'] = args.yoast_canonical;
      }

      const { post: page, acf: acfUpdate } = await writePost(wpReq, 'pages', args.id, updates, args.acf);
      return {
        ...(acfUpdate ? { acf_update: acfUpdate } : {}),
        id: page.id,
        title: page.title.rendered,
        slug: page.slug,
        link: page.link,
        status: page.status,
        date: page.date,
        modified: page.modified,
        excerpt: page.excerpt?.raw ?? page.excerpt?.rendered ?? '',
        parent: page.parent,
        author: page.author,
        featured_media: page.featured_media,
        menu_order: page.menu_order
      };
    }


    case 'wp_delete_page': {
      await wpReq(`/wp/v2/pages/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    case 'wp_set_static_front_page': {
      if (typeof args.page_id !== 'number') throw new Error('page_id (number) required');
      const pageId = args.page_id;
      const postsPageId = typeof args.posts_page_id === 'number' ? args.posts_page_id : undefined;

      // Capture current state for rollback.
      const before = await wpReq('/wp/v2/settings');
      const previousState = {
        show_on_front: before?.show_on_front ?? null,
        page_on_front: before?.page_on_front ?? null,
        page_for_posts: before?.page_for_posts ?? null
      };

      const body = {};
      if (pageId === 0) {
        // Revert to "Your latest posts" mode.
        body.show_on_front = 'posts';
        body.page_on_front = 0;
        if (postsPageId !== undefined) body.page_for_posts = postsPageId;
      } else {
        body.show_on_front = 'page';
        body.page_on_front = pageId;
        if (postsPageId !== undefined) body.page_for_posts = postsPageId;
      }

      const after = await wpReq('/wp/v2/settings', { method: 'POST', body });
      return {
        updated: true,
        mode: body.show_on_front,
        page_on_front: after?.page_on_front ?? body.page_on_front,
        page_for_posts: after?.page_for_posts ?? null,
        previous_state: previousState
      };
    }


    // ── MENUS ──
    case 'wp_get_menus': {
      const menus = await wpReq('/wp/v2/menus');
      return (menus || []).map(m => ({
        id: m.id,
        name: m.name,
        slug: m.slug,
        description: m.description || '',
        locations: m.locations || [],
        count: m.count || 0
      }));
    }


    case 'wp_get_menu_items': {
      const items = await wpReq(`/wp/v2/menu-items?menus=${args.menu_id}&per_page=100`);
      return (items || []).map(item => ({
        id: item.id,
        title: item.title?.rendered || '',
        url: item.url,
        type: item.type,
        parent: item.parent || 0,
        menu_order: item.menu_order,
        object: item.object,
        object_id: item.object_id
      }));
    }


    // ── SEARCH ──
    case 'wp_search': {
      const searchParams = new URLSearchParams({
        search: args.search,
        per_page: String(args.per_page || 20)
      });
      if (args.type) searchParams.set('type', args.type);
      const results = await wpReq(`/wp/v2/search?${searchParams}`);
      return (results || []).map(r => ({
        id: r.id,
        title: r.title,
        url: r.url,
        type: r.type,
        subtype: r.subtype
      }));
    }


    // ── BULK OPERATIONS ──
    case 'wp_bulk_update_posts': {
      const parseMaybeJson = v => (typeof v === 'string' ? JSON.parse(v) : v);
      const updates = parseMaybeJson(args.updates) || {};
      const ids = parseMaybeJson(args.ids ?? args.post_ids);
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('ids (or post_ids) must be a non-empty array of post IDs.');
      }
      const { restBase } = await resolveYoastPostType({ wpReq, postType: args.post_type || 'posts' });
      const { acf, ...coreUpdates } = updates;
      const results = [];
      // Process in batches of 5 to avoid rate limits
      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const promises = batch.map(async (id) => {
          try {
            const { acf: acfUpdate } = await writePost(wpReq, restBase, id, coreUpdates, acf);
            return { id, success: true, ...(acfUpdate ? { acf: acfUpdate } : {}) };
          } catch (e) {
            return { id, success: false, error: e.message, ...(e.acfVerification ? { acf: e.acfVerification } : {}) };
          }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
        if (i + 5 < ids.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      return {
        post_type: restBase,
        total: ids.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };
    }


    // ── PAGE TREE ──
    case 'wp_get_page_tree': {
      const allPages = await wpReq(`/wp/v2/pages?per_page=${args.per_page || 100}&_fields=id,title,slug,parent,status,menu_order,link`);
      const pages = (allPages || []).map(p => ({
        id: p.id,
        title: p.title?.rendered || '',
        slug: p.slug,
        parent: p.parent || 0,
        status: p.status,
        menu_order: p.menu_order,
        link: p.link
      }));
      // Build tree structure
      const byId = {};
      pages.forEach(p => { byId[p.id] = { ...p, children: [] }; });
      const tree = [];
      pages.forEach(p => {
        if (p.parent && byId[p.parent]) {
          byId[p.parent].children.push(byId[p.id]);
        } else {
          tree.push(byId[p.id]);
        }
      });
      return { total: pages.length, tree };
    }


    // ── SETTINGS ──
    case 'wp_get_settings': {
      const settings = await wpReq('/wp/v2/settings');
      return {
        title: settings?.title || '',
        tagline: settings?.description || '',
        url: settings?.url || '',
        timezone: settings?.timezone_string || settings?.gmt_offset || '',
        language: settings?.language || '',
        date_format: settings?.date_format || '',
        time_format: settings?.time_format || '',
        posts_per_page: settings?.posts_per_page || 10,
        default_comment_status: settings?.default_comment_status || ''
      };
    }


    // MEDIA
    case 'wp_get_media': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1)
      });
      if (args.media_type) params.append('media_type', args.media_type);
      
      const media = await wpReq(`/wp/v2/media?${params}`);
      return { 
        media: media.map(m => ({ 
          id: m.id, 
          title: m.title.rendered, 
          url: m.source_url,
          media_type: m.media_type,
          mime_type: m.mime_type
        })) 
      };
    }


    case 'wp_get_media_item': {
      const media = await wpReq(`/wp/v2/media/${args.id}`);
      return {
        id: media.id,
        title: media.title.rendered,
        url: media.source_url,
        media_type: media.media_type,
        mime_type: media.mime_type,
        alt_text: media.alt_text
      };
    }


    case 'wp_upload_media': {
      const buffer = Buffer.from(args.base64_content, 'base64');
      const media = await wpReq('/wp/v2/media', {
        method: 'POST',
        headers: {
          'Content-Disposition': `attachment; filename="${args.filename}"`,
          'Content-Type': 'application/octet-stream',
          'Authorization': currentAuthHeader
        },
        body: buffer
      });
      
      if (args.title !== undefined || args.alt_text !== undefined) {
        const updates = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.alt_text !== undefined) updates.alt_text = args.alt_text;
        
        await wpReq(`/wp/v2/media/${media.id}`, {
          method: 'POST',
          body: JSON.stringify(updates)
        });
      }
      
      return {
        id: media.id,
        url: media.source_url,
        slug: media.slug,
        guid: media.guid?.rendered,
        title: media.title?.rendered,
        alt_text: media.alt_text || "",
      };
    }


    case 'wp_update_media': {
      const updates = {};
      if (args.title !== undefined) updates.title = { raw: args.title };
      if (args.alt_text !== undefined) updates.alt_text = args.alt_text;
      if (args.caption !== undefined) updates.caption = { raw: args.caption };
      if (args.description !== undefined) updates.description = { raw: args.description };
      if (args.post !== undefined) updates.post = args.post;

      if (Object.keys(updates).length === 0) {
        throw new Error('No fields to update. Provide at least one valid field.');
      }

      const media = await wpReq(`/wp/v2/media/${args.id}?context=edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': currentAuthHeader
        },
        body: JSON.stringify(updates)
      });

      return { 
        id: media.id, 
        url: media.source_url,
        title: media.title?.rendered || media.title?.raw || media.title,
        alt_text: media.alt_text 
      };
    }


    case 'wp_delete_media': {
      await wpReq(`/wp/v2/media/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    // COMMENTS
    case 'wp_get_comments': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'approve'
      });
      if (args.post) params.append('post', String(args.post));
      if (args.search) params.append('search', args.search);
      
      const comments = await wpReq(`/wp/v2/comments?${params}`);
      return { 
        comments: comments.map(c => ({ 
          id: c.id, 
          post: c.post,
          author_name: c.author_name,
          content: c.content.rendered,
          date: c.date,
          status: c.status
        })) 
      };
    }


    case 'wp_get_comment': {
      const comment = await wpReq(`/wp/v2/comments/${args.id}`);
      return {
        id: comment.id,
        post: comment.post,
        author_name: comment.author_name,
        author_email: comment.author_email,
        content: comment.content.rendered,
        date: comment.date,
        status: comment.status
      };
    }


    case 'wp_create_comment': {
      const commentData = {
        post: args.post,
        content: args.content
      };
      if (args.author_name) commentData.author_name = args.author_name;
      if (args.author_email) commentData.author_email = args.author_email;
      if (args.parent) commentData.parent = args.parent;

      const comment = await wpReq('/wp/v2/comments', {
        method: 'POST',
        body: JSON.stringify(commentData)
      });
      return { id: comment.id, status: comment.status };
    }


    case 'wp_update_comment': {
      const updates = {};
      if (args.content !== undefined) updates.content = args.content;
      if (args.status !== undefined) updates.status = args.status;

      const comment = await wpReq(`/wp/v2/comments/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return { id: comment.id, status: comment.status };
    }


    case 'wp_delete_comment': {
      await wpReq(`/wp/v2/comments/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    // USERS
    case 'wp_get_users': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1)
      });
      if (args.search) params.append('search', args.search);
      if (args.roles) params.append('roles', args.roles);
      
      const users = await wpReq(`/wp/v2/users?${params}`);
      return { 
        users: users.map(u => ({ 
          id: u.id, 
          name: u.name,
          username: u.slug,
          email: u.email,
          roles: u.roles,
          link: u.link
        })) 
      };
    }


    case 'wp_get_user': {
      const user = await wpReq(`/wp/v2/users/${args.id}`);
      return {
        id: user.id,
        name: user.name,
        username: user.slug,
        email: user.email,
        roles: user.roles,
        description: user.description,
        link: user.link
      };
    }


    case 'wp_get_current_user': {
      const users = await wpReq('/wp/v2/users/me');
      return {
        id: users.id,
        name: users.name,
        username: users.slug,
        email: users.email,
        roles: users.roles
      };
    }


    // CUSTOM POST TYPES
    case 'wp_get_custom_posts': {
      const params = new URLSearchParams({
        per_page: String(args.per_page || 10),
        page: String(args.page || 1),
        status: args.status || 'publish'
      });
      
      const posts = await wpReq(`/wp/v2/${args.post_type}?${params}`);
      return { posts: posts.map(p => ({ id: p.id, title: p.title?.rendered || 'Untitled', link: p.link })) };
    }


    case 'wp_get_custom_post': {
      const { post, extras } = await readPostWithExtras(wpReq, args.post_type, args);
      return {
        id: post.id,
        title: post.title?.rendered || 'Untitled',
        content: post.content?.rendered,
        link: post.link,
        status: post.status,
        ...extras
      };
    }


    case 'wp_create_custom_post': {
      const postData = {
        title: args.title,
        content: args.content,
        status: args.status || 'draft'
      };
      
      // Meta fields (custom fields)
      if (args.meta) {
        postData.meta = args.meta;
      }
      
      // Slug/permalink
      if (args.slug) {
        postData.slug = args.slug;
      }
      
      // Excerpt
      if (args.excerpt) {
        postData.excerpt = args.excerpt;
      }
      
      // Featured image
      if (args.featured_media) {
        postData.featured_media = args.featured_media;
      }
      
      const post = await wpReq(`/wp/v2/${args.post_type}`, {
        method: 'POST',
        body: JSON.stringify(postData)
      });
      
      return { 
        id: post.id, 
        link: post.link,
        status: post.status,
        slug: post.slug,
        meta: post.meta
      };
    }


    case 'wp_update_custom_post': {
      const postData = {};
      if (args.title !== undefined) postData.title = args.title;
      if (args.content !== undefined) postData.content = args.content;
      if (args.status !== undefined) postData.status = args.status;
      if (args.excerpt !== undefined) postData.excerpt = args.excerpt;
      if (args.meta !== undefined) postData.meta = args.meta;

      const { post, acf: acfUpdate } = await writePost(wpReq, args.post_type, args.id, postData, args.acf);

      let yoastUpdate = null;
      if (args.yoast_title !== undefined || args.yoast_desc !== undefined || args.yoast_canonical !== undefined) {
        yoastUpdate = await updateYoastMeta({
          wpReq,
          id: args.id,
          postType: args.post_type,
          title: args.yoast_title,
          description: args.yoast_desc,
          canonical: args.yoast_canonical
        });
      }

      return { 
        id: post.id, 
        title: post.title?.rendered,
        link: post.link,
        status: post.status,
        slug: post.slug,
        modified: post.modified,
        meta: post.meta,
        ...(acfUpdate ? { acf_update: acfUpdate } : {}),
        yoast_update: yoastUpdate
      };
    }


    // TAXONOMY
    case 'wp_get_categories': {
      const categories = await wpReq(`/wp/v2/categories?per_page=${args.per_page || 100}`);
      return { categories: categories.map(c => ({ id: c.id, name: c.name, count: c.count })) };
    }


    case 'wp_get_tags': {
      const tags = await wpReq(`/wp/v2/tags?per_page=${args.per_page || 100}`);
      return { tags: tags.map(t => ({ id: t.id, name: t.name, count: t.count })) };
    }


    case 'wp_create_category': {
      const categoryData = { name: args.name };
      if (args.description) categoryData.description = args.description;
      if (args.parent) categoryData.parent = args.parent;
      if (args.slug) categoryData.slug = args.slug;

      const category = await wpReq('/wp/v2/categories', {
        method: 'POST',
        body: JSON.stringify(categoryData)
      });
      return { id: category.id, name: category.name, slug: category.slug };
    }


    case 'wp_create_tag': {
      const tagData = { name: args.name };
      if (args.description) tagData.description = args.description;
      if (args.slug) tagData.slug = args.slug;

      const tag = await wpReq('/wp/v2/tags', {
        method: 'POST',
        body: JSON.stringify(tagData)
      });
      return { id: tag.id, name: tag.name, slug: tag.slug };
    }


    case 'wp_update_category': {
      const updates = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.parent !== undefined) updates.parent = args.parent;

      const category = await wpReq(`/wp/v2/categories/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return { id: category.id, name: category.name };
    }


    case 'wp_delete_category': {
      await wpReq(`/wp/v2/categories/${args.id}?force=${args.force || false}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    case 'wp_update_tag': {
      const updates = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.slug !== undefined) updates.slug = args.slug;

      const tag = await wpReq(`/wp/v2/tags/${args.id}`, {
        method: 'POST',
        body: JSON.stringify(updates)
      });
      return { id: tag.id, name: tag.name, slug: tag.slug };
    }


    case 'wp_delete_tag': {
      const force = args.force !== false;
      await wpReq(`/wp/v2/tags/${args.id}?force=${force}`, {
        method: 'DELETE'
      });
      return { deleted: true, id: args.id };
    }


    case 'wp_get_special_pages': {
      const settings = await wpReq('/wp/v2/settings');
      const specialPages = {};

      if (settings.show_on_front === 'page' && settings.page_on_front) {
        try {
          const homepage = await wpReq(`/wp/v2/pages/${settings.page_on_front}`);
          specialPages.homepage = {
            id: homepage.id,
            title: homepage.title.rendered,
            slug: homepage.slug,
            url: homepage.link,
            status: homepage.status,
            type: 'page'
          };
        } catch (e) {
          specialPages.homepage = {
            id: settings.page_on_front,
            error: 'Page not found or not accessible'
          };
        }
      } else {
        specialPages.homepage = {
          type: 'posts',
          description: 'Homepage shows latest posts'
        };
      }

      if (settings.page_for_posts) {
        try {
          const blogPage = await wpReq(`/wp/v2/pages/${settings.page_for_posts}`);
          specialPages.blog_page = {
            id: blogPage.id,
            title: blogPage.title.rendered,
            slug: blogPage.slug,
            url: blogPage.link,
            status: blogPage.status,
            type: 'page'
          };
        } catch (e) {
          specialPages.blog_page = {
            id: settings.page_for_posts,
            error: 'Page not found or not accessible'
          };
        }
      }

      if (settings.wp_page_for_privacy_policy) {
        try {
          const privacyPage = await wpReq(`/wp/v2/pages/${settings.wp_page_for_privacy_policy}`);
          specialPages.privacy_policy = {
            id: privacyPage.id,
            title: privacyPage.title.rendered,
            slug: privacyPage.slug,
            url: privacyPage.link,
            status: privacyPage.status,
            type: 'page'
          };
        } catch (e) {
          specialPages.privacy_policy = {
            id: settings.wp_page_for_privacy_policy,
            error: 'Page not found or not accessible'
          };
        }
      }

      specialPages._settings = {
        show_on_front: settings.show_on_front,
        posts_per_page: settings.posts_per_page,
        default_category: settings.default_category
      };

      return specialPages;
    }


    case 'wp_get_post_types': {
      const types = await wpReq('/wp/v2/types');
      return {
        post_types: Object.entries(types).map(([key, type]) => ({
          slug: key,
          name: type.name,
          description: type.description,
          hierarchical: type.hierarchical,
          rest_base: type.rest_base
        }))
      };
    }
  }
  return NOT_HANDLED;
}
