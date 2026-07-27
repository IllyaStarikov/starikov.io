/*
 * feed.ts -- the pure core of the site RSS feed (/rss.xml) and, by extension,
 * the human-readable /changelog (design spec §7: "site RSS -- the changelog
 * feed /changelog renders"). Both surfaces read the same `SiteItem` model
 * (src/lib/model.ts), so the feed and the page can never drift.
 *
 * Kept Astro-free and injected (`items`, `origin`) so it unit-tests with plain
 * objects -- the established "testable pure core" pattern. rss.xml.ts is the
 * thin Astro shell that calls getAllItems() + rss() around it.
 */

import type { SiteItem } from './model';

/** The subset of @astrojs/rss's RSSFeedItem this feed produces. */
export interface FeedItem {
  title: string;
  /** Absolute URL. Essays already carry their canonical starikov.co URL; every
   *  other item is a site-local path resolved against `origin`. */
  link: string;
  description: string;
  /** Only present when the item is dated (pages like /academia are undated). */
  pubDate?: Date;
  /** SiteItemType, exposed as an RSS category so a reader can filter. */
  categories: string[];
}

/** Newest-first, undated last -- the order the feed and changelog both present. */
function byDateDesc(a: SiteItem, b: SiteItem): number {
  return (b.date ?? '').localeCompare(a.date ?? '');
}

/**
 * Turn the uniform SiteItem list into RSS feed items, newest first, capped at
 * `limit` (default 50). An essay's href is already an absolute starikov.co URL
 * and is used verbatim; every other item's href is a site path joined onto
 * `origin`. Items with an unparseable date get no `pubDate` rather than an
 * `Invalid Date`.
 */
export function buildFeedItems(items: SiteItem[], origin: string, limit = 50): FeedItem[] {
  const base = origin.replace(/\/$/, '');
  return [...items]
    .sort(byDateDesc)
    .slice(0, limit)
    .map((item) => {
      const link = /^https?:\/\//i.test(item.href) ? item.href : `${base}${item.href}`;
      const feedItem: FeedItem = {
        title: item.title,
        link,
        description: item.tagline,
        categories: [item.type],
      };
      if (item.date) {
        const d = new Date(item.date);
        if (!Number.isNaN(d.getTime())) feedItem.pubDate = d;
      }
      return feedItem;
    });
}

/*
 * Per-item <guid> (v1.1 polish Task 7) needs no code here: @astrojs/rss
 * already stamps `<guid isPermaLink="true">` from each item's own `link`
 * (dist/index.js's generateRSS -- `item.guid = { '#text': itemLink,
 * '@_isPermaLink': 'true' }` whenever `link` is a string), and `link` above
 * is ALREADY the item's absolute permalink -- an essay's canonical
 * starikov.co URL, everything else's starikov.io URL. Nothing to add; see
 * test/feed.test.ts's link assertions, which double as the guid assertions.
 */

/**
 * Channel-level RSS extras (v1.1 polish Task 7) appended via @astrojs/rss's
 * `customData` -- raw XML merged into <channel>, the documented way to add
 * fields the library has no first-class option for: a self-referencing
 * `atom:link` (feed-validator best practice / RFC 5005, so a reader/aggregator
 * knows the feed's own canonical URL even after being copied or reposted) and
 * `lastBuildDate` (this build's own clock, distinct from any item's pubDate).
 * The caller MUST also pass `xmlns: { atom: 'http://www.w3.org/2005/Atom' }`
 * to `rss()` -- the `atom:` prefix here is meaningless without that namespace
 * declared on the root <rss> element. `buildDate` is injected, not read from
 * `new Date()` here, so this unit-tests deterministically (the "testable pure
 * core" pattern the rest of this module already follows). PURE.
 */
export function buildFeedChannelExtras(origin: string, buildDate: Date): string {
  const selfHref = `${origin.replace(/\/$/, '')}/rss.xml`;
  return `<atom:link href="${selfHref}" rel="self" type="application/rss+xml"/><lastBuildDate>${buildDate.toUTCString()}</lastBuildDate>`;
}
