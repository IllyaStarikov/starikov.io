import { describe, expect, it } from 'vitest';
// Imported from the Astro-free pure core (model.ts re-exports these, but pulls
// in `astro:content`, which doesn't resolve under vitest). Same functions.
import {
  joinRepos,
  summarizeRepos,
  sortProjects,
  projectToItem,
  type ProjectRepoData,
} from '../src/lib/projects';

// A repos-collection entry as getCollection('repos') yields it: `id` is the
// LOWERCASED "owner/name", `data.fullName` keeps GitHub's canonical casing.
function repo(fullName: string, over: Partial<ProjectRepoData> = {}) {
  return {
    id: fullName.toLowerCase(),
    data: {
      fullName,
      description: null,
      stars: 0,
      pushedAt: new Date('2026-01-01T00:00:00Z'),
      language: null,
      topics: [],
      archived: false,
      stale: false,
      ...over,
    } as ProjectRepoData,
  };
}

describe('joinRepos', () => {
  const collection = [
    repo('IllyaStarikov/.dotfiles', { stars: 19, language: 'Shell' }),
    repo('IllyaStarikov/omnifocus-mcp', { stars: 13, language: 'TypeScript' }),
    repo('illyaStarikov/resume', { stars: 3, language: 'TeX' }),
  ];

  it('joins a frontmatter repo name to its collection entry by lowercased id', () => {
    const [meta] = joinRepos(['IllyaStarikov/.dotfiles'], collection);
    expect(meta.fullName).toBe('IllyaStarikov/.dotfiles');
    expect(meta.stars).toBe(19);
  });

  it('matches regardless of the casing GitHub reports (id is lowercased both sides)', () => {
    // `illyaStarikov/resume` in site.config vs `IllyaStarikov/...` elsewhere:
    // the lowercased-id join is what makes this not care.
    const [meta] = joinRepos(['ILLYASTARIKOV/RESUME'], collection);
    expect(meta.fullName).toBe('illyaStarikov/resume');
  });

  it('preserves the requested order and clusters multiple repos', () => {
    const metas = joinRepos(
      ['IllyaStarikov/omnifocus-mcp', 'IllyaStarikov/.dotfiles'],
      collection,
    );
    expect(metas.map((m) => m.fullName)).toEqual([
      'IllyaStarikov/omnifocus-mcp',
      'IllyaStarikov/.dotfiles',
    ]);
  });

  it('silently drops a name with no collection entry (repos are decoration, not a gate)', () => {
    const metas = joinRepos(['IllyaStarikov/nonexistent', 'IllyaStarikov/.dotfiles'], collection);
    expect(metas).toHaveLength(1);
    expect(metas[0].fullName).toBe('IllyaStarikov/.dotfiles');
  });
});

describe('summarizeRepos', () => {
  it('sums stars, picks the first language, and takes the most recent push', () => {
    const s = summarizeRepos([
      {
        fullName: 'IllyaStarikov/omnifocus-mcp',
        description: null,
        stars: 13,
        pushedAt: new Date('2026-05-05T00:00:00Z'),
        language: 'TypeScript',
        topics: [],
        archived: false,
        stale: false,
      },
      {
        fullName: 'IllyaStarikov/readwise-mcp',
        description: null,
        stars: 2,
        pushedAt: new Date('2026-05-06T00:00:00Z'),
        language: 'TypeScript',
        topics: [],
        archived: false,
        stale: false,
      },
    ]);
    expect(s.stars).toBe(15);
    expect(s.language).toBe('TypeScript');
    expect(s.updated?.toISOString()).toBe('2026-05-06T00:00:00.000Z');
    expect(s.repos.map((r) => r.url)).toEqual([
      'https://github.com/IllyaStarikov/omnifocus-mcp',
      'https://github.com/IllyaStarikov/readwise-mcp',
    ]);
  });

  it('omits stars when any joined repo is stale (spec: no stale star badge)', () => {
    const s = summarizeRepos([
      {
        fullName: 'IllyaStarikov/.dotfiles',
        description: null,
        stars: 19,
        pushedAt: new Date('2026-07-01T00:00:00Z'),
        language: 'Shell',
        topics: [],
        archived: false,
        stale: true,
      },
    ]);
    expect(s.stars).toBeNull();
    expect(s.stale).toBe(true);
  });

  it('omits a zero-star count rather than rendering a lonely star 0', () => {
    const s = summarizeRepos([
      {
        fullName: 'IllyaStarikov/eclecta',
        description: null,
        stars: 0,
        pushedAt: new Date('2026-07-18T00:00:00Z'),
        language: 'Python',
        topics: [],
        archived: false,
        stale: false,
      },
    ]);
    expect(s.stars).toBeNull();
  });

  it('is empty-safe for a project with no joined repos', () => {
    const s = summarizeRepos([]);
    expect(s).toEqual({ language: null, stars: null, updated: null, stale: false, repos: [] });
  });
});

describe('sortProjects', () => {
  const proj = (id: string, featured: boolean, order: number) => ({
    id,
    data: { title: id, tagline: '', featured, order },
  });

  it('pins featured projects first, each group ordered by `order`', () => {
    const sorted = sortProjects([
      proj('resume', false, 99),
      proj('mcp-servers', true, 3),
      proj('profile', false, 99),
      proj('dotfiles', true, 1),
      proj('eclecta', true, 2),
    ]);
    expect(sorted.slice(0, 3).map((p) => p.id)).toEqual(['dotfiles', 'eclecta', 'mcp-servers']);
    // Featured block leads; the rest follow (order tie broken by title).
    expect(sorted.map((p) => p.id)).toEqual([
      'dotfiles',
      'eclecta',
      'mcp-servers',
      'profile',
      'resume',
    ]);
  });
});

describe('projectToItem', () => {
  it('maps a project entry to the uniform SiteItem, dated from the repo push', () => {
    const item = projectToItem(
      { id: 'dotfiles', data: { title: 'Dotfiles', tagline: 'A decade of shell.' } },
      new Date('2026-07-18T00:00:00Z'),
    );
    expect(item).toEqual({
      type: 'project',
      slug: 'dotfiles',
      title: 'Dotfiles',
      tagline: 'A decade of shell.',
      href: '/projects/dotfiles',
      date: '2026-07-18T00:00:00.000Z',
    });
  });

  it('leaves date undefined when no repo metadata dates the project', () => {
    const item = projectToItem({ id: 'x', data: { title: 'X', tagline: 't' } }, null);
    expect(item.date).toBeUndefined();
  });
});
