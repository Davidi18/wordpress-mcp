// elementor-blocks-library.js
// Curated Elementor block manifest + fetcher.
//
// Two sources are supported:
//   - source: 'obfx'   — full landing-page templates pulled from
//                        Codeinwp/obfx-templates on GitHub (archived, stable)
//   - source: 'local'  — hand-curated atomic sections shipped in this repo's
//                        blocks/ directory (hero, features, testimonial, CTA, etc.)
//
// Templates follow Elementor's standard export format:
//   { version, title, type, content: [...sections] }
// The `content` array is what goes into _elementor_data.
//
// Local section JSON files use placeholder text in {{PLACEHOLDER_NAME}} form
// so the agent can locate them with wp_replace_text after insertion.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_BLOCKS_DIR = path.join(__dirname, 'blocks');

const RAW_BASE = 'https://raw.githubusercontent.com/Codeinwp/obfx-templates/master';
const SCREENSHOT_BASE = `${RAW_BASE}`;

// Static manifest. obfx is archived (stable); local entries ship with the repo.
export const BLOCKS_MANIFEST = [
  // ── Local atomic sections (use these to compose a page section-by-section) ──
  { id: 'local/hero-centered',     file: 'hero-centered.json',     title: 'Hero — Centered',       category: 'hero',        type: 'section', source: 'local' },
  { id: 'local/hero-split',        file: 'hero-split.json',        title: 'Hero — Split (text + image)', category: 'hero',  type: 'section', source: 'local' },
  { id: 'local/features-3col',     file: 'features-3col.json',     title: 'Features — 3 columns',  category: 'features',    type: 'section', source: 'local' },
  { id: 'local/testimonials-3col', file: 'testimonials-3col.json', title: 'Testimonials — 3 columns', category: 'testimonials', type: 'section', source: 'local' },
  { id: 'local/cta-simple',        file: 'cta-simple.json',        title: 'CTA — Centered banner', category: 'cta',         type: 'section', source: 'local' },
  { id: 'local/faq-accordion',     file: 'faq-accordion.json',     title: 'FAQ — Accordion',       category: 'faq',         type: 'section', source: 'local' },
  { id: 'local/pricing-3col',      file: 'pricing-3col.json',      title: 'Pricing — 3 tiers',     category: 'pricing',     type: 'section', source: 'local' },
  { id: 'local/team-grid-3col',    file: 'team-grid-3col.json',    title: 'Team — 3 members',      category: 'team',        type: 'section', source: 'local' },

  // ── Full-page templates from obfx (archived, fetched from GitHub at runtime) ──
  { id: 'obfx/about-our-business', slug: 'about-our-business-elementor', title: 'About Our Business', category: 'about',        type: 'page', source: 'obfx' },
  { id: 'obfx/ascend',             slug: 'ascend-elementor',             title: 'Ascend Landing',     category: 'landing-page', type: 'page', source: 'obfx' },
  { id: 'obfx/contact-us',         slug: 'contact-us-elementor',         title: 'Contact Us',         category: 'contact',      type: 'page', source: 'obfx' },
  { id: 'obfx/ether',              slug: 'ether-elementor',              title: 'Ether',              category: 'landing-page', type: 'page', source: 'obfx' },
  { id: 'obfx/jason',              slug: 'jason-elementor',              title: 'Jason',              category: 'landing-page', type: 'page', source: 'obfx' },
  { id: 'obfx/material-homepage',  slug: 'material-homepage-elementor',  title: 'Material Homepage',  category: 'homepage',     type: 'page', source: 'obfx' },
  { id: 'obfx/mocha',              slug: 'mocha-elementor',              title: 'Mocha',              category: 'landing-page', type: 'page', source: 'obfx' },
  { id: 'obfx/notify',             slug: 'notify-elementor',             title: 'Coming Soon',        category: 'coming-soon',  type: 'page', source: 'obfx' },
  { id: 'obfx/path',               slug: 'path-elementor',               title: 'Path',               category: 'landing-page', type: 'page', source: 'obfx' },
  { id: 'obfx/pricing',            slug: 'pricing-elementor',            title: 'Pricing Table',      category: 'pricing',      type: 'page', source: 'obfx' },
  { id: 'obfx/pulse',              slug: 'pulse-elementor',              title: 'Pulse',              category: 'landing-page', type: 'page', source: 'obfx' },
  { id: 'obfx/rik',                slug: 'rik-elementor',                title: 'Rik Portfolio',      category: 'portfolio',    type: 'page', source: 'obfx' },
  { id: 'obfx/zelle-lite',         slug: 'zelle-lite',                   title: 'Zelle Lite',         category: 'landing-page', type: 'page', source: 'obfx' }
];

