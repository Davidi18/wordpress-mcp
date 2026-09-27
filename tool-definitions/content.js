// MCP tool definitions — "content" toolset (see toolsets.js). Handlers live in executeTool.
export default [
  // POSTS (5 endpoints)
  {
    name: 'wp_get_posts',
    description: 'Get WordPress posts with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of posts to retrieve (max 100)', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        status: { type: 'string', description: 'Post status (publish, draft, etc)', default: 'publish' },
        author: { type: 'number', description: 'Author ID' },
        categories: { type: 'string', description: 'Category IDs (comma-separated)' }
      }
    }
  },
  {
    name: 'wp_get_post',
    description: 'Get a specific WordPress post by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post ID' },
        include: { type: 'array', items: { type: 'string', enum: ['acf', 'meta', 'taxonomies'] }, description: 'Extra data to return: acf (ACF field values, same format `acf` writes accept), meta (registered post meta), taxonomies (category/tag IDs). Read ACF before overwriting it.' },
        acf_format: { type: 'string', enum: ['light', 'standard'], description: 'ACF value format when include has acf. light (default) = raw stored values; standard = formatted like the theme renders them.' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_post',
    description: 'Create a new WordPress post',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        status: { type: 'string', description: 'Post status (publish, draft, pending)', default: 'draft' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        categories: { type: 'array', items: { type: 'number' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'wp_update_post',
    description: 'Update an existing WordPress post. Supports ACF fields via `acf` (verified write).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post ID' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        status: { type: 'string', description: 'Post status' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        meta: { type: 'object', description: 'Registered post meta (key-value). Not for ACF fields — use `acf`.' },
        acf: { type: 'object', description: 'ACF fields to write via the REST `acf` key: { field_name: value }. Partial — only the fields sent change. "" or null clears a field. Values are read back and verified; the call fails if a field is not REST-exposed or was not stored. Do NOT use `meta` for ACF fields.' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_post',
    description: 'Delete a WordPress post',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post ID' },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },
  // PAGES (5 endpoints)
  {
    name: 'wp_get_pages',
    description: 'Get WordPress pages',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of pages to retrieve', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        status: { type: 'string', description: 'Page status', default: 'publish' }
      }
    }
  },
  {
    name: 'wp_get_page',
    description: 'Get a specific WordPress page by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        include: { type: 'array', items: { type: 'string', enum: ['acf', 'meta', 'taxonomies'] }, description: 'Extra data to return: acf (ACF field values, same format `acf` writes accept), meta (registered post meta), taxonomies (category/tag IDs). Read ACF before overwriting it.' },
        acf_format: { type: 'string', enum: ['light', 'standard'], description: 'ACF value format when include has acf. light (default) = raw stored values; standard = formatted like the theme renders them.' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_page',
    description: 'Create a new WordPress page',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content (HTML)' },
        status: { type: 'string', description: 'Page status (publish, draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Page excerpt' },
        parent: { type: 'number', description: 'Parent page ID' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'wp_update_page',
    description: 'Update an existing WordPress page. Supports ACF fields via `acf` (verified write).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content (HTML)' },
        status: { type: 'string', description: 'Page status' },
        excerpt: { type: 'string', description: 'Page excerpt. Pass an empty string "" to clear the existing excerpt.' },
        meta: { type: 'object', description: 'Registered post meta (key-value). Not for ACF fields — use `acf`.' },
        acf: { type: 'object', description: 'ACF fields to write via the REST `acf` key: { field_name: value }. Partial — only the fields sent change. "" or null clears a field. Values are read back and verified; the call fails if a field is not REST-exposed or was not stored. Do NOT use `meta` for ACF fields.' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_page',
    description: 'Delete a WordPress page',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },
  // MEDIA (5 endpoints)
  {
    name: 'wp_get_media',
    description: 'Get WordPress media files',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of media items', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        media_type: { type: 'string', description: 'Media type (image, video, etc)' }
      }
    }
  },
  {
    name: 'wp_get_media_item',
    description: 'Get a specific media item by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Media ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_upload_media',
    description: 'Upload media file (base64 encoded)',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name' },
        base64_content: { type: 'string', description: 'Base64 encoded file content' },
        title: { type: 'string', description: 'Media title' },
        alt_text: { type: 'string', description: 'Alt text for images' }
      },
      required: ['filename', 'base64_content']
    }
  },
  {
    name: 'wp_update_media',
    description: 'Update media item metadata (title, alt text, caption, description)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Media ID' },
        title: { type: 'string', description: 'Media title' },
        alt_text: { type: 'string', description: 'Alternative text for images' },
        caption: { type: 'string', description: 'Media caption' },
        description: { type: 'string', description: 'Media description' },
        post: { type: 'number', description: 'Post ID to attach media to' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_media',
    description: 'Delete a media item',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Media ID' },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },
  // COMMENTS (5 endpoints)
  {
    name: 'wp_get_comments',
    description: 'Get WordPress comments',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of comments', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        post: { type: 'number', description: 'Limit to specific post ID' },
        status: { type: 'string', description: 'Comment status (approve, hold, spam)', default: 'approve' },
        search: { type: 'string', description: 'Search term' }
      }
    }
  },
  {
    name: 'wp_get_comment',
    description: 'Get a specific comment by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Comment ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_create_comment',
    description: 'Create a new comment on a post',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'number', description: 'Post ID' },
        content: { type: 'string', description: 'Comment content' },
        author_name: { type: 'string', description: 'Comment author name' },
        author_email: { type: 'string', description: 'Comment author email' },
        parent: { type: 'number', description: 'Parent comment ID for replies' }
      },
      required: ['post', 'content']
    }
  },
  {
    name: 'wp_update_comment',
    description: 'Update an existing comment',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Comment ID' },
        content: { type: 'string', description: 'Comment content' },
        status: { type: 'string', description: 'Comment status (approve, hold, spam, trash)' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_comment',
    description: 'Delete a comment',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Comment ID' },
        force: { type: 'boolean', description: 'Bypass trash and force deletion', default: false }
      },
      required: ['id']
    }
  },
  // USERS (3 endpoints)
  {
    name: 'wp_get_users',
    description: 'Get WordPress users',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of users', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search term' },
        roles: { type: 'string', description: 'Filter by role (admin, editor, author, etc)' }
      }
    }
  },
  {
    name: 'wp_get_user',
    description: 'Get a specific user by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'User ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_get_current_user',
    description: 'Get information about the currently authenticated user',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  // CUSTOM POST TYPES (3 endpoints)
  {
    name: 'wp_get_custom_posts',
    description: 'Get posts from a custom post type',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: { type: 'string', description: 'Custom post type slug' },
        per_page: { type: 'number', description: 'Number of posts', default: 10 },
        page: { type: 'number', description: 'Page number', default: 1 },
        status: { type: 'string', description: 'Post status', default: 'publish' }
      },
      required: ['post_type']
    }
  },
  {
    name: 'wp_get_custom_post',
    description: 'Get a specific custom post by ID',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: { type: 'string', description: 'Custom post type slug' },
        id: { type: 'number', description: 'Post ID' },
        include: { type: 'array', items: { type: 'string', enum: ['acf', 'meta', 'taxonomies'] }, description: 'Extra data to return: acf (ACF field values, same format `acf` writes accept), meta (registered post meta), taxonomies (category/tag IDs). Read ACF before overwriting it.' },
        acf_format: { type: 'string', enum: ['light', 'standard'], description: 'ACF value format when include has acf. light (default) = raw stored values; standard = formatted like the theme renders them.' }
      },
      required: ['post_type', 'id']
    }
  },
  {
    name: 'wp_create_custom_post',
    description: 'Create a new custom post',
    inputSchema: {
      type: 'object',
      properties: {
        post_type: { type: 'string', description: 'Custom post type slug' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content' },
        status: { type: 'string', description: 'Post status', default: 'draft' },
        slug: { type: 'string', description: 'Post slug/permalink' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        featured_media: { type: 'number', description: 'Featured image ID' },
        meta: { type: 'object', description: 'Custom meta fields (key-value pairs)' }
      },
      required: ['post_type', 'title', 'content']
    }
  },
  {
    name: 'wp_update_custom_post',
    description: 'Update an existing custom post type entry (product, experience, etc). Supports ACF fields via `acf` and Yoast SEO via yoast_title/yoast_desc/yoast_canonical.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'WordPress site URL' },
        post_type: { type: 'string', description: 'Custom post type slug (e.g. product, experiences)' },
        id: { type: 'number', description: 'Post ID to update' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post content (HTML)' },
        status: { type: 'string', description: 'Post status' },
        excerpt: { type: 'string', description: 'Post excerpt' },
        meta: { type: 'object', description: 'Raw meta fields (key-value). Not for ACF fields — use `acf`.' },
        acf: { type: 'object', description: 'ACF fields to write via the REST `acf` key: { field_name: value }. Partial — only the fields sent change. "" or null clears a field. Values are read back and verified; the call fails if a field is not REST-exposed or was not stored. Do NOT use `meta` for ACF fields.' },
        yoast_title: { type: 'string', description: 'Yoast SEO title (yoast_wpseo_title)' },
        yoast_desc: { type: 'string', description: 'Yoast SEO meta description (yoast_wpseo_metadesc)' },
        yoast_canonical: { type: 'string', description: 'Yoast canonical URL (yoast_wpseo_canonical)' }
      },
      required: ['post_type', 'id']
    }
  },
  // TAXONOMY (6 endpoints)
  {
    name: 'wp_get_categories',
    description: 'Get WordPress categories',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of categories', default: 100 }
      }
    }
  },
  {
    name: 'wp_get_tags',
    description: 'Get WordPress tags',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Number of tags', default: 100 }
      }
    }
  },
  {
    name: 'wp_create_category',
    description: 'Create a new category',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string', description: 'Category description' },
        parent: { type: 'number', description: 'Parent category ID' },
        slug: { type: 'string', description: 'Category slug' }
      },
      required: ['name']
    }
  },
  {
    name: 'wp_create_tag',
    description: 'Create a new tag',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name' },
        description: { type: 'string', description: 'Tag description' },
        slug: { type: 'string', description: 'Tag slug' }
      },
      required: ['name']
    }
  },
  {
    name: 'wp_update_category',
    description: 'Update an existing category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID' },
        name: { type: 'string', description: 'Category name' },
        description: { type: 'string', description: 'Category description' },
        parent: { type: 'number', description: 'Parent category ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_category',
    description: 'Delete a category',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Category ID' },
        force: { type: 'boolean', description: 'Force deletion', default: false }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_update_tag',
    description: 'Update an existing tag',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Tag ID' },
        name: { type: 'string', description: 'Tag name' },
        description: { type: 'string', description: 'Tag description' },
        slug: { type: 'string', description: 'Tag slug' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_delete_tag',
    description: 'Delete a tag (tags are non-hierarchical so deletion is immediate; the force flag is accepted for symmetry with wp_delete_category but WP requires force=true).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Tag ID' },
        force: { type: 'boolean', description: 'Required by WP REST for tag deletion', default: true }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_get_special_pages',
    description: 'Get special WordPress page IDs (homepage, blog page, privacy policy, etc.) with full page details',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wp_get_post_types',
    description: 'Get all available post types',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'wp_set_static_front_page',
    description: 'Set the WordPress homepage to a specific page (Reading Settings → "A static page"). Returns `previous_state` for rollback. Optionally also sets the "Posts page" (blog listing). Pass page_id:0 to revert to "Your latest posts".',
    inputSchema: {
      type: 'object',
      properties: {
        page_id: { type: 'number', description: 'Page id to use as homepage. Pass 0 to revert to latest-posts mode.' },
        posts_page_id: { type: 'number', description: 'Optional. Page id for the blog/posts listing.' }
      },
      required: ['page_id']
    }
  },
  // ── MENUS ──
  {
    name: 'wp_get_menus',
    description: 'List all navigation menus on the site',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wp_get_menu_items',
    description: 'Get all items in a specific menu (links, pages, categories, custom items)',
    inputSchema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'Menu ID (from wp_get_menus)' }
      },
      required: ['menu_id']
    }
  },
  // ── SEARCH ──
  {
    name: 'wp_search',
    description: 'Unified search across all content types (posts, pages, media, categories, tags)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search query' },
        type: { type: 'string', description: 'Filter by type: post, page, category, post_tag' },
        per_page: { type: 'number', description: 'Results per page', default: 20 }
      },
      required: ['search']
    }
  },
  // ── BULK OPERATIONS ──
  {
    name: 'wp_bulk_update_posts',
    description: 'Apply the same updates to one or more posts/pages/CPT entries (status, categories, tags, author, meta, ACF fields). Per-post results; one failure does not hide the others. ACF writes (updates.acf) are verified by reading back the stored values.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'number' }, description: 'Array of post IDs to update (alias: post_ids)' },
        post_ids: { type: 'array', items: { type: 'number' }, description: 'Alias of ids' },
        updates: {
          type: 'object',
          description: 'Fields to update on all items: status, categories, tags, author, meta, acf, etc.',
          properties: {
            status: { type: 'string', description: 'draft, publish, pending, private, trash' },
            categories: { type: 'array', items: { type: 'number' }, description: 'Category IDs' },
            tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' },
            author: { type: 'number', description: 'Author user ID' },
            meta: { type: 'object', description: 'Registered post meta. Not for ACF fields — use acf.' },
            acf: { type: 'object', description: 'ACF fields to write via the REST `acf` key: { field_name: value }. Partial — only the fields sent change. "" or null clears a field. Values are read back and verified; the call fails if a field is not REST-exposed or was not stored. Do NOT use `meta` for ACF fields.' }
          }
        },
        post_type: { type: 'string', description: 'posts, pages, or a custom post type slug / REST base', default: 'posts' }
      },
      required: ['updates']
    }
  },
  // ── PAGE TREE ──
  {
    name: 'wp_get_page_tree',
    description: 'Get hierarchical page structure (parent/child relationships) — useful for understanding site architecture',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Max pages to fetch', default: 100 }
      }
    }
  },
  // ── SETTINGS ──
  {
    name: 'wp_get_settings',
    description: 'Get WordPress site settings (title, tagline, timezone, language, date/time format, URL)',
    inputSchema: { type: 'object', properties: {} }
  }
];
