// Maps each toolset to its handler; executeTool dispatches by toolsetOf(name).
import { handleCore } from './core.js';
import { handleContent } from './content.js';
import { handleSeo } from './seo.js';
import { handleWoo } from './woo.js';
import { handleElementor } from './elementor.js';
import { handleAdmin } from './admin.js';
export { NOT_HANDLED } from './not-handled.js';

export const TOOL_HANDLERS = {
  core: handleCore,
  content: handleContent,
  seo: handleSeo,
  woo: handleWoo,
  elementor: handleElementor,
  admin: handleAdmin
};