function obfxUrls(entry) {
  return {
    template_url: `${RAW_BASE}/${entry.slug}/template.json`,
    screenshot_url: `${SCREENSHOT_BASE}/${entry.slug}/screenshot.png`,
    source_url: `https://github.com/Codeinwp/obfx-templates/tree/master/${entry.slug}`
  };
}

function localUrls(entry) {
  return {
    template_url: `local:blocks/${entry.file}`,
    source_url: null
  };
}

function buildUrls(entry) {
  return entry.source === 'local' ? localUrls(entry) : obfxUrls(entry);
}

// 24h in-memory cache for fetched blocks (content rarely changes — local files
// are read once per process, obfx repo is archived).
const blockCache = new Map();
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchObfxTemplate(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch block template (${response.status}): ${url}`);
  }
  return response.json();
}

async function readLocalTemplate(file) {
  const fullPath = path.join(LOCAL_BLOCKS_DIR, file);
  const raw = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(raw);
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
  const template = entry.source === 'local'
    ? await readLocalTemplate(entry.file)
    : await fetchObfxTemplate(urls.template_url);

  if (!Array.isArray(template.content)) {
    throw new Error(`Block '${blockId}' has unexpected format (missing content array).`);
  }

  // Collect placeholders for local section blocks so the agent knows what to
  // replace via wp_replace_text after insertion.
  const placeholders = entry.source === 'local'
    ? collectPlaceholders(template.content)
    : [];

  const data = {
    id: entry.id,
    title: template.title || entry.title,
    category: entry.category,
    type: entry.type,
    source: entry.source,
    elementor_version: template.version || null,
    content: template.content,
    placeholders,
    ...urls
  };

  blockCache.set(blockId, { data, expiresAt: Date.now() + BLOCK_TTL_MS });
  return data;
}

export function listBlocks({ category, source } = {}) {
  let list = BLOCKS_MANIFEST;
  if (category) list = list.filter(b => b.category === category);
  if (source) list = list.filter(b => b.source === source);

  return list.map(entry => ({
    id: entry.id,
    title: entry.title,
    category: entry.category,
    type: entry.type,
    source: entry.source,
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

// Walk the element tree and collect every {{PLACEHOLDER}} token found in
// string-valued settings (including nested objects like link.url, image.url).
// Returns a deduplicated, sorted list.
function collectPlaceholders(elements) {
  const found = new Set();
  const RE = /\{\{[A-Z0-9_]+\}\}/g;
  const scanValue = (v) => {
    if (typeof v === 'string') {
      const m = v.match(RE);
      if (m) for (const t of m) found.add(t);
    } else if (Array.isArray(v)) {
      for (const item of v) scanValue(item);
    } else if (v && typeof v === 'object') {
      for (const inner of Object.values(v)) scanValue(inner);
    }
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.settings && typeof node.settings === 'object') {
      for (const v of Object.values(node.settings)) scanValue(v);
    }
    if (Array.isArray(node.elements)) {
      for (const child of node.elements) walk(child);
    }
  };
  for (const el of elements) walk(el);
  return [...found].sort();
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
