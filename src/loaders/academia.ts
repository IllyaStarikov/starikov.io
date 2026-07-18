/*
 * academia — the auto-generated /academia collections loader (two collections
 * out of one archived source repo checkout):
 *
 *   academiaShowcase — the 14 hand-picked projects from PORTFOLIO.md's numbered
 *                      `## N. Title` sections: order, title, the `**Path:**`
 *                      source location, the classified theme bucket, the
 *                      referenced media (GIF → looping video, PNG → image), and
 *                      the prose body (media/`<details>` stripped, rendered to
 *                      HTML at load time so the page just `set:html`s it).
 *   courses          — every `src/<slug>/` course directory whose name matches
 *                      `dept+number-title` (e.g. `cs5400-artificial-intelligence`),
 *                      with a humanized title, a `latex/<underscored>/` notes
 *                      flag, and an assignment count from its subdirectories.
 *
 * **This loader never executes any repo code.** It reads PORTFOLIO.md and
 * enumerates directory names; nothing inside `src/**` or `latex/**` is run.
 *
 * Archived-repo policy (design §6 "fail loudly", kept locally usable): a missing
 * PORTFOLIO.md or an empty parse is a hard failure only under BUILD_STRICT (CI),
 * where it throws a non-zero exit; locally it degrades to a warning so `astro
 * dev` still runs. See `failLoud`.
 *
 * Split of responsibilities (mirrors bin-tools): everything above the loader
 * shells is PURE (no IO, no Astro context, no markdown→HTML) and unit-tested
 * directly; the shells walk the filesystem, render markdown, and write the
 * content store.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import type { Loader } from 'astro/loaders';
import { parseReadme } from './lib/markdown-tables';
import { report } from './lib/report';
import { GITHUB_URL } from '../lib/nav';
import {
  ACADEMIA_THEME_RULES,
  ACADEMIA_THEME_FALLBACK,
  PDF_VOLUMES,
} from '../site.config.mjs';

const SHOWCASE_SOURCE = 'academia-showcase';
const COURSES_SOURCE = 'academia-courses';
const ACADEMIA_REPO = `${GITHUB_URL}/academia`;

/** Public URL prefix for transcoded showcase media (public/media/academia/…). */
export const MEDIA_BASE = '/media/academia';

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

export type MediaRef =
  | { kind: 'video'; slug: string; alt: string; poster: string; mp4: string; webm: string }
  | { kind: 'image'; slug: string; alt: string; src: string };

/** GIFs become looping muted videos; everything else is served as an image. */
const VIDEO_EXTS = new Set(['.gif']);

/**
 * Turn a PORTFOLIO `<img src="assets/NAME.ext">` reference into a MediaRef with
 * the build-time output paths the transcode step produces. Returns null for a
 * srcless/degenerate reference. Pure and deterministic (keyed on the asset's
 * basename) so the loader and scripts/transcode-media.mjs agree on file names
 * without sharing state.
 */
export function mediaRefFor(src: string, alt: string): MediaRef | null {
  const file = basename(src.trim());
  const ext = extname(file).toLowerCase();
  const slug = file.slice(0, file.length - ext.length);
  if (!slug) return null;
  if (VIDEO_EXTS.has(ext)) {
    return {
      kind: 'video',
      slug,
      alt,
      poster: `${MEDIA_BASE}/${slug}.jpg`,
      mp4: `${MEDIA_BASE}/${slug}.mp4`,
      webm: `${MEDIA_BASE}/${slug}.webm`,
    };
  }
  return { kind: 'image', slug, alt, src: `${MEDIA_BASE}/${file}` };
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : undefined;
}

