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

export const collections = { tools };
