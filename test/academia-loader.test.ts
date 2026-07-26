import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  parseDocuments,
  parseShowcase,
  splitSections,
  extractMedia,
  cleanBody,
  mediaRefFor,
  withDims,
  courseSlugFromSrcPath,
  deptFromCourseSlug,
  courseCode,
  classifyTheme,
  parseCourseSlug,
  latexDirFor,
  slugFromLatexDir,
  slugify,
  academiaShowcaseLoader,
  coursesLoader,
} from '../src/loaders/academia';
import { report } from '../src/loaders/lib/report';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PORTFOLIO = readFileSync(join(REPO_ROOT, 'test/fixtures/academia/PORTFOLIO.md'), 'utf8');

// academiaShowcaseLoader/coursesLoader call report.count(...), which writes
// under COUNTS_DIR (src/data/generated/counts/ by default -- see report.ts).
// Redirect it to a scratch dir for this whole file so the suite never
// overwrites the real, gitignored counts a genuine `astro build` produced.
let countsDir: string;

beforeAll(() => {
  countsDir = mkdtempSync(join(tmpdir(), 'academia-loader-counts-'));
  process.env.COUNTS_DIR = countsDir;
});

afterAll(() => {
  delete process.env.COUNTS_DIR;
  rmSync(countsDir, { recursive: true, force: true });
});

afterEach(() => {
  report.flush();
  delete process.env.GITHUB_ACTIONS;
  delete process.env.BUILD_STRICT;
  delete process.env.ACADEMIA_MEDIA_MANIFEST;
});

// ---------------------------------------------------------------------------
// Documents table
// ---------------------------------------------------------------------------
describe('parseDocuments', () => {
  const docs = parseDocuments(PORTFOLIO);

  it('extracts all four volumes with title, page count, and blurb', () => {
    expect(docs).toHaveLength(4);
    expect(docs.map((d) => d.title)).toEqual(['Curated', 'Notes', 'Assignments', 'Complete']);
    expect(docs.map((d) => d.pages)).toEqual([284, 473, 498, 1113]); // note: "1,113" comma stripped
    expect(docs[0].blurb).toBe('Curated selection of best work');
    expect(docs[3].blurb).toBe('Complete collection: assignments + notes');
  });
});

// ---------------------------------------------------------------------------
// Section splitting (case-preserving, fence-aware)
// ---------------------------------------------------------------------------
describe('splitSections', () => {
  it('preserves original heading case and ignores `##` inside code fences', () => {
    const sections = splitSections(PORTFOLIO);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain('1. Chess AI');
    expect(headings).toContain('Documents');
    // "## bad_homework.cpp" lives inside a fenced block in the Grading Suite
    // section — it must NOT surface as a section heading.
    expect(headings).not.toContain('bad_homework.cpp');
    expect(headings).not.toContain('bad_homework.h');
  });
});

