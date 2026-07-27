/*
 * /rss.xml -- the site feed (design spec §7). A unified feed of every SiteItem:
 * tools, projects, essays and static pages, newest first, most recent 50. Essay
 * items link OUT to their canonical starikov.co URL; everything else resolves to
 * a starikov.io route. This is the same data /changelog renders as a page, so
 * the feed and the human view can never disagree.
 *
 * All the ordering / link-resolution logic lives in the pure buildFeedItems
 * (src/lib/feed.ts, unit-tested); this route is only the Astro shell.
 */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllItems } from '../lib/model';
import { buildFeedItems, buildFeedChannelExtras } from '../lib/feed';
import { SITE } from '../site.config';

export async function GET(context: APIContext) {
  const origin = context.site?.toString().replace(/\/$/, '') ?? SITE.origin;
  const items = await getAllItems();
  const feedItems = buildFeedItems(items, origin, 50);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: origin,
    // atom: declared here (v1.1 polish Task 7) so the self-link customData
    // appends below actually resolves -- see buildFeedChannelExtras's doc.
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    items: feedItems.map((item) => ({
      title: item.title,
      link: item.link,
      description: item.description,
      pubDate: item.pubDate,
      categories: item.categories,
      // Per-item <guid isPermaLink="true"> is @astrojs/rss's own default,
      // derived from `link` -- nothing to set here, see feed.ts's note.
    })),
    customData: `<language>en-us</language>${buildFeedChannelExtras(origin, new Date())}`,
  });
}
