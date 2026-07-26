import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  parseToolDir,
  stripSubsectionTable,
  detectLanguage,
  binToolsLoader,
  wrapProseTables,
} from '../src/loaders/bin-tools';
import { report } from '../src/loaders/lib/report';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const POCKETCASTS_README = readFileSync(
  join(REPO_ROOT, 'test/fixtures/bin/pocketcasts-reset-README.md'),
  'utf8',
);

// An options table that is NOT nested under "## Usage" (it lives under a
// "### Options" inside "## How it works"): options[] is initially parseable,
// but the table cannot be isolated from Usage, so the loader must DROP the
// styled table, render How-it-works (with the table) as-is, and warn.
const DROP_README = [
  '# drop-tool',
  '',
  'Does a thing.',
  '',
  '## Usage',
  '',
  'Run it like this.',
  '',
  '## How it works',
  '',
  'Here are the flags it accepts:',
  '',
  '### Options',
  '',
  '| Flag | Description |',
  '| ---- | ----------- |',
  '| `--verbose` | Print more output. |',
  '',
].join('\n');

// binToolsLoader() calls report.count('tools', ...), which writes a small
// JSON file under COUNTS_DIR (src/data/generated/counts/ by default -- see
// report.ts). Point it at a scratch directory for the whole file so this
// suite never overwrites the real, gitignored counts a genuine `astro build`
// produced (the same footgun class build-themes.test.mjs had before Task 15).
let countsDir: string;

beforeAll(() => {
  countsDir = mkdtempSync(join(tmpdir(), 'bin-loader-counts-'));
  process.env.COUNTS_DIR = countsDir;
});

afterAll(() => {
  delete process.env.COUNTS_DIR;
  rmSync(countsDir, { recursive: true, force: true });
});

afterEach(() => {
  // The loader emits warnings through the shared report module; drain them so
  // one test's warnings never leak into another's assertions.
  report.flush();
  delete process.env.GITHUB_ACTIONS;
});

// ---------------------------------------------------------------------------
// detectLanguage -- file-extension -> language, else undefined
// ---------------------------------------------------------------------------
describe('detectLanguage', () => {
  it('maps .py to Python', () => {
    expect(detectLanguage(['pocketcasts_reset.py', 'test_pocketcasts_reset.py', 'README.md'])).toBe(
      'Python',
    );
  });

  it('maps .sh and .zsh to Shell', () => {
    expect(detectLanguage(['backup.sh'])).toBe('Shell');
    expect(detectLanguage(['prompt.zsh'])).toBe('Shell');
  });

  it('maps .rs to Rust', () => {
    expect(detectLanguage(['main.rs', 'Cargo.toml'])).toBe('Rust');
  });

  it('returns undefined when no known source extension is present', () => {
    expect(detectLanguage(['README.md', 'notes.txt', 'data.json'])).toBeUndefined();
    expect(detectLanguage([])).toBeUndefined();
  });

  it('picks the language with the most files, tie-breaking by priority', () => {
    // Shell dominates by count.
    expect(detectLanguage(['a.sh', 'b.sh', 'main.py'])).toBe('Shell');
    // A 1-1 tie resolves to the higher-priority language (Python).
    expect(detectLanguage(['one.py', 'two.rs'])).toBe('Python');
  });
});

