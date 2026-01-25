<?php
/**
 * Strudel Schema - Render Logic
 *
 * Handles JSON-LD output in wp_head
 */

if (!defined('ABSPATH')) exit;

/**
 * Output JSON-LD schema in wp_head
 */
add_action('wp_head', function () {
    if (!is_singular()) return;

    $post_id = get_queried_object_id();
    if (!$post_id) return;

    $cfg = strudel_schema_get_config($post_id);

    // Inherit = do nothing, let other plugins handle it
    if ($cfg['mode'] === 'inherit') return;

    $graph = null;

    if ($cfg['mode'] === 'override') {
        $graph = strudel_schema_build_override_graph($post_id, $cfg);
    } elseif ($cfg['mode'] === 'extend') {
        $graph = strudel_schema_build_extend_graph($post_id, $cfg);
    }

    if (!$graph) return;

    // Output with pretty print for readability
    $json_flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT;
    echo "\n<!-- Strudel Schema v" . STRUDEL_SCHEMA_VERSION . " -->\n";
    echo '<script type="application/ld+json">' . "\n";
    echo wp_json_encode($graph, $json_flags);
    echo "\n</script>\n";
}, 20);

/**
 * Build override graph: prefer override_json if valid, else build from template
 *
 * @param int $post_id Post ID
 * @param array $cfg Configuration array
 * @return array|null Schema graph or null
 */
function strudel_schema_build_override_graph($post_id, $cfg) {
    // First check if we have a complete override JSON
    $override = strudel_schema_validate_json($cfg['override_json']);
    if ($override) {
        return strudel_schema_ensure_context($override);
    }

    // Otherwise build from template
    $built = strudel_schema_build_from_template($post_id, $cfg);
    if (!$built) return null;

    // Merge extra JSON if provided
    $extra = strudel_schema_validate_json($cfg['extra_json']);
    if ($extra) {
        $built = strudel_schema_merge_graphs($built, $extra);
    }

    return $built;
}

/**
 * Build extend graph: output template + extra JSON without disabling other plugins
 *
 * @param int $post_id Post ID
 * @param array $cfg Configuration array
 * @return array|null Schema graph or null
 */
function strudel_schema_build_extend_graph($post_id, $cfg) {
    $built = strudel_schema_build_from_template($post_id, $cfg);
    $extra = strudel_schema_validate_json($cfg['extra_json']);

    if ($built && $extra) {
        return strudel_schema_merge_graphs($built, $extra);
    }
    if ($built) return $built;
    if ($extra) return strudel_schema_ensure_context($extra);

    return null;
}

/**
 * Ensure schema has @context
 *
 * @param array $schema Schema array
 * @return array Schema with context
 */
function strudel_schema_ensure_context($schema) {
    if (!isset($schema['@context'])) {
        $schema['@context'] = 'https://schema.org';
    }
    return $schema;
}

/**
 * Build schema from template
 *
 * @param int $post_id Post ID
 * @param array $cfg Configuration array
 * @return array|null Schema graph or null
 */
