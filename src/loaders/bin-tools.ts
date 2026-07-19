/*
 * bin-tools -- the auto-generated /bin collection loader.
 *
 * Reads a checkout of the `bin` repo (`.sources/bin`, synced by
 * scripts/sync-sources.sh / the CI checkout) and turns every tool directory
 * that carries a README.md into one `tools` collection entry. This is the
 * site's zero-effort content contract in action: a new directory + README in
 * the bin repo becomes a full /bin/<tool> page, a sidebar entry, a ledger row,
 * a search hit and an RSS item with no code change here.
 *
 * **This loader never executes any tool code.** It only reads text files
 * (READMEs) and enumerates filenames (for language detection). The scripts
 * themselves (`*.py`, `*.sh`, ...) are opened by nobody.
 *
 * Split of responsibilities:
 *   - `parseToolDir` / `stripSubsectionTable` / `detectLanguage` are PURE:
 *     given a README string (+ a flat list of filenames) they compute the tool
 *     structure with zero IO and zero Astro context, which is what the unit
 *     tests exercise directly.
 *   - `binToolsLoader().load()` is the thin Astro shell around them: it walks
 *     the filesystem, renders each markdown section to HTML via the loader
 *     context's `renderMarkdown` (at load time -- the pages just `set:html`),
 *     resolves taglines against the root Scripts table, cross-checks the table
 *     against the directories, and writes entries into the content store.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Heading, Table } from 'mdast';
import type { Loader } from 'astro/loaders';
import { parseReadme, parseScriptsTable } from './lib/markdown-tables';
import { report } from './lib/report';
import { GITHUB_URL } from '../lib/nav';

const SOURCE = 'bin-tools';

// --------------------------------------------------------------------------
// Language detection
// --------------------------------------------------------------------------

/** File extension -> display language. Anything else contributes no signal. */
const LANG_BY_EXT: Record<string, string> = {
  '.py': 'Python',
  '.sh': 'Shell',
  '.zsh': 'Shell',
  '.rs': 'Rust',
};

/** Tie-break order when two languages appear the same number of times. */
const LANG_PRIORITY = ['Python', 'Shell', 'Rust'];

/**
 * Language of a tool from the extensions of the files in its directory:
 * whichever known language has the most files wins, ties resolving to the
 * higher-priority language. `undefined` when no file carries a known source
 * extension (the page then omits the language fact entirely).
 */
export function detectLanguage(entries: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const lang = LANG_BY_EXT[extname(entry).toLowerCase()];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const lang of LANG_PRIORITY) {
    const count = counts.get(lang) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = lang;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Options-table removal (so options render exactly once, styled)
// --------------------------------------------------------------------------

function parseTree(md: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const { value, children } = node as { value?: unknown; children?: unknown[] };
  if (typeof value === 'string') return value;
  if (Array.isArray(children)) return children.map(nodeText).join('');
  return '';
}

function offset(
  node: { position?: { start: { offset?: number }; end: { offset?: number } } },
  edge: 'start' | 'end',
): number | undefined {
  return node.position?.[edge].offset;
}

/**
 * Removes a subsection consisting of a heading (of any depth, matched by its
 * lowercased text) plus the first table that follows it, returned as a new
 * string. This is how the `### Options` heading + its flag table get lifted
 * out of the Usage markdown BEFORE it is rendered, so the styled OPTIONS table
 * on the page is the single place those flags appear.
 *
 * Removal is a pure string-offset splice using remark's character offsets, so
 * everything on either side of the block (code fences, other H3s, prose)
 * survives byte-for-byte. When the heading isn't present, or has no table
 * after it, or remark somehow omits offsets, it returns the input unchanged
 * with `removed:false` -- the caller's documented fallback (render as-is, skip
 * the styled table) that guarantees the flags are never shown twice.
 */
export function stripSubsectionTable(
  md: string,
  headingText: string,
): { text: string; removed: boolean } {
  const target = headingText.trim().toLowerCase();
  const tree = parseTree(md);
  const nodes = tree.children;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.type !== 'heading') continue;
    if (nodeText(node as Heading).trim().toLowerCase() !== target) continue;

    // Find the first table after this heading (skipping intervening prose is
    // not expected under a flag heading, but tolerated).
    let table: Table | undefined;
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (nodes[j].type === 'table') {
        table = nodes[j] as Table;
        break;
      }
      // Stop at the next heading: the table must belong to THIS subsection.
      if (nodes[j].type === 'heading') break;
    }
    if (!table) break;

    const start = offset(node as Heading, 'start');
    const end = offset(table, 'end');
    if (start === undefined || end === undefined) break;

    const text = (md.slice(0, start) + md.slice(end)).replace(/\n{3,}/g, '\n\n').trim();
    return { text, removed: true };
  }

  return { text: md, removed: false };
}

// --------------------------------------------------------------------------
// Small pure extractors
// --------------------------------------------------------------------------