// ---------------------------------------------------------------------------
// stripSubsectionTable -- both paths of the options-table removal
// ---------------------------------------------------------------------------
describe('stripSubsectionTable', () => {
  it('removes an "### Options" heading and its table (removal succeeds path)', () => {
    const md = [
      'Run it like this.',
      '',
      '```bash',
      'tool --dry-run',
      '```',
      '',
      '### Options',
      '',
      '| Flag | Description |',
      '| ---- | ----------- |',
      '| `--dry-run` | Do nothing. |',
      '',
      '### After',
      '',
      'Trailing prose.',
      '',
    ].join('\n');

    const { text, removed } = stripSubsectionTable(md, 'options');
    expect(removed).toBe(true);
    expect(text).not.toContain('### Options');
    expect(text).not.toContain('| Flag | Description |');
    expect(text).not.toContain('Do nothing.');
    // Content on either side of the removed block survives.
    expect(text).toContain('Run it like this.');
    expect(text).toContain('### After');
    expect(text).toContain('Trailing prose.');
  });

  it('leaves markdown untouched when the heading is absent (fallback path)', () => {
    const md = ['Run it like this.', '', '```bash', 'tool', '```', ''].join('\n');
    const { text, removed } = stripSubsectionTable(md, 'options');
    expect(removed).toBe(false);
    expect(text).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// wrapProseTables -- the overflow-x wrapper div around rendered README tables
// ---------------------------------------------------------------------------
describe('wrapProseTables', () => {
  it('wraps a single table in a .prose-table-wrap div, preserving the table itself', () => {
    const html = '<p>intro</p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>after</p>';
    const wrapped = wrapProseTables(html);

    expect(wrapped).toContain(
      '<div class="prose-table-wrap"><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>',
    );
    // Content on either side of the table is untouched.
    expect(wrapped).toContain('<p>intro</p>');
    expect(wrapped).toContain('<p>after</p>');
  });

  it('wraps a table that carries its own attributes (e.g. a class from a remark plugin)', () => {
    const html = '<table class="gfm-table" data-x="1"><tr><td>1</td></tr></table>';
    const wrapped = wrapProseTables(html);
    expect(wrapped).toBe(
      '<div class="prose-table-wrap"><table class="gfm-table" data-x="1"><tr><td>1</td></tr></table></div>',
    );
  });

  it('wraps multiple tables independently, not greedily across both', () => {
    const html = '<table><tr><td>1</td></tr></table><p>between</p><table><tr><td>2</td></tr></table>';
    const wrapped = wrapProseTables(html);

    expect(wrapped.match(/prose-table-wrap/g)).toHaveLength(2);
    expect(wrapped).toContain('<div class="prose-table-wrap"><table><tr><td>1</td></tr></table></div>');
    expect(wrapped).toContain('<div class="prose-table-wrap"><table><tr><td>2</td></tr></table></div>');
    expect(wrapped).toContain('<p>between</p>');
  });

  it('leaves html without a table byte-for-byte untouched', () => {
    const html = '<p>no tables here</p><pre><code>plain code</code></pre>';
    expect(wrapProseTables(html)).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// parseToolDir -- real fixture + synthetic edge cases
// ---------------------------------------------------------------------------
describe('parseToolDir -- real pocketcasts-reset README', () => {
  const tool = parseToolDir({
    readme: POCKETCASTS_README,
    entries: ['pocketcasts_reset.py', 'test_pocketcasts_reset.py', 'README.md'],
  });

  it('is not skipped (has an H1)', () => {
    expect(tool).not.toBeNull();
  });

  it('reads the name from the H1', () => {
    expect(tool!.name).toBe('pocketcasts-reset');
  });

  it('derives a first-sentence tagline fallback from the intro', () => {
    expect(tool!.tagline).toBe(
      'Unfollow every podcast in your Pocket Casts account in one go, so you can start fresh.',
    );
  });

  it('detects the language from the .py files', () => {
    expect(tool!.language).toBe('Python');
  });

  it('flags stdlib-only from the Requirements section', () => {
    expect(tool!.stdlibOnly).toBe(true);
  });

  it('extracts the license name from the License section link', () => {
    expect(tool!.license).toBe('MIT');
  });

  it('parses all four options with flag + description (removal-succeeds path)', () => {
    expect(tool!.options.map((o) => o.flag)).toEqual([
      '--dry-run',
      '--yes',
      '--email EMAIL',
      '--delay SECONDS',
    ]);
    expect(tool!.options[0].description).toContain('List what would be unfollowed');
    expect(tool!.optionsDropped).toBe(false);
  });

  it('strips the options table out of the rendered Usage markdown (no duplication)', () => {
    expect(tool!.sections.usage).toBeDefined();
    expect(tool!.sections.usage).not.toContain('### Options');
    expect(tool!.sections.usage).not.toContain('Skip the confirmation prompt');
    expect(tool!.sections.usage).not.toContain('| Flag | Description |');
    // The rest of Usage (Credentials H3, the two command blocks) is preserved.
    expect(tool!.sections.usage).toContain('### Credentials');
    expect(tool!.sections.usage).toContain('POCKETCASTS_EMAIL');
  });

  it('keeps How it works and Caveats as present sections; Requirements too', () => {
    expect(tool!.sections.howItWorks).toContain('/user/login');
    expect(tool!.sections.caveats).toContain('unofficial');
    expect(tool!.sections.requirements).toContain('standard library only');
  });
});

describe('parseToolDir -- synthetic edge cases', () => {
  it('returns null when the README has no H1 (malformed -> skip)', () => {
    const md = ['No title here.', '', '## Usage', '', 'Run it.', ''].join('\n');
    expect(parseToolDir({ readme: md, entries: ['x.py'] })).toBeNull();
  });

  it('renders a no-options tool without an options table or drop warning', () => {
    const md = [
      '# tiny-tool',
      '',
      'Does one small thing.',
      '',
      '## Usage',
      '',
      'Run it like this.',
      '',
      '## License',
      '',
      '[MIT](LICENSE)',
      '',
    ].join('\n');

    const tool = parseToolDir({ readme: md, entries: ['tiny.sh'] });
    expect(tool).not.toBeNull();
    expect(tool!.options).toEqual([]);
    expect(tool!.optionsDropped).toBe(false);
    expect(tool!.sections.usage).toBe('Run it like this.');
    expect(tool!.language).toBe('Shell');
    expect(tool!.license).toBe('MIT');
    expect(tool!.stdlibOnly).toBe(false);
  });

  it('drops an options table that cannot be isolated from Usage (fallback path)', () => {
    const tool = parseToolDir({ readme: DROP_README, entries: ['drop.py'] });
    expect(tool).not.toBeNull();
    // The table is real (parseable) but not under Usage and not a standalone
    // "## Options" section -> it is dropped rather than risk a double render.
    expect(tool!.optionsDropped).toBe(true);
    expect(tool!.options).toEqual([]);
    // Usage renders untouched...
    expect(tool!.sections.usage).toBe('Run it like this.');
    // ...and the table stays exactly once inside the section it lived in.
    expect(tool!.sections.howItWorks).toContain('### Options');
    expect(tool!.sections.howItWorks).toContain('--verbose');
    expect(tool!.sections.howItWorks).toContain('Print more output');
  });
});

// ---------------------------------------------------------------------------
// binToolsLoader -- enumeration, skip, cross-check, tagline-from-table
// (fake LoaderContext + a temp fixture directory mirroring the bin layout)
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
    set: (entry: StoredEntry) => {
      map.set(entry.id, entry);
      return true;
    },
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
      collection: 'tools',
      store,
      logger,
      meta: new Map(),
      config: {} as never,
      parseData: async ({ data }: { data: Record<string, unknown> }) => data,
      renderMarkdown: async (content: string) => ({ html: `<render>${content}</render>` }),
      generateDigest: (input: Record<string, unknown> | string) =>
        `digest:${typeof input === 'string' ? input.length : 'obj'}`,
    } as never,
  };
}

describe('binToolsLoader', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    // Root the fixture at a `bin`-named dir so the source URL derivation
    // (repo = directory basename) is exercised exactly as it is for .sources/bin.
    parent = mkdtempSync(join(tmpdir(), 'bin-loader-'));
    root = join(parent, 'bin');
    mkdirSync(root);
    // Root README with a Scripts table that lists a real tool AND a phantom
    // one (no directory) to exercise both cross-check directions.
    writeFileSync(
      join(root, 'README.md'),
      [
        '# bin',
        '',
        '## Scripts',
        '',
        '| Script | What it does |',
        '| ------ | ------------ |',
        '| [`pocketcasts-reset`](pocketcasts-reset/) | Unfollow every podcast, table-sourced tagline. |',
        '| [`ghost-tool`](ghost-tool/) | Listed but has no directory. |',
        '',
      ].join('\n'),
    );
    // Real tool, in the table.
    mkdirSync(join(root, 'pocketcasts-reset'));
    writeFileSync(join(root, 'pocketcasts-reset', 'README.md'), POCKETCASTS_README);
    writeFileSync(join(root, 'pocketcasts-reset', 'pocketcasts_reset.py'), '# no execution\n');
    // Valid tool NOT in the table -> "not listed" warning.
    mkdirSync(join(root, 'extra-tool'));
    writeFileSync(
      join(root, 'extra-tool', 'README.md'),
      ['# extra-tool', '', 'An extra thing.', '', '## Usage', '', 'Use it.', ''].join('\n'),
    );
    // Malformed tool (no H1) -> skipped with a warning.
    mkdirSync(join(root, 'broken'));
    writeFileSync(join(root, 'broken', 'README.md'), 'Just prose, no heading.\n');
    // A hidden dir must be ignored entirely.
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'README.md'), '# not a tool\n');
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it('loads valid tools, skips malformed ones, and ignores hidden dirs', async () => {
    const { context, map } = fakeContext();
    await binToolsLoader({ root }).load(context);

    expect(new Set(map.keys())).toEqual(new Set(['pocketcasts-reset', 'extra-tool']));
    expect(map.has('broken')).toBe(false);
    expect(map.has('.git')).toBe(false);
  });

  it('prefers the root Scripts-table tagline over the first-sentence fallback', async () => {
    const { context, map } = fakeContext();
    await binToolsLoader({ root }).load(context);

    expect(map.get('pocketcasts-reset')!.data.tagline).toBe(
      'Unfollow every podcast, table-sourced tagline.',
    );
    // extra-tool is not in the table -> first-sentence fallback.
    expect(map.get('extra-tool')!.data.tagline).toBe('An extra thing.');
  });

  it('renders sections to HTML, populates options, and builds a source URL', async () => {
    const { context, map } = fakeContext();
    await binToolsLoader({ root }).load(context);

    const data = map.get('pocketcasts-reset')!.data as Record<string, any>;
    expect(data.language).toBe('Python');
    expect(data.options).toHaveLength(4);
    expect(data.sections.usage).toContain('<render>');
    expect(data.sourceUrl).toBe(
      'https://github.com/IllyaStarikov/bin/tree/main/pocketcasts-reset',
    );
    expect(map.get('pocketcasts-reset')!.digest).toBeTruthy();
  });

  it('warns for a malformed tool, an unlisted tool, and a phantom table entry', async () => {
    const { context } = fakeContext();
    report.flush();
    await binToolsLoader({ root }).load(context);
    // broken (no H1) + extra-tool (not in table) + ghost-tool (in table, no dir).
    expect(report.flush().warnings).toBe(3);
  });

  it('produces an empty collection and one warning when the root is missing', async () => {
    const { context, map } = fakeContext();
    report.flush();
    await binToolsLoader({ root: join(root, 'does-not-exist') }).load(context);
    expect(map.size).toBe(0);
    expect(report.flush().warnings).toBe(1);
  });
});

describe('binToolsLoader -- `updated` is a git commit date, not the checkout mtime', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'bin-loader-date-'));
    root = join(parent, 'bin');
    mkdirSync(root);
    writeFileSync(
      join(root, 'README.md'),
      [
        '# bin',
        '',
        '## Scripts',
        '',
        '| Script | What it does |',
        '| ------ | ------------ |',
        '| [`dated-tool`](dated-tool/) | Its updated date comes from git. |',
        '',
      ].join('\n'),
    );
    mkdirSync(join(root, 'dated-tool'));
    writeFileSync(
      join(root, 'dated-tool', 'README.md'),
      ['# dated-tool', '', 'A tool.', '', '## Usage', '', 'Use it.', ''].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it('uses the injected git-date reader (last commit that touched the tool dir)', async () => {
    const { context, map } = fakeContext();
    const seen: Array<[string, string]> = [];
    // The CI `bin` checkout carries real git history; the loader reads the last
    // commit date for each tool DIR. Inject a deterministic reader so the test
    // never depends on a real repo.
    const readGitDate = (repoRoot: string, relPath: string): string | undefined => {
      seen.push([repoRoot, relPath]);
      return '2025-03-14T10:00:00-05:00';
    };
    await binToolsLoader({ root, readGitDate }).load(context);

    expect(map.get('dated-tool')!.data.updated).toBe('2025-03-14T10:00:00-05:00');
    // It asked git about THIS tool's directory (slug), rooted at the checkout.
    expect(seen).toContainEqual([root, 'dated-tool']);
  });

  it('falls back to the file mtime when git has no date (a fresh, untracked copy)', async () => {
    const { context, map } = fakeContext();
    // A local rsync copy of `bin` has no .git; `git log -- <path>` returns
    // nothing there, so the reader yields undefined and the loader must fall
    // back to the README mtime (still an ISO string, just not the git date).
    const readGitDate = (): string | undefined => undefined;
    await binToolsLoader({ root, readGitDate }).load(context);

    const updated = map.get('dated-tool')!.data.updated as string | undefined;
    expect(updated).toBeTruthy();
    expect(() => new Date(updated as string).toISOString()).not.toThrow();
    expect(Number.isNaN(new Date(updated as string).getTime())).toBe(false);
  });
});

