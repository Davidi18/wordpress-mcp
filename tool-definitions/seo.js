// MCP tool definitions — "seo" toolset (see toolsets.js). Handlers live in executeTool.
export default [
  // ── RANKMATH SEO ──
  {
    name: 'wp_rankmath_update_meta',
    description: 'Update RankMath SEO meta (title, description, focus keyword) for a post/page. Works on sites with RankMath plugin (caio, kedma, shukeat).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page ID' },
        post_type: { type: 'string', description: 'post or page', default: 'post' },
        title: { type: 'string', description: 'SEO title' },
        description: { type: 'string', description: 'Meta description' },
        focus_keyword: { type: 'string', description: 'Focus keyword' },
        robots: { type: 'array', items: { type: 'string' }, description: 'Robots directives: index, noindex, follow, nofollow' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_rankmath_get_meta',
    description: 'Get RankMath SEO meta (title, description, focus keyword, robots, score) for a post/page',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page ID' },
        post_type: { type: 'string', description: 'post or page', default: 'post' }
      },
      required: ['id']
    }
  },
  // ── YOAST SEO ──
  {
    name: 'wp_yoast_get_head',
    description: 'Get Yoast SEO head data (title, description, og tags, schema, robots) for any URL. Works on sites with Yoast (smartup, xod).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to get SEO head for' }
      },
      required: ['url']
    }
  },
  {
    name: 'wp_bootstrap_yoast_term_writer',
    description: 'Install or refresh the authenticated agency-os/v1/yoast-term-meta route as an active Code Snippet. Required once per site before Yoast taxonomy-term writes.',
    inputSchema: { type: 'object', properties: { force: { type: 'boolean', default: false } } }
  },
  {
    name: 'wp_yoast_update_meta',
    description: 'Update Yoast SEO metadata for posts/pages/public CPTs and public taxonomy terms (for example post_type=category, rest_base=categories).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page/custom-post/term ID' },
        post_type: { type: 'string', description: 'WordPress content type or taxonomy, e.g. post, page, service, category', default: 'post' },
        rest_base: { type: 'string', description: 'Optional explicit WordPress REST base when it differs from post_type; otherwise auto-discovered from /wp/v2/types' },
        object_type: { type: 'string', enum: ['post', 'term'], description: 'Use term for custom taxonomies; category and post_tag are auto-detected' },
        verify: { type: 'boolean', description: 'Read back and compare supplied fields after writing', default: true },
        title: { type: 'string', description: 'SEO title' },
        description: { type: 'string', description: 'Meta description' },
        focus_keyword: { type: 'string', description: 'Focus keyphrase' },
        robots_noindex: { type: 'boolean', description: 'Set noindex (true = noindex)' },
        robots_nofollow: { type: 'boolean', description: 'Set nofollow (true = nofollow)' },
        canonical: { type: 'string', description: 'Canonical URL override' },
        og_title: { type: 'string', description: 'Open Graph title' },
        og_description: { type: 'string', description: 'Open Graph description' }
      },
      required: ['id']
    }
  },
  {
    name: 'wp_yoast_get_meta',
    description: 'Get stored Yoast metadata for a post, page, public custom post type, or public taxonomy term by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Post/page/custom-post/term ID' },
        post_type: { type: 'string', description: 'WordPress content type or taxonomy, e.g. post, page, service, category', default: 'post' },
        rest_base: { type: 'string', description: 'Optional explicit WordPress REST base when it differs from post_type; otherwise auto-discovered from /wp/v2/types' },
        object_type: { type: 'string', enum: ['post', 'term'], description: 'Use term for custom taxonomies; category and post_tag are auto-detected' }
      },
      required: ['id']
    }
  },
  // ── REDIRECTS ──
  {
    name: 'wp_get_redirects',
    description: 'List redirects managed by Redirection or RankMath plugin. Returns source URL, target URL, type (301/302), and hit count.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'number', description: 'Results per page', default: 50 },
        page: { type: 'number', description: 'Page number', default: 1 },
        search: { type: 'string', description: 'Search redirects by URL' }
      }
    }
  },
  {
    name: 'wp_create_redirect',
    description: 'Create a new redirect rule (301/302). Uses RankMath or Redirection plugin API.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source URL path (e.g. /old-page)' },
        target: { type: 'string', description: 'Target URL (e.g. /new-page or full URL)' },
        type: { type: 'number', description: 'Redirect type: 301 (permanent) or 302 (temporary)', default: 301 }
      },
      required: ['source', 'target']
    }
  }
];
