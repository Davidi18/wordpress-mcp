// Curated WordPress postmeta keys we care about when snapshotting / copying
// the publishable state of a page.
//
// These must be registered with show_in_rest=true on the target site for the
// REST API to return them; if a key isn't exposed, it'll simply be skipped
// (read returns undefined → not stored / not copied).

export const ELEMENTOR_META_KEYS = [
  '_elementor_data',
  '_elementor_edit_mode',
  '_elementor_template_type',
  '_elementor_version',
  '_elementor_pro_version',
  '_elementor_page_settings',
  '_elementor_controls_usage'
];

export const SEO_META_KEYS = [
  // Yoast
  '_yoast_wpseo_title',
  '_yoast_wpseo_metadesc',
  '_yoast_wpseo_focuskw',
  '_yoast_wpseo_meta-robots-noindex',
  '_yoast_wpseo_meta-robots-nofollow',
  '_yoast_wpseo_meta-robots-adv',
  '_yoast_wpseo_canonical',
  '_yoast_wpseo_opengraph-title',
  '_yoast_wpseo_opengraph-description',
  '_yoast_wpseo_opengraph-image',
  '_yoast_wpseo_opengraph-image-id',
  '_yoast_wpseo_twitter-title',
  '_yoast_wpseo_twitter-description',
  '_yoast_wpseo_twitter-image',
  '_yoast_wpseo_twitter-image-id',
  // RankMath
  'rank_math_title',
  'rank_math_description',
  'rank_math_focus_keyword',
  'rank_math_robots',
  'rank_math_canonical_url',
  'rank_math_facebook_title',
  'rank_math_facebook_description',
  'rank_math_facebook_image',
  'rank_math_twitter_title',
  'rank_math_twitter_description',
  'rank_math_twitter_image'
];

// Page object top-level fields that are NOT taxonomies. Used to auto-detect
// taxonomies in a draft post (anything else that's an int[] is treated as
// a taxonomy term-id list).
export const POST_NON_TAX_FIELDS = new Set([
  'id', 'date', 'date_gmt', 'guid', 'modified', 'modified_gmt', 'password',
  'slug', 'status', 'type', 'link', 'title', 'content', 'excerpt', 'author',
  'featured_media', 'comment_status', 'ping_status', 'sticky', 'template',
  'format', 'meta', 'parent', 'menu_order', '_links', '_embedded',
  'generated_slug', 'permalink_template', 'class_list'
]);
