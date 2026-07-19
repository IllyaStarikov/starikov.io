import { describe, expect, it } from 'vitest';
import { buildFeedItems } from '../src/lib/feed';
import type { SiteItem } from '../src/lib/model';

const ORIGIN = 'https://starikov.io';

const items: SiteItem[] = [
  {
    type: 'tool',
    slug: 'pocketcasts-reset',
    title: 'pocketcasts-reset',
    tagline: 'Unfollow every podcast in one go.',
    href: '/bin/pocketcasts-reset',
    date: '2026-05-01T00:00:00.000Z',
  },
  {
    type: 'essay',
    slug: 'on-dotfiles',
    title: 'On dotfiles',
    tagline: 'Ten years of configuration.',
    href: 'https://starikov.co/on-dotfiles/',
    date: '2026-07-10T00:00:00.000Z',
  },
  {
    type: 'project',
    slug: 'dotfiles',
    title: 'Dotfiles',
    tagline: 'The theme engine.',
    href: '/projects/dotfiles',
    date: '2026-06-15T00:00:00.000Z',
  },
  {
    type: 'page',
    slug: 'academia',
    title: 'Academia',
    tagline: 'Four bound volumes.',
    href: '/academia',
    // no date -- an undated page
  },
];

describe('buildFeedItems', () => {
  it('links essays out to their canonical URL and site items onto the origin', () => {
    const feed = buildFeedItems(items, ORIGIN);
    const byTitle = Object.fromEntries(feed.map((f) => [f.title, f]));

    // Essay href is already absolute (starikov.co) -> used verbatim, never prefixed.
    expect(byTitle['On dotfiles'].link).toBe('https://starikov.co/on-dotfiles/');
    // Site items resolve against the origin.
    expect(byTitle['pocketcasts-reset'].link).toBe('https://starikov.io/bin/pocketcasts-reset');
    expect(byTitle['Dotfiles'].link).toBe('https://starikov.io/projects/dotfiles');
    expect(byTitle['Academia'].link).toBe('https://starikov.io/academia');
  });

  it('orders newest first, undated last', () => {
    const feed = buildFeedItems(items, ORIGIN);
    expect(feed.map((f) => f.title)).toEqual([
      'On dotfiles', // 2026-07-10
      'Dotfiles', // 2026-06-15
      'pocketcasts-reset', // 2026-05-01
      'Academia', // undated
    ]);
  });

  it('carries pubDate for dated items and omits it for undated ones', () => {
    const feed = buildFeedItems(items, ORIGIN);
    const byTitle = Object.fromEntries(feed.map((f) => [f.title, f]));
    expect(byTitle['On dotfiles'].pubDate).toBeInstanceOf(Date);
    expect(byTitle['On dotfiles'].pubDate?.toISOString()).toBe('2026-07-10T00:00:00.000Z');
    expect(byTitle['Academia'].pubDate).toBeUndefined();
  });

  it('exposes the SiteItem type as an RSS category and the tagline as description', () => {
    const feed = buildFeedItems(items, ORIGIN);
    const essay = feed.find((f) => f.title === 'On dotfiles')!;
    expect(essay.categories).toEqual(['essay']);
    expect(essay.description).toBe('Ten years of configuration.');
  });

  it('caps the feed at the requested limit, keeping the most recent', () => {
    const feed = buildFeedItems(items, ORIGIN, 2);
    expect(feed).toHaveLength(2);
    expect(feed.map((f) => f.title)).toEqual(['On dotfiles', 'Dotfiles']);
  });

  it('tolerates a trailing slash on the origin without doubling it', () => {
    const feed = buildFeedItems(items, 'https://starikov.io/');
    const tool = feed.find((f) => f.title === 'pocketcasts-reset')!;
    expect(tool.link).toBe('https://starikov.io/bin/pocketcasts-reset');
  });
});