function strudel_schema_build_from_template($post_id, $cfg) {
    $template = $cfg['template'];
    $data = strudel_schema_validate_json($cfg['data_json']);
    if (!$data) $data = [];

    $post = get_post($post_id);
    $url = get_permalink($post_id);
    $title = get_the_title($post_id);
    $excerpt = has_excerpt($post_id) ? get_the_excerpt($post_id) : '';
    $lang = get_bloginfo('language') ?: 'he-IL';
    $site_name = get_bloginfo('name');
    $site_url = home_url('/');

    // Get featured image
    $image_url = null;
    if (has_post_thumbnail($post_id)) {
        $image_url = get_the_post_thumbnail_url($post_id, 'full');
    }

    // Build as @graph for consistency
    $graph = [
        '@context' => 'https://schema.org',
        '@graph' => []
    ];

    switch ($template) {
        case 'about':
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => ['WebPage', 'AboutPage'],
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'description' => $excerpt ?: null,
                'inLanguage' => $lang,
                'isPartOf' => ['@id' => $site_url . '#website'],
                'mainEntity' => isset($data['organization_id']) ? ['@id' => $data['organization_id']] : null,
                'primaryImageOfPage' => $image_url ? ['@id' => $url . '#primaryimage'] : null,
            ]);
            if ($image_url) {
                $graph['@graph'][] = [
                    '@type' => 'ImageObject',
                    '@id' => $url . '#primaryimage',
                    'url' => $image_url,
                    'contentUrl' => $image_url,
                ];
            }
            break;

        case 'service':
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'WebPage',
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'description' => $excerpt ?: null,
                'inLanguage' => $lang,
                'isPartOf' => ['@id' => $site_url . '#website'],
                'mainEntity' => ['@id' => $url . '#service'],
            ]);
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'Service',
                '@id' => $url . '#service',
                'name' => $data['service_name'] ?? $title,
                'description' => $data['service_description'] ?? $excerpt ?: null,
                'provider' => isset($data['organization_id']) ? ['@id' => $data['organization_id']] : null,
                'areaServed' => $data['area_served'] ?? null,
                'serviceType' => $data['service_type'] ?? null,
                'url' => $url,
                'image' => $image_url ?: null,
            ]);
            break;

        case 'course':
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'WebPage',
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'description' => $excerpt ?: null,
                'inLanguage' => $lang,
                'isPartOf' => ['@id' => $site_url . '#website'],
                'mainEntity' => ['@id' => $url . '#course'],
            ]);
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'Course',
                '@id' => $url . '#course',
                'name' => $data['course_name'] ?? $title,
                'description' => $data['course_description'] ?? $excerpt ?: null,
                'provider' => isset($data['organization_id']) ? ['@id' => $data['organization_id']] : null,
                'courseCode' => $data['course_code'] ?? null,
                'hasCourseInstance' => isset($data['start_date']) ? [
                    '@type' => 'CourseInstance',
                    'courseMode' => $data['course_mode'] ?? 'onsite',
                    'startDate' => $data['start_date'],
                    'endDate' => $data['end_date'] ?? null,
                    'location' => $data['location'] ?? null,
                ] : null,
                'url' => $url,
                'image' => $image_url ?: null,
            ]);
            break;

        case 'blog':
            $author_id = $post->post_author;
            $author_name = get_the_author_meta('display_name', $author_id);
            $date_published = get_the_date('c', $post_id);
            $date_modified = get_the_modified_date('c', $post_id);

            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'BlogPosting',
                '@id' => $url . '#article',
                'headline' => $title,
                'description' => $excerpt ?: null,
                'url' => $url,
                'datePublished' => $date_published,
                'dateModified' => $date_modified,
                'inLanguage' => $lang,
                'mainEntityOfPage' => ['@id' => $url . '#webpage'],
                'author' => [
                    '@type' => 'Person',
                    '@id' => $site_url . '#author-' . $author_id,
                    'name' => $author_name,
                    'url' => get_author_posts_url($author_id),
                ],
                'publisher' => isset($data['organization_id']) ? ['@id' => $data['organization_id']] : [
                    '@type' => 'Organization',
                    'name' => $site_name,
                    'url' => $site_url,
                ],
                'image' => $image_url ? [
                    '@type' => 'ImageObject',
                    '@id' => $url . '#primaryimage',
                    'url' => $image_url,
                ] : null,
            ]);
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'WebPage',
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'isPartOf' => ['@id' => $site_url . '#website'],
                'primaryImageOfPage' => $image_url ? ['@id' => $url . '#primaryimage'] : null,
            ]);
            break;

        case 'faq':
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => ['WebPage', 'FAQPage'],
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'description' => $excerpt ?: null,
                'inLanguage' => $lang,
                'isPartOf' => ['@id' => $site_url . '#website'],
            ]);
            // FAQ items should be in data_json as 'faqs' array
            if (!empty($data['faqs']) && is_array($data['faqs'])) {
                $faq_items = [];
                foreach ($data['faqs'] as $faq) {
                    if (!empty($faq['question']) && !empty($faq['answer'])) {
                        $faq_items[] = [
                            '@type' => 'Question',
                            'name' => $faq['question'],
                            'acceptedAnswer' => [
                                '@type' => 'Answer',
                                'text' => $faq['answer'],
                            ],
                        ];
                    }
                }
                if (!empty($faq_items)) {
                    $graph['@graph'][0]['mainEntity'] = $faq_items;
                }
            }
            break;

        case 'local':
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'WebPage',
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'description' => $excerpt ?: null,
                'inLanguage' => $lang,
                'isPartOf' => ['@id' => $site_url . '#website'],
                'mainEntity' => ['@id' => $url . '#localbusiness'],
            ]);
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => $data['business_type'] ?? 'LocalBusiness',
                '@id' => $url . '#localbusiness',
                'name' => $data['business_name'] ?? $title,
                'description' => $data['business_description'] ?? $excerpt ?: null,
                'url' => $data['business_url'] ?? $url,
                'telephone' => $data['telephone'] ?? null,
                'email' => $data['email'] ?? null,
                'address' => !empty($data['address']) ? [
                    '@type' => 'PostalAddress',
                    'streetAddress' => $data['address']['street'] ?? null,
                    'addressLocality' => $data['address']['city'] ?? null,
                    'addressRegion' => $data['address']['region'] ?? null,
                    'postalCode' => $data['address']['postal_code'] ?? null,
                    'addressCountry' => $data['address']['country'] ?? 'IL',
                ] : null,
                'geo' => (!empty($data['latitude']) && !empty($data['longitude'])) ? [
                    '@type' => 'GeoCoordinates',
                    'latitude' => $data['latitude'],
                    'longitude' => $data['longitude'],
                ] : null,
                'openingHoursSpecification' => $data['opening_hours'] ?? null,
                'priceRange' => $data['price_range'] ?? null,
                'image' => $image_url ?: null,
            ]);
            break;

        case 'product':
            $graph['@graph'][] = strudel_schema_cleanup_nulls([
                '@type' => 'WebPage',
                '@id' => $url . '#webpage',
                'url' => $url,
                'name' => $title,
                'description' => $excerpt ?: null,
                'inLanguage' => $lang,
                'isPartOf' => ['@id' => $site_url . '#website'],
                'mainEntity' => ['@id' => $url . '#product'],
            ]);
            $product = strudel_schema_cleanup_nulls([
                '@type' => 'Product',
                '@id' => $url . '#product',
                'name' => $data['product_name'] ?? $title,
                'description' => $data['product_description'] ?? $excerpt ?: null,
                'url' => $url,
                'image' => $image_url ?: null,
                'sku' => $data['sku'] ?? null,
                'brand' => !empty($data['brand']) ? [
                    '@type' => 'Brand',
                    'name' => $data['brand'],
                ] : null,
            ]);
            // Add offers if price is provided
            if (!empty($data['price'])) {
                $product['offers'] = strudel_schema_cleanup_nulls([
                    '@type' => 'Offer',
                    'price' => $data['price'],
                    'priceCurrency' => $data['currency'] ?? 'ILS',
                    'availability' => $data['availability'] ?? 'https://schema.org/InStock',
                    'url' => $url,
                    'seller' => isset($data['organization_id']) ? ['@id' => $data['organization_id']] : null,
                ]);
            }
            // Add aggregate rating if provided
            if (!empty($data['rating_value']) && !empty($data['rating_count'])) {
                $product['aggregateRating'] = [
                    '@type' => 'AggregateRating',
                    'ratingValue' => $data['rating_value'],
                    'reviewCount' => $data['rating_count'],
                ];
            }
            $graph['@graph'][] = $product;
            break;

        case 'custom':
        default:
            // Custom template returns null - relies on override_json or extra_json
            return null;
    }

    return strudel_schema_cleanup_nulls($graph);
}

