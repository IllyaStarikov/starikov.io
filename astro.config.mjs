import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { countsEmitter } from './scripts/lib/counts-integration.mjs';

export default defineConfig({
  site: 'https://starikov.io',
  // countsEmitter (Task 15): writes src/data/generated/counts.json from the
  // per-collection counts each loader records via report.count() -- the
  // dist-independent manifest scripts/validate-dist.mjs gates the build on.
  integrations: [mdx(), sitemap(), countsEmitter()],
  markdown: { shikiConfig: { theme: 'css-variables' } },
});
