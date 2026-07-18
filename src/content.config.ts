/*
 * Content Layer collections (Astro 5). The first collection in the repo:
 * `tools`, generated entirely by the bin loader from READMEs in the bin repo
 * checkout -- zero human-authored files. Later tasks add academiaShowcase,
 * courses, repos, essays, projects, toolOverlays alongside it.
 *
 * The schema is the site's tool content model (design spec section 6): the
 * loader renders every markdown section to HTML at load time, so the string
 * fields below hold ready-to-`set:html` HTML, not markdown. `license`,
 * `stdlibOnly` and `updated` are the extra facts the /bin page's right-rail
 * facts block needs (language + stdlib badge + license + updated).
 */

import { defineCollection, z } from 'astro:content';
import { binToolsLoader } from './loaders/bin-tools';
import { academiaShowcaseLoader, coursesLoader } from './loaders/academia';

const tools = defineCollection({
  loader: binToolsLoader({ root: '.sources/bin' }),
  schema: z.object({
    /** H1 / command name (also the slug via the entry id). */
    name: z.string(),
    /** One-line summary (root Scripts table, else the README's first sentence). */
    tagline: z.string(),
    /** Rendered HTML of the intro prose (the lead description). */
    description: z.string(),
    /** Detected from source file extensions; omitted when unknown. */
    language: z.string().optional(),
    /** Rendered HTML per man-page section; each is absent when not present. */
    sections: z.object({
      requirements: z.string().optional(),
      usage: z.string().optional(),
      howItWorks: z.string().optional(),
      caveats: z.string().optional(),
    }),
    /** Flag reference; empty array renders no OPTIONS table. */
    options: z.array(z.object({ flag: z.string(), description: z.string() })),
    /** GitHub URL of the tool's directory. */
    sourceUrl: z.string().url(),
    /** Facts (right rail). */
    license: z.string().optional(),
    stdlibOnly: z.boolean().default(false),
    updated: z.string().optional(),
  }),
});

// The 14 curated PORTFOLIO.md projects (design §6). `body` is ready-to-`set:html`
// HTML; `media` carries the transcode step's output paths (GIF → looping video,
// PNG → image) under /media/academia/.
const academiaShowcase = defineCollection({
  loader: academiaShowcaseLoader({ root: '.sources/academia' }),
  schema: z.object({
    /** Position in PORTFOLIO.md (1–14); drives stable ordering. */
    order: z.number(),
    title: z.string(),
    /** The `**Path:**` source location, e.g. `src/cs5400-…/game-series/`. */
    srcPath: z.string(),
    /** First path segment after `src/` (a course slug or a project name). */
    courseSlug: z.string().optional(),
    /** Display course code, e.g. `CS 5400`; absent for non-course projects. */
    courseCode: z.string().optional(),
    /** Department code, e.g. `cs5400`; absent for non-course projects. */
    dept: z.string().optional(),
    /** Theme bucket: `ai` | `graphics` | `games` | `systems` (site.config rules). */
    theme: z.string(),
    /** Rendered HTML of the project prose (media/Path/details removed). */
    body: z.string(),
    /** Referenced media as build-time output paths. */
    media: z.array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('video'),
          slug: z.string(),
          alt: z.string(),
          poster: z.string(),
          mp4: z.string(),
          webm: z.string(),
        }),
        z.object({
          kind: z.literal('image'),
          slug: z.string(),
          alt: z.string(),
          src: z.string(),
        }),
      ]),
    ),
  }),
});

// Every `src/<slug>/` course directory in the academia repo (dir enumeration,
// no PORTFOLIO involvement): the course index table on /academia.
const courses = defineCollection({
  loader: coursesLoader({ root: '.sources/academia' }),
  schema: z.object({
    slug: z.string(),
    /** Display code, e.g. `CS 5400`. */
    code: z.string(),
    /** Department code, e.g. `cs5400`. */
    dept: z.string(),
    number: z.string(),
    /** Humanized directory title, e.g. `Artificial Intelligence`. */
    title: z.string(),
    /** True when the course has source code / assignments in `src/`; false for
     *  a notes-only course that exists only in `latex/` (a gen-ed). */
    hasCode: z.boolean(),
    /** True when a matching `latex/<underscored>/` notes directory exists. */
    hasNotes: z.boolean(),
    /** Count of assignment subdirectories (0 for notes-only courses). */
    assignmentCount: z.number(),
    sourceUrl: z.string().url(),
  }),
});

export const collections = { tools, academiaShowcase, courses };