describe('binToolsLoader -- optionsDropped fallback consequence', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'bin-loader-drop-'));
    root = join(parent, 'bin');
    mkdirSync(root);
    // drop-tool IS listed in the Scripts table, so its ONLY warning is the
    // options-drop warning -- the count then proves that warning specifically.
    writeFileSync(
      join(root, 'README.md'),
      [
        '# bin',
        '',
        '## Scripts',
        '',
        '| Script | What it does |',
        '| ------ | ------------ |',
        '| [`drop-tool`](drop-tool/) | Table lives outside Usage. |',
        '',
      ].join('\n'),
    );
    mkdirSync(join(root, 'drop-tool'));
    writeFileSync(join(root, 'drop-tool', 'README.md'), DROP_README);
    writeFileSync(join(root, 'drop-tool', 'drop.py'), '# no execution\n');
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it('stores empty options, renders the section as-is, and emits exactly one warning', async () => {
    const { context, map } = fakeContext();
    report.flush();
    await binToolsLoader({ root }).load(context);

    const data = map.get('drop-tool')!.data as Record<string, any>;
    // Styled OPTIONS table is skipped (options empty)...
    expect(data.options).toEqual([]);
    // ...while the flag table is still rendered once inside its own section.
    expect(data.sections.howItWorks).toContain('<render>');
    expect(data.sections.howItWorks).toContain('--verbose');
    expect(data.sections.usage).toContain('Run it like this.');
    // The one warning is the drop warning (drop-tool is listed, so no others).
    expect(report.flush().warnings).toBe(1);
  });
});