/**
 * Merge two schema graphs
 *
 * @param array $a First graph
 * @param array $b Second graph
 * @return array Merged graph
 */
function strudel_schema_merge_graphs($a, $b) {
    // Normalize A to graph format
    if (!isset($a['@graph'])) {
        if (isset($a['@context'])) {
            $context = $a['@context'];
            unset($a['@context']);
            $a = ['@context' => $context, '@graph' => [$a]];
        } else {
            $a = ['@context' => 'https://schema.org', '@graph' => [$a]];
        }
    }

    // Normalize B to graph format
    if (!isset($b['@graph'])) {
        if (isset($b['@context'])) {
            unset($b['@context']);
            $b = ['@graph' => [$b]];
        } else {
            $b = ['@graph' => [$b]];
        }
    }

    // Merge graphs
    $a['@graph'] = array_values(array_merge($a['@graph'], $b['@graph']));

    return $a;
}

/**
 * Get the rendered schema for a post (for preview/API)
 *
 * @param int $post_id Post ID
 * @return array|null Schema graph or null
 */
function strudel_schema_get_rendered($post_id) {
    $cfg = strudel_schema_get_config($post_id);

    if ($cfg['mode'] === 'inherit') {
        return null;
    }

    if ($cfg['mode'] === 'override') {
        return strudel_schema_build_override_graph($post_id, $cfg);
    }

    if ($cfg['mode'] === 'extend') {
        return strudel_schema_build_extend_graph($post_id, $cfg);
    }

    return null;
}
