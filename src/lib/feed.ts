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
