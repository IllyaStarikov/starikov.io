import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';
import { countsEmitter } from './scripts/lib/counts-integration.mjs';

export default defineConfig({
  site: 'https://starikov.io',
  // countsEmitter (Task 15): writes src/data/generated/counts.json from the
  // per-collection counts each loader records via report.count() -- the
  // dist-independent manifest scripts/validate-dist.mjs gates the build on.
  //
  // pagefind (Task 16): indexes dist/ into dist/pagefind/ on an astro:build:done
  // hook, so it runs after `astro build` finishes writing HTML but still inside
  // this one `astro build` invocation -- no separate `npx pagefind --site dist`
  // step needed in package.json's build chain. It reads the data-pagefind-body/
  // -filter/-meta/-ignore attributes Shell.astro and friends emit; no
  // indexConfig override needed since the default root scope (whole document,
  // narrowed by data-pagefind-body once any page opts in) is exactly what we
  // want. validate-dist.mjs's pagefindEnabled() greps this file for the string
  // "pagefind" to flip its dist/pagefind/ check from skipped to enforced.
  integrations: [mdx(), sitemap(), pagefind(), countsEmitter()],
  markdown: { shikiConfig: { theme: 'css-variables' } },
});
