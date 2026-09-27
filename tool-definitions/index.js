// Tool catalog served by tools/list, assembled per toolset.
import core from './core.js';
import content from './content.js';
import seo from './seo.js';
import woo from './woo.js';
import elementor from './elementor.js';
import admin from './admin.js';

export const tools = [...core, ...content, ...seo, ...woo, ...elementor, ...admin];
