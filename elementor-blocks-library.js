// elementor-blocks-library.js
// Curated Elementor block manifest + fetcher.
// Source: Codeinwp/obfx-templates (https://github.com/Codeinwp/obfx-templates)
// Templates are exported in Elementor's standard format:
//   { version, title, type, content: [...sections] }
// The `content` array is what goes into _elementor_data.

import crypto from 'crypto';

const RAW_BASE = 'https://raw.githubusercontent.com/Codeinwp/obfx-templates/master';
const SCREENSHOT_BASE = `${RAW_BASE}`;

// Static manifest. obfx-templates is archived (stable), so no need to scan GitHub each time.
export const BLOCKS_MANIFEST = [
  { id: 'obfx/about-our-business', slug: 'about-our-business-elementor', title: 'About Our Business', category: 'about', type: 'page' },
  { id: 'obfx/ascend',             slug: 'ascend-elementor',             title: 'Ascend Landing',     category: 'landing-page', type: 'page' },
  { id: 'obfx/contact-us',         slug: 'contact-us-elementor',         title: 'Contact Us',         category: 'contact', type: 'page' },
  { id: 'obfx/ether',              slug: 'ether-elementor',              title: 'Ether',              category: 'landing-page', type: 'page' },
  { id: 'obfx/jason',              slug: 'jason-elementor',              title: 'Jason',              category: 'landing-page', type: 'page' },
  { id: 'obfx/material-homepage',  slug: 'material-homepage-elementor',  title: 'Material Homepage',  category: 'homepage', type: 'page' },
  { id: 'obfx/mocha',              slug: 'mocha-elementor',              title: 'Mocha',              category: 'landing-page', type: 'page' },
  { id: 'obfx/notify',             slug: 'notify-elementor',             title: 'Coming Soon',        category: 'coming-soon', type: 'page' },
  { id: 'obfx/path',               slug: 'path-elementor',               title: 'Path',               category: 'landing-page', type: 'page' },
  { id: 'obfx/pricing',            slug: 'pricing-elementor',            title: 'Pricing Table',      category: 'pricing', type: 'page' },
  { id: 'obfx/pulse',              slug: 'pulse-elementor',              title: 'Pulse',              category: 'landing-page', type: 'page' },
  { id: 'obfx/rik',                slug: 'rik-elementor',                title: 'Rik Portfolio',      category: 'portfolio', type: 'page' },
  { id: 'obfx/zelle-lite',         slug: 'zelle-lite',                   title: 'Zelle Lite',         category: 'landing-page', type: 'page' }
];

function buildUrls(entry) {
  return {
    template_url: `${RAW_BASE}/${entry.slug}/template.json`,
    screenshot_url: `${SCREENSHOT_BASE}/${entry.slug}/screenshot.png`,
    source: `https://github.com/Codeinwp/obfx-templates/tree/master/${entry.slug}`
  };
}

// 24h in-memory cache for fetched blocks (content rarely changes — repo is archived).
const blockCache = new Map();
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchTemplate(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch block template (${response.status}): ${url}`);
  }
  return response.json();
}

export async function getBlock(blockId) {
  const entry = BLOCKS_MANIFEST.find(b => b.id === blockId);
  if (!entry) {
    throw new Error(`Unknown block id '${blockId}'. Use wp_elementor_list_blocks to discover available blocks.`);
  }

  const cached = blockCache.get(blockId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const urls = buildUrls(entry);
  const template = await fetchTemplate(urls.template_url);

  if (!Array.isArray(template.content)) {
    throw new Error(`Block '${blockId}' has unexpected format (missing content array).`);
  }

  const data = {
    id: entry.id,
    title: template.title || entry.title,
    category: entry.category,
    elementor_version: template.version || null,
    content: template.content,
    ...urls
  };

  blockCache.set(blockId, { data, expiresAt: Date.now() + BLOCK_TTL_MS });
  return data;
}

export function listBlocks({ category } = {}) {
  const list = category
    ? BLOCKS_MANIFEST.filter(b => b.category === category)
    : BLOCKS_MANIFEST;

  return list.map(entry => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    type: entry.type,
    ...buildUrls(entry)
  }));
}

// Walk an Elementor element tree and assign fresh 8-char hex ids,
// so inserting the same block twice never produces duplicate ids.
export function regenerateIds(elements) {
  return elements.map(el => {
    const fresh = { ...el, id: crypto.randomBytes(4).toString('hex') };
    if (Array.isArray(el.elements) && el.elements.length > 0) {
      fresh.elements = regenerateIds(el.elements);
    }
    return fresh;
  });
}

// Parse _elementor_data which may be a JSON string, already an array, or empty.
export function parseElementorData(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

// Insert block sections into the existing page content at the requested position.
// position: 'end' (default), 'start', or a zero-based numeric index.
export function spliceBlock(currentSections, blockSections, position = 'end') {
  const fresh = regenerateIds(blockSections);
  const next = [...currentSections];
  if (position === 'start') {
    next.unshift(...fresh);
  } else if (typeof position === 'number' && Number.isInteger(position)) {
    const idx = Math.max(0, Math.min(position, next.length));
    next.splice(idx, 0, ...fresh);
  } else {
    next.push(...fresh);
  }
  return next;
}