/** Plain-text first sentence of some markdown -- the tagline fallback. */
function firstSentence(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(/^(.*?[.!?])(\s|$)/);
  return (match ? match[1] : text).trim();
}

/** License name from a License section: `[MIT](../LICENSE)` -> `MIT`. */
function extractLicense(md: string | undefined): string | undefined {
  if (!md) return undefined;
  const link = md.match(/\[([^\]]+)\]/);
  if (link) return link[1].trim();
  const first = md.trim().split(/\s+/)[0];
  return first || undefined;
}

/** True when the Requirements section says the tool needs no dependencies. */
function detectStdlibOnly(md: string | undefined): boolean {
  if (!md) return false;
  return /standard library only|std(?:lib|-?library)[- ]?only|no (?:external )?dependencies|nothing to (?:`?pip install`?|install)/i.test(
    md,
  );
}

// --------------------------------------------------------------------------
// parseToolDir -- the pure heart of the loader
// --------------------------------------------------------------------------

export interface ToolOption {
  flag: string;
  description: string;
}

export interface ParsedTool {
  /** H1 text -- the command name / slug title. */
  name: string;
  /** First-sentence fallback tagline; the loader overrides this with the root
   *  Scripts-table description when the tool is listed there. */
  tagline: string;
  /** Intro markdown (before the first H2) -- the lead description prose. */
  description: string;
  language?: string;
  /** Section MARKDOWN (rendered to HTML by the loader). Usage has its nested
   *  options table stripped out when that table could be safely isolated. */
  sections: {
    requirements?: string;
    usage?: string;
    howItWorks?: string;
    caveats?: string;
  };
  options: ToolOption[];
  stdlibOnly: boolean;
  license?: string;
  /** An options table existed but could not be isolated from Usage, so it was
   *  dropped rather than rendered twice. The loader turns this into a warning. */
  optionsDropped: boolean;
}

/**
 * Parses one tool directory's README (+ its filenames) into a ParsedTool, or
 * `null` when the README has no H1 (malformed -- the loader skips + warns).
 * Pure: no IO, no Astro context, no markdown->HTML rendering.
 */
export function parseToolDir(files: { readme: string; entries: string[] }): ParsedTool | null {
  const parsed = parseReadme(files.readme);
  if (!parsed.h1) return null;

  const s = parsed.sections;
  const requirements = s['requirements'];
  let usage = s['usage'];
  const howItWorks = s['how it works'];
  const caveats = s['caveats'];

  // Options come from the table whose heading (case-insensitively) is "options".
  const optionsTable = parsed.tables.find((t) => t.heading.toLowerCase() === 'options');
  let options: ToolOption[] = [];
  let optionsDropped = false;

  if (optionsTable) {
    const parsedOptions = optionsTable.rows
      .filter((row) => row.length >= 2)
      .map(([flag, description]) => ({ flag: flag.trim(), description: description.trim() }));

    if (usage) {
      const stripped = stripSubsectionTable(usage, 'options');
      if (stripped.removed) {
        // The table lived under Usage and was lifted out: render it styled.
        usage = stripped.text;
        options = parsedOptions;
      } else if (s['options']) {
        // A standalone "## Options" section: not inside Usage, and we never
        // render an "options" section as prose, so the styled table is safe.
        options = parsedOptions;
      } else if (parsedOptions.length > 0) {
        // The table is somewhere inside a rendered section but could not be
        // isolated -- drop the styled table so the flags are not shown twice.
        optionsDropped = true;
      }
    } else {
      options = parsedOptions;
    }
  }

  return {
    name: parsed.h1,
    tagline: firstSentence(parsed.intro),
    description: parsed.intro,
    language: detectLanguage(files.entries),
    sections: { requirements, usage, howItWorks, caveats },
    options,
    stdlibOnly: detectStdlibOnly(requirements),
    license: extractLicense(s['license']),
    optionsDropped,
  };
}

// --------------------------------------------------------------------------
// The Astro loader
// --------------------------------------------------------------------------