describe('binToolsLoader -- rendered sections get the prose-table-wrap treatment', () => {
  let parent: string;
  let root: string;

  beforeAll(() => {
    // fakeContext()'s renderMarkdown is a dumb echo (`<render>${content}</render>`),
    // not a real markdown-to-HTML pass -- so a raw HTML table embedded directly
    // in the "How it works" markdown (valid CommonMark: an HTML block passes
    // through untouched) survives into the echoed string exactly as written,
    // letting this test prove render()'s wiring of wrapProseTables() over the
    // ACTUAL loader code path, not just the pure function in isolation above.
    parent = mkdtempSync(join(tmpdir(), 'bin-loader-table-'));
    root = join(parent, 'bin');
    mkdirSync(root);
    writeFileSync(
      join(root, 'README.md'),
      [
        '# bin',
        '',
        '## Scripts',
        '',
        '| Script | What it does |',
        '| ------ | ------------ |',
        '| [`table-tool`](table-tool/) | Has a table in How it works. |',
        '',
      ].join('\n'),
    );
    mkdirSync(join(root, 'table-tool'));
    writeFileSync(
      join(root, 'table-tool', 'README.md'),
      [
        '# table-tool',
        '',
        'Does a thing with steps.',
        '',
        '## How it works',
        '',
        '<table><thead><tr><th>Step</th><th>What happens</th></tr></thead><tbody><tr><td>1</td><td>Reads config</td></tr></tbody></table>',
        '',
      ].join('\n'),
    );
    writeFileSync(join(root, 'table-tool', 'table_tool.py'), '# no execution\n');
  });

  afterAll(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it('wraps the How-it-works table in .prose-table-wrap in the stored HTML', async () => {
    const { context, map } = fakeContext();
    await binToolsLoader({ root }).load(context);

    const data = map.get('table-tool')!.data as Record<string, any>;
    expect(data.sections.howItWorks).toContain('<div class="prose-table-wrap"><table>');
    expect(data.sections.howItWorks).toContain('</table></div>');
    expect(data.sections.howItWorks).toContain('Reads config');
  });
});
