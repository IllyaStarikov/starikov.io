import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseReadme, parseScriptsTable } from '../src/loaders/lib/markdown-tables';
import { report } from '../src/loaders/lib/report';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const POCKETCASTS_README = readFileSync(
  join(REPO_ROOT, 'test/fixtures/bin/pocketcasts-reset-README.md'),
  'utf8',
);
const ROOT_README = readFileSync(join(REPO_ROOT, 'test/fixtures/bin/root-README.md'), 'utf8');

describe('parseReadme -- real pocketcasts-reset README (.sources/bin/pocketcasts-reset/README.md)', () => {
  const parsed = parseReadme(POCKETCASTS_README);

  it('extracts the H1 title', () => {
    expect(parsed.h1).toBe('pocketcasts-reset');
  });

  it('extracts a non-empty intro (markdown before the first H2, excluding the H1 line)', () => {
    expect(parsed.intro.length).toBeGreaterThan(0);
    expect(parsed.intro).toContain('Unfollow **every** podcast');
    expect(parsed.intro).not.toContain('# pocketcasts-reset');
  });

  it('keys sections by lowercased/trimmed H2 text', () => {
    expect(Object.keys(parsed.sections)).toEqual([
      'requirements',
      'usage',
      'how it works',
      'caveats',
      'license',
    ]);
  });

  it('includes nested H3 content (Credentials, Options) inside the Usage section', () => {
    expect(parsed.sections.usage).toContain('### Credentials');
    expect(parsed.sections.usage).toContain('### Options');
    expect(parsed.sections.usage).toContain('POCKETCASTS_EMAIL');
  });

  it('has a non-empty license section', () => {
    expect(parsed.sections.license).toContain('MIT');
  });

  it('finds the Options table (nested under Usage as an H3) keyed by its own heading', () => {
    const options = parsed.tables.find((t) => t.heading === 'Options');
    expect(options).toBeDefined();
    expect(options?.rows).toHaveLength(4);
    expect(options?.rows.map((r) => r[0])).toEqual([
      '--dry-run',
      '--yes',
      '--email EMAIL',
      '--delay SECONDS',
    ]);
  });

  it('finds the "How it works" endpoint table keyed by its H2', () => {
    const howItWorks = parsed.tables.find((t) => t.heading === 'How it works');
    expect(howItWorks).toBeDefined();
    expect(howItWorks?.rows).toHaveLength(3);
    expect(howItWorks?.rows.map((r) => r[0])).toEqual(['Log in', 'List', 'Unfollow']);
    expect(howItWorks?.rows[0][1]).toContain('/user/login');
  });

  it('finds exactly two tables in the document', () => {
    expect(parsed.tables).toHaveLength(2);
  });
});

describe('parseReadme -- synthetic edge cases', () => {
  it('returns no tables when the README has none (e.g. no Options section)', () => {
    const md = [
      '# my-tool',
      '',
      'Some intro text.',
      '',
      '## Usage',
      '',
      'Run it like this.',
      '',
      '## License',
      '',
      'MIT',
      '',
    ].join('\n');

    const parsed = parseReadme(md);
    expect(parsed.tables).toEqual([]);
    expect(parsed.sections.usage).toBe('Run it like this.');
  });

  it('returns h1 null when the README has no H1', () => {
    const md = [
      'Intro paragraph without any h1 heading.',
      '',
      '## Section One',
      '',
      'Content here.',
      '',
    ].join('\n');

    const parsed = parseReadme(md);
    expect(parsed.h1).toBeNull();
    expect(parsed.intro).toBe('Intro paragraph without any h1 heading.');
    expect(parsed.sections['section one']).toBe('Content here.');
  });
});

describe('parseScriptsTable -- real bin root README (.sources/bin/README.md)', () => {
  it('extracts {name, tagline} pairs from the "## Scripts" table', () => {
    expect(parseScriptsTable(ROOT_README)).toEqual([
      {
        name: 'pocketcasts-reset',
        tagline: 'Unfollow every podcast in your Pocket Casts account, to start fresh.',
      },
    ]);
  });

  it('returns [] when there is no Scripts table', () => {
    const md = ['# bin', '', 'No scripts yet.', '', '## License', '', 'MIT', ''].join('\n');
    expect(parseScriptsTable(md)).toEqual([]);
  });
});

describe('report', () => {
  afterEach(() => {
    report.flush();
    delete process.env.GITHUB_ACTIONS;
  });

  it('counts warnings and errors, and flush() drains them back to zero', () => {
    report.warn('bin', 'missing tagline');
    report.warn('bin', 'missing tagline (again)');
    report.error('bin', 'bad frontmatter');

    expect(report.flush()).toEqual({ warnings: 2, errors: 1 });
    expect(report.flush()).toEqual({ warnings: 0, errors: 0 });
  });

  it('works in both the local (plain console) and CI (annotation) branches', () => {
    delete process.env.GITHUB_ACTIONS;
    expect(() => report.warn('bin', 'local branch')).not.toThrow();

    process.env.GITHUB_ACTIONS = 'true';
    expect(() => report.error('bin', 'ci branch')).not.toThrow();

    expect(report.flush()).toEqual({ warnings: 1, errors: 1 });
  });
});
