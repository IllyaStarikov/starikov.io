/*
 * page-items.ts -- static pages that are first-class SiteItems (⌘K "Jump to" /
 * Connections / home feed / RSS) but aren't collection-backed (design spec §3;
 * v1.1 polish Task 5, obligation A3: every top-level route reachable from the
 * palette, not just /academia).
 *
 * Astro-free by construction -- a plain array, only an `import type` of
 * `SiteItem` (erased at compile time, so `astro:content` is never touched) --
 * so test/page-items.test.ts asserts its shape and every downstream ripple
 * with plain objects. Same "testable pure core" split as recent.ts, feed.ts
 * and palette-index.ts. Re-exported from model.ts for one public home.
 *
 * Deliberately undated: every entry here is a standing page, not a dated post,
 * so it sorts after every dated SiteItem in getAllItems() and is excluded, BY
 * CONSTRUCTION (not convention), from every surface that reads `item.date` --
 * selectRecentItems (home RECENTLY UPDATED), changelog.astro's
 * `.filter((i) => i.date)`, and effectively from /rss.xml's top-50 slice
 * (undated items sort last; the site has 94+ dated essays alone, so a static
 * page never displaces one). The one surface that reads PAGE_ITEMS
 * unfiltered is the palette index (src/lib/palette-index.ts) -- the intended
 * consumer, since ⌘K "Jump to" is exactly where a static page belongs.
 *
 * Taglines are compressed, truthful one-liners pulled from each page's own
 * lead copy / meta description (never invented), kept at or under
 * palette-index.ts's MAX_TAGLINE (72 chars) so the palette never has to
 * ellipsis them.
 */
import type { SiteItem } from './model';

export const PAGE_ITEMS: SiteItem[] = [
  {
    type: 'page',
    slug: 'home',
    title: 'Home',
    tagline: 'Ten years of dotfiles, tools, and essays — documented like it matters.',
    href: '/',
  },
  {
    type: 'page',
    slug: 'about',
    title: 'About',
    tagline: 'Bio, live profile card, résumé and CV PDFs, and where to reach me.',
    href: '/about',
  },
  {
    type: 'page',
    slug: 'colophon',
    title: 'Colophon',
    tagline: 'How this site is built: the theme engine, the tokens, the type specimen.',
    href: '/colophon',
  },
  {
    type: 'page',
    slug: 'changelog',
    title: 'Changelog',
    tagline: 'A human-readable feed of updates across the site, newest first.',
    href: '/changelog',
  },
  {
    type: 'page',
    slug: 'writing',
    title: 'Writing',
    tagline: 'Essays on software and systems, year-grouped — read at starikov.co.',
    href: '/writing',
  },
  {
    type: 'page',
    slug: 'bin',
    title: 'Bin',
    tagline: 'Standalone command-line tools, each with its own generated man-page.',
    href: '/bin',
  },
  {
    type: 'page',
    slug: 'projects',
    title: 'Projects',
    tagline: 'Flagship projects, each a curated page over live repo metadata.',
    href: '/projects',
  },
  {
    type: 'page',
    slug: 'academia',
    title: 'Academia',
    tagline: 'Four bound LaTeX volumes and a media showcase from the Missouri S&T years.',
    href: '/academia',
  },
];
