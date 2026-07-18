import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://starikov.io',
  integrations: [mdx(), sitemap()],
  markdown: { shikiConfig: { theme: 'css-variables' } },
});