/** Every `assets/*` image referenced in a section, in document order. */
export function extractMedia(sectionMd: string): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const tag of sectionMd.match(IMG_TAG_RE) ?? []) {
    const src = attr(tag, 'src');
    if (!src || !/(^|\/)assets\//.test(src)) continue;
    const ref = mediaRefFor(src, attr(tag, 'alt') ?? '');
    if (ref) refs.push(ref);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Section body cleanup
// ---------------------------------------------------------------------------

/**
 * The prose that stays on the page: the `**Path:**` line, the centered
 * `<p><img></p>` media blocks, and the collapsible `<details>` code samples are
 * all removed (media renders separately; code samples are out of scope for the
 * ledger). What remains is the project's descriptive markdown.
 */
export function cleanBody(sectionMd: string): string {
  return sectionMd
    .replace(/^[ \t]*\*\*Path:\*\*.*$/gim, '')
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Course-slug derivation + theme classification
// ---------------------------------------------------------------------------

const COURSE_SLUG_RE = /^([a-z]+)(\d+)-(.+)$/;

/** First path segment after `src/`: `src/cs5400-ai/game/` → `cs5400-ai`. */
export function courseSlugFromSrcPath(srcPath: string): string | undefined {
  const parts = srcPath
    .trim()
    .replace(/^\.?\//, '')
    .split('/')
    .filter(Boolean);
  if (parts[0] !== 'src' || parts.length < 2) return undefined;
  return parts[1];
}

/** Department code from a course slug: `cs5400-artificial-…` → `cs5400`. */
export function deptFromCourseSlug(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  const m = slug.match(COURSE_SLUG_RE);
  return m ? `${m[1]}${m[2]}` : undefined;
}

/** Display code from a dept: `cs5400` → `CS 5400`, `cpe3150` → `CPE 3150`. */
export function courseCode(dept: string | undefined): string | undefined {
  if (!dept) return undefined;
  const m = dept.match(/^([a-z]+)(\d+)$/i);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : dept.toUpperCase();
}

interface ThemeRule {
  theme: string;
  depts: readonly string[];
  keywords: readonly string[];
}

/**
 * Bucket a project into one of the four showcase themes. Rules (from
 * site.config, so the buckets are tunable data) are tried in order: a project
 * matches on department code OR a title keyword; unmatched projects fall to the
 * configured fallback (`systems`). Pure.
 */
export function classifyTheme(
  dept: string | undefined,
  title: string,
  rules: readonly ThemeRule[] = ACADEMIA_THEME_RULES,
  fallback: string = ACADEMIA_THEME_FALLBACK,
): string {
  const t = title.toLowerCase();
  for (const rule of rules) {
    if (dept && rule.depts.includes(dept)) return rule.theme;
    if (rule.keywords.some((k) => t.includes(k))) return rule.theme;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// PORTFOLIO.md parsing
// ---------------------------------------------------------------------------

export interface VolumeDoc {
  title: string;
  pages: number;
  blurb: string;
}

/**
 * The `## Documents` table rows. Used to CROSS-CHECK the frozen PDF_VOLUMES
 * page counts (the page renders from the const, not this) — drift warns. Uses
 * the shared parseReadme so table-heading casing and cell flattening match the
 * rest of the site.
 */
export function parseDocuments(md: string): VolumeDoc[] {
  const table = parseReadme(md).tables.find((t) => t.heading.toLowerCase() === 'documents');
  if (!table) return [];
  return table.rows
    .filter((row) => row.length >= 2)
    .map(([title, pages, blurb]) => ({
      title: (title ?? '').trim(),
      pages: Number((pages ?? '').replace(/[,\s]/g, '')),
      blurb: (blurb ?? '').trim(),
    }));
}

/**
 * Split markdown into its `## ` (depth-2) sections, preserving the ORIGINAL
 * heading text. parseReadme lowercases its section keys, which would lose
 * "Chess AI" → "chess ai"; the showcase needs real titles, so this walks the
 * source itself. Fenced code blocks are tracked so a literal `## foo` inside a
 * ``` fence (PORTFOLIO's stylechecker sample output has some) is never mistaken
 * for a heading.
 */
export function splitSections(md: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  let cur: { heading: string; body: string[] } | null = null;
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence && /^##[ \t]+(.*\S)[ \t]*$/.exec(line);
    if (m) {
      if (cur) out.push({ heading: cur.heading, body: cur.body.join('\n').trim() });
      cur = { heading: m[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) out.push({ heading: cur.heading, body: cur.body.join('\n').trim() });
  return out;
}

export interface ParsedProject {
  order: number;
  title: string;
  srcPath: string;
  courseSlug?: string;
  dept?: string;
  courseCode?: string;
  theme: string;
  media: MediaRef[];
  /** Prose markdown (media + Path + details removed); rendered by the shell. */
  bodyMarkdown: string;
}

const NUMBERED_RE = /^(\d+)\.\s+(.*\S)\s*$/;
const PATH_RE = /\*\*Path:\*\*\s*`([^`]+)`/;

/** The numbered `## N. Title` project sections, ordered by their number. Pure. */
export function parseShowcase(md: string): ParsedProject[] {
  const projects: ParsedProject[] = [];
  for (const { heading, body } of splitSections(md)) {
    const hm = heading.match(NUMBERED_RE);
    if (!hm) continue;
    const order = Number(hm[1]);
    const title = hm[2].trim();
    const srcPath = body.match(PATH_RE)?.[1].trim() ?? '';
    const courseSlug = courseSlugFromSrcPath(srcPath);
    const dept = deptFromCourseSlug(courseSlug);
    projects.push({
      order,
      title,
      srcPath,
      courseSlug,
      dept,
      courseCode: courseCode(dept),
      theme: classifyTheme(dept, title),
      media: extractMedia(body),
      bodyMarkdown: cleanBody(body),
    });
  }
  return projects.sort((a, b) => a.order - b.order);
}

/** URL-safe id from a title: `Chess AI` → `chess-ai`, `CLC Tally` → `clc-tally`. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Course-directory parsing
// ---------------------------------------------------------------------------

export interface CourseParts {
  slug: string;
  dept: string;
  number: string;
  code: string;
  title: string;
}

function humanize(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Parse a course directory name into its parts, or null when it isn't a course
 * (no `letters+digits-title` shape — e.g. `bolt`, `clc-tally`,
 * `missouri-valley-college`). `cpe3150-micro-embedded-design` →
 * {dept:'cpe3150', number:'3150', code:'CPE 3150', title:'Micro Embedded Design'}.
 */
export function parseCourseSlug(name: string): CourseParts | null {
  const m = name.match(COURSE_SLUG_RE);
  if (!m) return null;
  const dept = `${m[1]}${m[2]}`;
  return { slug: name, dept, number: m[2], code: courseCode(dept)!, title: humanize(m[3]) };
}

/** The `latex/<underscored>/` directory a course's notes would live in. */
export function latexDirFor(slug: string): string {
  return slug.replace(/-/g, '_');
}

/** Inverse of latexDirFor: a `latex/` dir name back to a course slug. */
export function slugFromLatexDir(name: string): string {
  return name.replace(/_/g, '-');
}

function listDirNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Loader shells
// ---------------------------------------------------------------------------

/** report.error + throw under BUILD_STRICT (CI); a plain warning otherwise. */
function failLoud(source: string, msg: string): void {
  if (process.env.BUILD_STRICT) {
    report.error(source, msg);
    throw new Error(`${source}: ${msg}`);
  }
  report.warn(source, msg);
}

/**
 * `academiaShowcase` collection loader. `root` is the academia checkout
 * (`.sources/academia`). Reads PORTFOLIO.md, renders each project's prose to
 * HTML, and records media output paths (the transcode prebuild produces the
 * actual files). Empty/missing/failed parse follows the archived-repo policy.
 */
export function academiaShowcaseLoader({ root }: { root: string }): Loader {
  return {
    name: SHOWCASE_SOURCE,
    async load({ store, parseData, generateDigest, renderMarkdown, logger }) {
      store.clear();

      const absRoot = resolve(root);
      const portfolioPath = join(absRoot, 'PORTFOLIO.md');
      if (!existsSync(portfolioPath)) {
        failLoud(
          SHOWCASE_SOURCE,
          `PORTFOLIO.md not found at ${root}; /academia showcase is empty`,
        );
        logger.warn(`${root}/PORTFOLIO.md missing; academiaShowcase is empty`);
        return;
      }

      const md = readFileSync(portfolioPath, 'utf8');
      const filePath = relative(process.cwd(), portfolioPath);

      // Cross-check the parsed Documents table against the frozen page counts.
      const byTitle = new Map(parseDocuments(md).map((d) => [d.title.toLowerCase(), d.pages]));
      for (const vol of PDF_VOLUMES) {
        const parsed = byTitle.get(vol.title.toLowerCase());
        if (parsed !== undefined && parsed !== vol.pages) {
          report.warn(
            SHOWCASE_SOURCE,
            `Documents table lists ${vol.title} at ${parsed}pp but PDF_VOLUMES says ${vol.pages}pp`,
          );
        }
      }

      let projects: ParsedProject[];
      try {
        projects = parseShowcase(md);
      } catch (err) {
        failLoud(SHOWCASE_SOURCE, `PORTFOLIO.md parse failed: ${(err as Error).message}`);
        return;
      }

      if (projects.length === 0) {
        failLoud(SHOWCASE_SOURCE, 'PORTFOLIO.md yielded no numbered project sections');
        return;
      }

      const used = new Set<string>();
      for (const p of projects) {
        if (!p.srcPath) {
          report.warn(SHOWCASE_SOURCE, `project "${p.title}" has no **Path:** line`);
        }
        let id = slugify(p.title);
        if (!id || used.has(id)) id = `${String(p.order).padStart(2, '0')}-${id || 'project'}`;
        used.add(id);

        const data = {
          order: p.order,
          title: p.title,
          srcPath: p.srcPath,
          courseSlug: p.courseSlug,
          courseCode: p.courseCode,
          dept: p.dept,
          theme: p.theme,
          media: p.media,
          body: (await renderMarkdown(p.bodyMarkdown)).html,
        };
        const validated = await parseData({ id, data, filePath });
        store.set({ id, data: validated, digest: generateDigest(data), filePath });
      }

      logger.info(`loaded ${projects.length} academia project(s) from ${root}`);
    },
  };
}

// A `type` (not `interface`) so it carries an implicit index signature and is
// assignable to the loader context's `Record<string, unknown>` (parseData /
// generateDigest) without a cast.
export type CourseData = {
  slug: string;
  code: string;
  dept: string;
  number: string;
  title: string;
  /** Has source code / assignments in `src/` (vs a notes-only course). */
  hasCode: boolean;
  /** Has typeset notes in `latex/`. */
  hasNotes: boolean;
  assignmentCount: number;
  sourceUrl: string;
};

/**
 * `courses` collection loader. Enumerates the UNION of code-bearing courses in
 * `src/<slug>/` and notes-only courses in `latex/<underscored>/`, so the course
 * index reflects the whole degree — including the gen-eds (calculus, physics,
 * …) that were typeset but carry no source code.
 *
 *   - `src/` course dirs are authoritative: `hasCode: true`, assignment count
 *     from subdirs, `hasNotes` from a matching `latex/` dir. A department can
 *     hold several src courses (cs1570 has two).
 *   - a `latex/` course adds a notes-only row (`hasCode: false`,
 *     `assignmentCount: 0`) ONLY when its department isn't already represented.
 *     A same-slug latex dir just confirms `hasNotes` (already set); a
 *     same-department latex dir (e.g. `cs3001_presentations` alongside the
 *     `cs3001_skills_development` course) is a component of that existing
 *     course, not a new one, so it's folded rather than double-counted.
 *
 * A missing `src/` AND `latex/`, or an empty result, follows the archived-repo
 * policy.
 */
export function coursesLoader({ root }: { root: string }): Loader {
  return {
    name: COURSES_SOURCE,
    async load({ store, parseData, generateDigest, logger }) {
      store.clear();

      const absRoot = resolve(root);
      const srcDir = join(absRoot, 'src');
      const latexDir = join(absRoot, 'latex');
      if (!existsSync(srcDir) && !existsSync(latexDir)) {
        failLoud(COURSES_SOURCE, `neither src/ nor latex/ found at ${root}; course index is empty`);
        logger.warn(`${root} has no src/ or latex/; courses is empty`);
        return;
      }

      const entries = new Map<string, CourseData>();
      const deptsSeen = new Set<string>();

      // Pass 1: code-bearing courses from src/.
      if (existsSync(srcDir)) {
        for (const name of listDirNames(srcDir)) {
          const parts = parseCourseSlug(name);
          if (!parts) continue; // not a course dir (bolt, clc-tally, …) — skip silently
          const assignmentCount = listDirNames(join(srcDir, name)).length;
          entries.set(parts.slug, {
            slug: parts.slug,
            code: parts.code,
            dept: parts.dept,
            number: parts.number,
            title: parts.title,
            hasCode: true,
            hasNotes: existsSync(join(latexDir, latexDirFor(name))),
            assignmentCount,
            sourceUrl: `${ACADEMIA_REPO}/tree/main/src/${name}`,
          });
          deptsSeen.add(parts.dept);
        }
      }

      // Pass 2: notes-only courses from latex/ (dept-deduped against pass 1).
      if (existsSync(latexDir)) {
        for (const dirName of listDirNames(latexDir)) {
          const parts = parseCourseSlug(slugFromLatexDir(dirName));
          if (!parts) continue; // not a course dir (assets, teach) — skip silently
          if (entries.has(parts.slug)) continue; // already merged from src (hasNotes set there)
          if (deptsSeen.has(parts.dept)) continue; // a component of an existing course, not a new one
          entries.set(parts.slug, {
            slug: parts.slug,
            code: parts.code,
            dept: parts.dept,
            number: parts.number,
            title: parts.title,
            hasCode: false,
            hasNotes: true,
            assignmentCount: 0,
            sourceUrl: `${ACADEMIA_REPO}/tree/main/latex/${dirName}`,
          });
          deptsSeen.add(parts.dept);
        }
      }

      if (entries.size === 0) {
        failLoud(COURSES_SOURCE, 'no course directories matched under src/ or latex/');
        return;
      }

      for (const [slug, data] of entries) {
        const filePath = data.hasCode ? `src/${slug}` : `latex/${latexDirFor(slug)}`;
        const validated = await parseData({ id: slug, data, filePath });
        store.set({ id: slug, data: validated, digest: generateDigest(data) });
      }
      logger.info(`loaded ${entries.size} course(s) from ${root}`);
    },
  };
}
