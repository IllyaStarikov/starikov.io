/*
 * Shared markdown README parser for content loaders (Task 9's bin loader,
 * Task 10's academia loader, and beyond). Each of those loaders reads a
 * README.md out of a synced source repo and needs three things out of it: a
 * title, a short blurb, the body split into named H2 sections, and any pipe
 * tables (flag references, endpoint lists, etc.) paired with whichever
 * heading they actually belong to.
 *
 * Design
 * ------
 * - `sections`/`intro` are raw *slices of the original source text*, sliced
 *   using remark's character offsets, not a re-serialization of the AST.
 *   That's simpler and byte-faithful: code fences, list markers, nested
 *   headings and table pipes all survive exactly as written. The brief notes
 *   these are returned as markdown strings (not HTML) -- rendering happens
 *   later in the loaders via Astro's own markdown renderer.
 * - A "section" is delimited by top-level (depth-2) headings only, so an H3
 *   living under an H2 -- e.g. pocketcasts-reset's "### Credentials" and
 *   "### Options" under "## Usage" -- stays folded into that H2's section
 *   text rather than becoming its own top-level section.
 * - `tables[].heading` is each table's *nearest preceding heading of any
 *   depth*, found by walking every heading and every table (recursively,
 *   wherever they live in the tree) and comparing source offsets. This is
 *   why the Options table -- nested three levels under Usage -- is reported
 *   under "Options", not "Usage": that's the heading actually sitting next
 *   to it.
 * - Table cells and heading text are flattened to *plain text*: markdown
 *   decoration (code ticks, emphasis markers, link syntax) is stripped and
 *   leaf text is concatenated. These are consumed as structured data (flag
 *   names, taglines, step names) rather than rendered prose, so decoration
 *   would just be noise a loader has to strip back out itself.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Heading, Root, Table } from 'mdast';

export interface ParsedReadme {
  h1: string | null;
  /** Markdown before the first H2 (the H1 line itself, if any, is excluded). */
  intro: string;
  /** H2 heading text (lowercased, trimmed) -> markdown for that section, including any nested H3s. */
  sections: Record<string, string>;
  /** Every pipe table in the document, paired with its nearest preceding heading. */
  tables: { heading: string; rows: string[][] }[];
}

function parseTree(md: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
}

/**
 * Flattens any mdast node to plain text: literal `value`s are concatenated
 * depth-first, and every other kind of decoration (emphasis, code ticks,
 * link syntax, ...) is dropped. Typed `unknown` rather than a hand-rolled
 * "any mdast node" interface -- mdast has no single type that spans every
 * node kind (a TableCell isn't part of the RootContent union, for example),
 * and a real recursive visitor is overkill for two tiny read-only walks.
 */
function textContent(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const { value, children } = node as { value?: unknown; children?: unknown[] };
  if (typeof value === 'string') return value;
  if (Array.isArray(children)) return children.map(textContent).join('');
  return '';
}

/** Recursively collects every node of the given mdast `type`, anywhere in the tree. */
function collectByType(node: unknown, type: string, acc: unknown[] = []): unknown[] {
  if (!node || typeof node !== 'object') return acc;
  const n = node as { type?: string; children?: unknown[] };
  if (n.type === type) acc.push(node);
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectByType(child, type, acc);
  }
  return acc;
}

/** Character offset of a node's start/end in the original source (0 if remark somehow omitted position). */
function offsetOf(
  node: { position?: { start: { offset?: number }; end: { offset?: number } } },
  edge: 'start' | 'end',
): number {
  return node.position?.[edge].offset ?? 0;
}

export function parseReadme(md: string): ParsedReadme {
  const tree = parseTree(md);
  const topLevel = tree.children;

  const h1Node = topLevel.find((n): n is Heading => n.type === 'heading' && n.depth === 1) ?? null;
  const h1 = h1Node ? textContent(h1Node).trim() : null;

  const h2Nodes = topLevel.filter((n): n is Heading => n.type === 'heading' && n.depth === 2);

  const introStart = h1Node ? offsetOf(h1Node, 'end') : 0;
  const introEnd = h2Nodes.length > 0 ? offsetOf(h2Nodes[0], 'start') : md.length;
  const intro = md.slice(introStart, introEnd).trim();

  const sections: Record<string, string> = {};
  h2Nodes.forEach((h2, i) => {
    const start = offsetOf(h2, 'end');
    const end = i + 1 < h2Nodes.length ? offsetOf(h2Nodes[i + 1], 'start') : md.length;
    const key = textContent(h2).trim().toLowerCase();
    sections[key] = md.slice(start, end).trim();
  });

  // Nearest-heading lookup for tables: every heading anywhere in the tree
  // (any depth), in document order.
  const allHeadings = (collectByType(tree, 'heading') as Heading[]).sort(
    (a, b) => offsetOf(a, 'start') - offsetOf(b, 'start'),
  );
  // Every table anywhere in the tree, not just top-level (a table can live
  // inside a nested section without being a section boundary itself).
  const allTables = collectByType(tree, 'table') as Table[];

  const tables = allTables.map((table) => {
    const tableStart = offsetOf(table, 'start');
    let heading = '';
    for (const h of allHeadings) {
      if (offsetOf(h, 'start') < tableStart) heading = textContent(h).trim();
      else break;
    }
    // First row is the header; callers get the data rows only.
    const rows = table.children
      .slice(1)
      .map((row) => row.children.map((cell) => textContent(cell).trim()));
    return { heading, rows };
  });

  return { h1, intro, sections, tables };
}

/**
 * Parses the bin repo's root README "## Scripts" table -- rows like
 * `| [`pocketcasts-reset`](pocketcasts-reset/) | Unfollow every podcast... |`
 * -- into {name, tagline} pairs. `name` is the plain link text (the script's
 * directory name); `tagline` is the plain description cell.
 */
export function parseScriptsTable(md: string): { name: string; tagline: string }[] {
  const { tables } = parseReadme(md);
  const scripts = tables.find((t) => t.heading.toLowerCase() === 'scripts');
  if (!scripts) return [];
  return scripts.rows
    .filter((row) => row.length >= 2)
    .map(([name, tagline]) => ({ name, tagline }));
}