// ---------------------------------------------------------------------------
// Showcase parsing
// ---------------------------------------------------------------------------
describe('parseShowcase', () => {
  const projects = parseShowcase(PORTFOLIO);
  const byTitle = new Map(projects.map((p) => [p.title, p]));

  it('parses exactly the 14 numbered projects, in order', () => {
    expect(projects).toHaveLength(14);
    expect(projects.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(projects[0].title).toBe('Chess AI');
    expect(projects[13].title).toBe('Camelot');
  });

  it('extracts the **Path:** source location and derives courseSlug/dept', () => {
    const chess = byTitle.get('Chess AI')!;
    expect(chess.srcPath).toBe('src/cs5400-artificial-intelligence/game-series/');
    expect(chess.courseSlug).toBe('cs5400-artificial-intelligence');
    expect(chess.dept).toBe('cs5400');
    expect(chess.courseCode).toBe('CS 5400');

    // A non-course path (`src/bolt`) yields a courseSlug but no dept/code.
    const bolt = byTitle.get('Bolt')!;
    expect(bolt.srcPath).toBe('src/bolt');
    expect(bolt.courseSlug).toBe('bolt');
    expect(bolt.dept).toBeUndefined();
    expect(bolt.courseCode).toBeUndefined();
  });

  it('extracts media: a single GIF, two GIFs, a PNG, and none', () => {
    const chess = byTitle.get('Chess AI')!;
    expect(chess.media).toEqual([
      {
        kind: 'video',
        slug: 'chess_ai',
        alt: 'Chess AI Demo',
        poster: '/media/academia/chess_ai.jpg',
        mp4: '/media/academia/chess_ai.mp4',
        webm: '/media/academia/chess_ai.webm',
      },
    ]);

    // Splatoonio references two GIFs (game + menu).
    expect(byTitle.get('Splatoonio')!.media.map((m) => m.slug)).toEqual([
      'splatoonio_game',
      'splatoonio_menu',
    ]);

    // Lexical Analyzer references a PNG → image kind; AVIF+WebP outputs
    // regardless of the source extension (scripts/transcode-media.mjs never
    // copies a raw image verbatim).
    expect(byTitle.get('Lexical Analyzer')!.media).toEqual([
      {
        kind: 'image',
        slug: 'automata',
        alt: 'Lexer DFA',
        avif: '/media/academia/automata.avif',
        webp: '/media/academia/automata.webp',
      },
    ]);

    // CFG Tracer only has a <details> code sample — no media.
    expect(byTitle.get('CFG Tracer')!.media).toEqual([]);
  });

  it('classifies projects into the four themes', () => {
    const themeOf = (t: string) => byTitle.get(t)!.theme;
    // AI: cs5400 / cs5401 departments.
    expect(['Chess AI', 'Shape Packer', 'Puzzle Solvers'].map(themeOf)).toEqual(['ai', 'ai', 'ai']);
    // Games: cs4096 dept + the "invaders" keyword.
    expect(['Splatoonio', 'Space Invaders'].map(themeOf)).toEqual(['games', 'games']);
    // Graphics: cs5201 dept + "lexical"/"graph analytics" keywords.
    expect(['Linear Algebra Library', 'Lexical Analyzer', 'Graph Analytics Suite'].map(themeOf)).toEqual([
      'graphics',
      'graphics',
      'graphics',
    ]);
    // Systems: everything else (fallback).
    expect(
      ['Knapsack Memory Manager', 'CFG Tracer', 'Bolt', 'CLC Tally', 'Grading Suite', 'Camelot'].map(
        themeOf,
      ),
    ).toEqual(['systems', 'systems', 'systems', 'systems', 'systems', 'systems']);
  });

  it('strips Path/media/details from the prose body but keeps the description', () => {
    const chess = byTitle.get('Chess AI')!;
    expect(chess.bodyMarkdown).toContain('Built a chess engine from scratch');
    expect(chess.bodyMarkdown).not.toContain('**Path:**');
    expect(chess.bodyMarkdown).not.toContain('<img');
    expect(chess.bodyMarkdown).not.toContain('chess_ai.gif');

    const cfg = byTitle.get('CFG Tracer')!;
    expect(cfg.bodyMarkdown).toContain('control flow');
    expect(cfg.bodyMarkdown).not.toContain('<details>');
    expect(cfg.bodyMarkdown).not.toContain('B4 (ENTRY)'); // sample removed with the <details>
  });
});

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------
describe('mediaRefFor', () => {
  it('maps a GIF to a video with mp4/webm/poster outputs', () => {
    expect(mediaRefFor('assets/match3.gif', 'Mechanical Match Demo')).toEqual({
      kind: 'video',
      slug: 'match3',
      alt: 'Mechanical Match Demo',
      poster: '/media/academia/match3.jpg',
      mp4: '/media/academia/match3.mp4',
      webm: '/media/academia/match3.webm',
    });
  });

  it('maps a non-GIF to an image with AVIF+WebP outputs, regardless of source extension', () => {
    expect(mediaRefFor('assets/socket_chat.png', 'Socket Chat Client')).toEqual({
      kind: 'image',
      slug: 'socket_chat',
      alt: 'Socket Chat Client',
      avif: '/media/academia/socket_chat.avif',
      webp: '/media/academia/socket_chat.webp',
    });
    // A .jpg source is exactly as image-typed as a .png -- only the GIF
    // extension routes to the video branch.
    expect(mediaRefFor('assets/linear_algebra.jpg', 'Linear Algebra')?.kind).toBe('image');
  });
});

describe('withDims (manifest dims fall-through)', () => {
  const imageRef = mediaRefFor('assets/socket_chat.png', 'Socket Chat Client')!;
  const videoRef = mediaRefFor('assets/match3.gif', 'Match 3')!;

  it('attaches width/height when the manifest has a matching-kind entry', () => {
    const manifest = { socket_chat: { kind: 'image' as const, width: 733, height: 1238 } };
    expect(withDims(imageRef, manifest)).toEqual({ ...imageRef, width: 733, height: 1238 });
  });

  it('falls through untouched when the slug is absent from the manifest', () => {
    expect(withDims(imageRef, {})).toEqual(imageRef);
    expect(withDims(imageRef, { some_other_slug: { kind: 'image', width: 1, height: 1 } })).toEqual(
      imageRef,
    );
  });

  it('falls through untouched on a kind mismatch (defensive; slugs are unique in practice)', () => {
    const manifest = { socket_chat: { kind: 'video' as const, width: 100, height: 100 } };
    expect(withDims(imageRef, manifest)).toEqual(imageRef);
  });

  it('extractMedia threads the manifest through to every ref it produces', () => {
    const section = ['<img src="assets/match3.gif" alt="Match 3">'].join('\n');
    const manifest = { match3: { kind: 'video' as const, width: 456, height: 800 } };
    expect(extractMedia(section, manifest)).toEqual([{ ...videoRef, width: 456, height: 800 }]);
    // Omitting the manifest (default {}) is exactly the "manifest absent" degrade.
    expect(extractMedia(section)).toEqual([videoRef]);
  });
});

describe('extractMedia / cleanBody', () => {
  const section = [
    '**Path:** `src/demo/`',
    '',
    '<p align="center">',
    '  <img src="assets/one.gif" alt="One" width="300">',
    '  <img src="assets/two.png" alt="Two">',
    '</p>',
    '',
    'Prose that should survive.',
    '',
    '<details>',
    '<summary>Sample</summary>',
    '',
    '```',
    'hidden code',
    '```',
    '</details>',
  ].join('\n');

  it('pulls every assets/* image in order', () => {
    expect(extractMedia(section).map((m) => m.slug)).toEqual(['one', 'two']);
  });

  it('removes the Path line, media blocks, and details, keeping prose', () => {
    const body = cleanBody(section);
    expect(body).toBe('Prose that should survive.');
  });
});

describe('course-slug + theme helpers', () => {
  it('derives courseSlug from a src path', () => {
    expect(courseSlugFromSrcPath('src/cs2500-algorithms/CS2500-Project1/')).toBe('cs2500-algorithms');
    expect(courseSlugFromSrcPath('src/clc-tally')).toBe('clc-tally');
    expect(courseSlugFromSrcPath('')).toBeUndefined();
  });

  it('derives dept + display code from a course slug', () => {
    expect(deptFromCourseSlug('cpe3150-micro-embedded-design')).toBe('cpe3150');
    expect(deptFromCourseSlug('clc-tally')).toBeUndefined();
    expect(courseCode('cpe3150')).toBe('CPE 3150');
    expect(courseCode(undefined)).toBeUndefined();
  });

  it('falls back to systems for an unmatched project', () => {
    expect(classifyTheme('cs9999', 'Some Unrelated Thing')).toBe('systems');
    expect(classifyTheme(undefined, 'Plain Title')).toBe('systems');
  });

  it('slugifies titles', () => {
    expect(slugify('Chess AI')).toBe('chess-ai');
    expect(slugify('CLC Tally')).toBe('clc-tally');
  });
});

describe('parseCourseSlug (dir enumeration regex)', () => {
  it('parses a real course dir, including the cpe edge case', () => {
    expect(parseCourseSlug('cpe3150-micro-embedded-design')).toEqual({
      slug: 'cpe3150-micro-embedded-design',
      dept: 'cpe3150',
      number: '3150',
      code: 'CPE 3150',
      title: 'Micro Embedded Design',
    });
    expect(parseCourseSlug('cs5201-object-oriented-numerical-modeling-ninjas')!.title).toBe(
      'Object Oriented Numerical Modeling Ninjas',
    );
  });

  it('returns null for non-course directories', () => {
    expect(parseCourseSlug('bolt')).toBeNull();
    expect(parseCourseSlug('clc-tally')).toBeNull();
    expect(parseCourseSlug('missouri-valley-college')).toBeNull();
    expect(parseCourseSlug('makefile')).toBeNull();
  });

  it('maps a slug to its latex notes directory and back (dashes ↔ underscores)', () => {
    expect(latexDirFor('cs5400-artificial-intelligence')).toBe('cs5400_artificial_intelligence');
    expect(slugFromLatexDir('math3304_differential_equations')).toBe(
      'math3304-differential-equations',
    );
  });
});

// ---------------------------------------------------------------------------
// Loader shells (fake LoaderContext + temp fixture directories)
// ---------------------------------------------------------------------------
interface StoredEntry {
  id: string;
  data: Record<string, unknown>;
  digest?: string | number;
  filePath?: string;
}

function fakeContext() {
  const map = new Map<string, StoredEntry>();
  const store = {
    set: (entry: StoredEntry) => (map.set(entry.id, entry), true),
    get: (key: string) => map.get(key),
    keys: () => [...map.keys()],
    values: () => [...map.values()],
    entries: () => [...map.entries()],
    has: (key: string) => map.has(key),
    delete: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    addModuleImport: () => {},
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {}, options: {}, label: 'test', fork: () => logger };
  return {
    map,
    context: {
      collection: 'academia',
      store,
      logger,
      meta: new Map(),
      config: {} as never,
      parseData: async ({ data }: { data: Record<string, unknown> }) => data,
      renderMarkdown: async (content: string) => ({ html: `<render>${content}</render>` }),
      generateDigest: (input: unknown) => `digest:${typeof input === 'string' ? input.length : 'obj'}`,
    } as never,
  };
}

describe('academiaShowcaseLoader', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'academia-'));
    root = join(parent, 'academia');
    mkdirSync(root);
    writeFileSync(join(root, 'PORTFOLIO.md'), PORTFOLIO);
  });
  afterAll(() => rmSync(parent, { recursive: true, force: true }));

  it('loads all 14 projects with rendered, media-free bodies', async () => {
    // Deterministic regardless of whether a real transcode run happened to
    // leave public/media/academia/manifest.json on disk (see the manifest
    // guard tests below for that behavior) -- this test only cares about
    // parsing, not dims.
    process.env.ACADEMIA_MEDIA_MANIFEST = join(parent, 'no-manifest-here.json');
    const { context, map } = fakeContext();
    await academiaShowcaseLoader({ root }).load(context);

    expect(map.size).toBe(14);
    const chess = map.get('chess-ai')!.data as Record<string, any>;
    expect(chess.theme).toBe('ai');
    expect(chess.media).toHaveLength(1);
    expect(chess.media[0].kind).toBe('video');
    expect(chess.body).toContain('<render>');
    expect(chess.body).not.toContain('**Path:**');
    expect(chess.body).not.toContain('<img');

    expect((map.get('splatoonio')!.data as any).media).toHaveLength(2);
    expect((map.get('cfg-tracer')!.data as any).media).toHaveLength(0);
    expect(map.get('chess-ai')!.digest).toBeTruthy();
  });

  it('loader guard: warns (not throws) and omits dims when the manifest is absent', async () => {
    process.env.ACADEMIA_MEDIA_MANIFEST = join(parent, 'still-no-manifest.json');
    const { context, map } = fakeContext();
    report.flush();
    await academiaShowcaseLoader({ root }).load(context);

    const chess = map.get('chess-ai')!.data as Record<string, any>;
    expect(chess.media[0].width).toBeUndefined();
    expect(chess.media[0].height).toBeUndefined();
    // A missing manifest is a warning (build still succeeds), not an error.
    expect(report.flush().warnings).toBeGreaterThanOrEqual(1);
  });

  it('loader guard: attaches manifest dims by slug when the manifest is present', async () => {
    const manifestPath = join(parent, 'has-a-manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({ chess_ai: { kind: 'video', width: 572, height: 800 } }),
    );
    process.env.ACADEMIA_MEDIA_MANIFEST = manifestPath;
    const { context, map } = fakeContext();
    await academiaShowcaseLoader({ root }).load(context);

    const chess = map.get('chess-ai')!.data as Record<string, any>;
    expect(chess.media[0]).toMatchObject({ width: 572, height: 800 });
    // splatoonio's slugs aren't in this manifest -- dims absent, no crash.
    expect((map.get('splatoonio')!.data as any).media[0].width).toBeUndefined();
  });

  it('loader guard: warns (not throws) on a corrupt manifest', async () => {
    const manifestPath = join(parent, 'corrupt-manifest.json');
    writeFileSync(manifestPath, '{ not valid json');
    process.env.ACADEMIA_MEDIA_MANIFEST = manifestPath;
    const { context, map } = fakeContext();
    report.flush();
    await academiaShowcaseLoader({ root }).load(context);

    expect(map.size).toBe(14); // the showcase itself still loads fine
    expect(report.flush().warnings).toBeGreaterThanOrEqual(1);
  });

  it('warns (not throws) on a missing PORTFOLIO.md without BUILD_STRICT', async () => {
    const { context, map } = fakeContext();
    report.flush();
    await academiaShowcaseLoader({ root: join(parent, 'nope') }).load(context);
    expect(map.size).toBe(0);
    expect(report.flush().warnings).toBe(1);
  });

  it('throws on a missing PORTFOLIO.md under BUILD_STRICT (CI fails loudly)', async () => {
    process.env.BUILD_STRICT = '1';
    const { context } = fakeContext();
    await expect(academiaShowcaseLoader({ root: join(parent, 'nope') }).load(context)).rejects.toThrow();
  });
});