function safeMtime(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** Reads the date of the last commit that touched `relPath` inside the git
 *  checkout at `repoRoot`, as a strict-ISO string (`%aI`). */
export type GitDateReader = (repoRoot: string, relPath: string) => string | undefined;

/**
 * Default `updated` source: the last commit date for a tool's directory, read
 * from the `bin` checkout's own git history. This is `git log` on a repo WE
 * cloned (metadata, never tool code) -- allowed, and the reason a tool's
 * "updated N days ago" is the real authoring date, not the meaningless checkout
 * mtime a fresh CI clone stamps on every file (Task 9 carried finding). In CI
 * the `bin` repo is a full `actions/checkout`, so `.git` is present; a local
 * rsync copy has no `.git` and `git log -- <path>` returns nothing there, so the
 * loader falls back to the file mtime. Guarded end-to-end: any failure yields
 * `undefined` and the mtime takes over.
 */
export const gitLastCommitDate: GitDateReader = (repoRoot, relPath) => {
  try {
    return (
      execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%aI', '--', relPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
};

/**
 * Object loader for the `tools` collection. `root` is the bin checkout
 * (`.sources/bin`); its basename names the GitHub repo the source links point
 * at. When the checkout is missing (a fresh clone before sync-sources runs)
 * the loader logs exactly one warning and produces an empty collection so the
 * build still succeeds -- Task 15's `tools >= 1` min-count gate is what fails
 * CI on an empty /bin, not the loader.
 */
export function binToolsLoader({
  root,
  readGitDate = gitLastCommitDate,
}: {
  root: string;
  /** Injectable for tests; defaults to reading the `bin` checkout's git log. */
  readGitDate?: GitDateReader;
}): Loader {
  const repoBase = `${GITHUB_URL}/${basename(root)}`;

  return {
    name: SOURCE,
    async load({ store, parseData, generateDigest, renderMarkdown, logger }) {
      store.clear();

      const absRoot = resolve(root);
      if (!existsSync(absRoot)) {
        report.warn(
          SOURCE,
          `source not found at ${root}; /bin will be empty (the tools >= 1 min-count gate enforces content in CI)`,
        );
        // Explicit zero + provenance note (Task 15 code-review fix): without
        // this, an early return here never calls report.count() at all,
        // leaving whatever a PREVIOUS build's tools.json said -- see
        // scripts/lib/counts-integration.mjs's clearCounts() module doc for
        // the reproduced failure this closes.
        report.count('tools', 0, [], `source checkout not found at ${root}`);
        logger.warn(`${root} missing; /bin collection is empty`);
        return;
      }

      // Root Scripts table -> canonical tagline per tool + cross-check set.
      const taglineByName = new Map<string, string>();
      const rootReadme = join(absRoot, 'README.md');
      if (existsSync(rootReadme)) {
        for (const { name, tagline } of parseScriptsTable(readFileSync(rootReadme, 'utf8'))) {
          taglineByName.set(name, tagline);
        }
      }

      const toolDirs = readdirSync(absRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .filter((name) => existsSync(join(absRoot, name, 'README.md')))
        .sort();

      const render = async (md: string | undefined): Promise<string | undefined> =>
        md ? (await renderMarkdown(md)).html : undefined;

      const loaded = new Set<string>();
      for (const slug of toolDirs) {
        const dir = join(absRoot, slug);
        const readmePath = join(dir, 'README.md');
        const readme = readFileSync(readmePath, 'utf8');
        const parsed = parseToolDir({ readme, entries: readdirSync(dir) });

        if (!parsed) {
          report.warn(SOURCE, `${slug}: README.md has no H1 heading; skipping`);
          logger.warn(`${slug}: no H1 heading; skipped`);
          continue;
        }
        if (parsed.optionsDropped) {
          report.warn(
            SOURCE,
            `${slug}: an options table could not be isolated from the Usage section; ` +
              'rendering Usage as-is and omitting the styled OPTIONS table (no duplication)',
          );
        }
        if (!taglineByName.has(slug)) {
          report.warn(SOURCE, `${slug}: not listed in the root README Scripts table`);
        }

        const data = {
          name: parsed.name,
          tagline: taglineByName.get(slug) ?? parsed.tagline,
          description: (await render(parsed.description)) ?? '',
          language: parsed.language,
          sections: {
            requirements: await render(parsed.sections.requirements),
            usage: await render(parsed.sections.usage),
            howItWorks: await render(parsed.sections.howItWorks),
            caveats: await render(parsed.sections.caveats),
          },
          options: parsed.options,
          sourceUrl: `${repoBase}/tree/main/${slug}`,
          license: parsed.license,
          stdlibOnly: parsed.stdlibOnly,
          // Real last-commit date for the tool dir (git), mtime only as a
          // last resort -- see gitLastCommitDate.
          updated: readGitDate(absRoot, slug) ?? safeMtime(readmePath),
        };

        const filePath = relative(process.cwd(), readmePath);
        const validated = await parseData({ id: slug, data, filePath });
        store.set({ id: slug, data: validated, digest: generateDigest(readme), filePath });
        loaded.add(slug);
      }

      // Reverse cross-check: table entries that have no directory.
      for (const name of taglineByName.keys()) {
        if (!loaded.has(name)) {
          report.warn(
            SOURCE,
            `Scripts table lists "${name}" but no matching directory with a README.md was found`,
          );
        }
      }

      // 'tools' (not SOURCE/'bin-tools') -- the counts manifest is keyed by
      // COLLECTION name (content.config.ts), matching what validate-dist.mjs
      // reads it back as.
      report.count('tools', loaded.size, [...loaded].sort());
      logger.info(`loaded ${loaded.size} tool(s) from ${root}`);
    },
  };
}