describe('coursesLoader (src ∪ latex union)', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'courses-'));
    root = join(parent, 'academia');
    // src/: two code courses (one with two assignment subdirs) + a non-course dir.
    mkdirSync(join(root, 'src/cs5400-artificial-intelligence/game-series'), { recursive: true });
    mkdirSync(join(root, 'src/cs5400-artificial-intelligence/puzzle-series'));
    mkdirSync(join(root, 'src/cpe3150-micro-embedded-design/project-1'), { recursive: true });
    mkdirSync(join(root, 'src/bolt'), { recursive: true }); // not a course → skipped
    // latex/: notes for cs5400 (merges) + a genuinely notes-only gen-ed +
    // a same-department component that must be FOLDED, not double-counted.
    mkdirSync(join(root, 'latex/cs5400_artificial_intelligence'), { recursive: true });
    mkdirSync(join(root, 'latex/phys1135_physics_i'), { recursive: true });
    mkdirSync(join(root, 'latex/cs5400_seminar'), { recursive: true }); // dept cs5400 already present
    mkdirSync(join(root, 'latex/assets'), { recursive: true }); // not a course → skipped
  });
  afterAll(() => rmSync(parent, { recursive: true, force: true }));

  it('unions code + notes-only courses, folds same-dept latex components, skips non-courses', async () => {
    const { context, map } = fakeContext();
    await coursesLoader({ root }).load(context);

    // src code courses + the notes-only gen-ed; NOT bolt, NOT cs5400-seminar, NOT assets.
    expect(new Set(map.keys())).toEqual(
      new Set([
        'cs5400-artificial-intelligence',
        'cpe3150-micro-embedded-design',
        'phys1135-physics-i',
      ]),
    );

    const cs5400 = map.get('cs5400-artificial-intelligence')!.data as Record<string, any>;
    expect(cs5400.code).toBe('CS 5400');
    expect(cs5400.title).toBe('Artificial Intelligence');
    expect(cs5400.hasCode).toBe(true);
    expect(cs5400.hasNotes).toBe(true);
    expect(cs5400.assignmentCount).toBe(2);
    expect(cs5400.sourceUrl).toBe(
      'https://github.com/IllyaStarikov/academia/tree/main/src/cs5400-artificial-intelligence',
    );

    const cpe = map.get('cpe3150-micro-embedded-design')!.data as Record<string, any>;
    expect(cpe.hasCode).toBe(true);
    expect(cpe.hasNotes).toBe(false); // no latex/cpe3150_… dir
    expect(cpe.assignmentCount).toBe(1);

    // Notes-only course: derived code + title, hasCode false, hasNotes true,
    // no assignments, sourced from the latex dir.
    const phys = map.get('phys1135-physics-i')!.data as Record<string, any>;
    expect(phys.hasCode).toBe(false);
    expect(phys.hasNotes).toBe(true);
    expect(phys.assignmentCount).toBe(0);
    expect(phys.code).toBe('PHYS 1135');
    expect(phys.title).toBe('Physics I');
    expect(phys.sourceUrl).toBe(
      'https://github.com/IllyaStarikov/academia/tree/main/latex/phys1135_physics_i',
    );
  });
});

// Guarded assertion against the real checkout (skips on a clean clone with no
// .sources/academia): the whole-degree union is 34 and matches the /academia
// stat strip. cs3001's `presentations` latex folder is folded into the cs3001
// course rather than double-counted.
const REAL_ROOT = join(REPO_ROOT, '.sources/academia');
const realOrSkip = existsSync(join(REAL_ROOT, 'src')) ? describe : describe.skip;
realOrSkip('coursesLoader — real academia checkout', () => {
  it('enumerates the 34-course union including notes-only gen-eds', async () => {
    const { context, map } = fakeContext();
    await coursesLoader({ root: REAL_ROOT }).load(context);

    expect(map.size).toBe(34);

    const phys = map.get('phys1135-physics-i')!.data as Record<string, any>;
    expect(phys.hasCode).toBe(false);
    expect(phys.hasNotes).toBe(true);
    expect(phys.code).toBe('PHYS 1135');

    // cs3001 stays a single course (presentations folded, not a 35th row).
    expect(map.has('cs3001-presentations')).toBe(false);
    expect((map.get('cs3001-skills-development')!.data as Record<string, any>).hasCode).toBe(true);
    // a code-bearing course keeps hasCode true.
    expect((map.get('cs5400-artificial-intelligence')!.data as Record<string, any>).hasCode).toBe(
      true,
    );
  });
});
