import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sumGrepCounts,
  formatLinesLabel,
  countPluginsFromLockData,
  isBinaryChunk,
  countLinesInText,
  validateSnapshotShape,
  readSnapshotMeasured,
} from '../scripts/build-system-stats.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts/build-system-stats.mjs');
const REAL_SNAPSHOT_PATH = join(REPO_ROOT, 'src/data/vendor/system-stats-snapshot.json');

// ---------------------------------------------------------------------------
// Pure helpers -- plain data in, no filesystem/subprocess involved.
// ---------------------------------------------------------------------------

describe('sumGrepCounts (parses `git grep -I --cached -c \'\'` output)', () => {
  it('sums the trailing count off each "path:N" line', () => {
    expect(sumGrepCounts('a.txt:10\nb/c.txt:5\n')).toBe(15);
  });

  it('splits on the LAST colon, so a path containing ":" is not miscounted', () => {
    expect(sumGrepCounts('weird:path:name.txt:7\n')).toBe(7);
  });

  it('ignores blank lines', () => {
    expect(sumGrepCounts('a.txt:3\n\nb.txt:4\n')).toBe(7);
  });

  it('is 0 for empty output', () => {
    expect(sumGrepCounts('')).toBe(0);
  });
});

describe('formatLinesLabel', () => {
  it('formats thousands with one decimal + K, mirroring the site\'s existing "90.8K" style', () => {
    expect(formatLinesLabel(116802)).toBe('116.8K');
    expect(formatLinesLabel(90800)).toBe('90.8K');
    expect(formatLinesLabel(1000)).toBe('1.0K');
  });

  it('prints the plain rounded integer below 1000', () => {
    expect(formatLinesLabel(999)).toBe('999');
    expect(formatLinesLabel(42.4)).toBe('42');
    expect(formatLinesLabel(0)).toBe('0');
  });
});

describe('countPluginsFromLockData', () => {
  it('counts the top-level keys of a lazy-lock.json-shaped object', () => {
    expect(countPluginsFromLockData({ 'plugin-a': {}, 'plugin-b': {} })).toBe(2);
  });

  it('is 0 for an empty object', () => {
    expect(countPluginsFromLockData({})).toBe(0);
  });

  it('throws on a non-object (array, null, primitive)', () => {
    expect(() => countPluginsFromLockData(null)).toThrow();
    expect(() => countPluginsFromLockData([1, 2, 3])).toThrow();
    expect(() => countPluginsFromLockData('nope')).toThrow();
  });
});

describe('isBinaryChunk (git grep -I\'s own NUL-byte heuristic)', () => {
  it('is false for plain text', () => {
    expect(isBinaryChunk(Buffer.from('hello\nworld\n', 'utf8'))).toBe(false);
  });

  it('is true when a NUL byte appears in the first 8KB', () => {
    expect(isBinaryChunk(Buffer.from([104, 105, 0, 106]))).toBe(true);
  });

  it('ignores a NUL byte beyond the first 8KB window', () => {
    const buf = Buffer.concat([Buffer.alloc(8000, 'a'), Buffer.from([0])]);
    expect(isBinaryChunk(buf)).toBe(false);
  });
});

describe('countLinesInText', () => {
  it('counts newline-terminated lines like `wc -l`', () => {
    expect(countLinesInText('a\nb\nc\n')).toBe(3);
  });

  it('still counts a final unterminated line once', () => {
    expect(countLinesInText('a\nb\nc')).toBe(3);
  });

  it('is 0 for an empty file', () => {
    expect(countLinesInText('')).toBe(0);
  });

  it('is 1 for a single line with no trailing newline', () => {
    expect(countLinesInText('one line')).toBe(1);
  });
});

describe('validateSnapshotShape', () => {
  it('accepts and extracts the three counted fields, dropping anything extra (e.g. "measured")', () => {
    expect(
      validateSnapshotShape({ pluginCount: 52, dotfilesFiles: 770, dotfilesLines: 116802, measured: '2026-07-26' }),
    ).toEqual({ pluginCount: 52, dotfilesFiles: 770, dotfilesLines: 116802 });
  });

  it('throws when a required field is missing or not a finite number', () => {
    expect(() => validateSnapshotShape({ dotfilesFiles: 770, dotfilesLines: 1 })).toThrow();
    expect(() => validateSnapshotShape({ pluginCount: '52', dotfilesFiles: 770, dotfilesLines: 1 })).toThrow();
    expect(() => validateSnapshotShape({ pluginCount: NaN, dotfilesFiles: 770, dotfilesLines: 1 })).toThrow();
  });

  it('throws on a non-object', () => {
    expect(() => validateSnapshotShape(null)).toThrow();
    expect(() => validateSnapshotShape('nope')).toThrow();
  });

  it('the COMMITTED snapshot (src/data/vendor/system-stats-snapshot.json) is itself schema-valid', () => {
    const raw = JSON.parse(readFileSync(REAL_SNAPSHOT_PATH, 'utf8'));
    const shape = validateSnapshotShape(raw);
    expect(shape.pluginCount).toBeGreaterThan(0);
    expect(shape.dotfilesFiles).toBeGreaterThan(0);
    expect(shape.dotfilesLines).toBeGreaterThan(0);
    // The snapshot's own honesty contract: a dated provenance field.
    expect(typeof raw.measured).toBe('string');
    expect(raw.measured).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// readSnapshotMeasured -- v1.1 polish Task 6 fix round 1, Finding 2: threads
// the snapshot's own dated provenance through to colophon.astro so the
// Provenance section can say WHEN a fallback number was measured instead of
// falsely calling it "computed fresh at build".
describe('readSnapshotMeasured', () => {
  it('returns the snapshot\'s own "measured" field when present and YYYY-MM-DD-shaped', () => {
    expect(readSnapshotMeasured({ measured: '2026-07-26' })).toBe('2026-07-26');
  });

  it('is null when "measured" is absent (never fabricates a date)', () => {
    expect(readSnapshotMeasured({ pluginCount: 52 })).toBeNull();
  });

  it('is null when "measured" is present but not YYYY-MM-DD-shaped', () => {
    expect(readSnapshotMeasured({ measured: 'yesterday' })).toBeNull();
    expect(readSnapshotMeasured({ measured: 20260726 })).toBeNull();
  });

  it('is null on a non-object input, same as validateSnapshotShape\'s failure mode', () => {
    expect(readSnapshotMeasured(null)).toBeNull();
    expect(readSnapshotMeasured('nope')).toBeNull();
  });

  it('the COMMITTED snapshot\'s own "measured" field round-trips through this function', () => {
    const raw = JSON.parse(readFileSync(REAL_SNAPSHOT_PATH, 'utf8'));
    expect(readSnapshotMeasured(raw)).toBe(raw.measured);
  });
});

// ---------------------------------------------------------------------------
// Full-cascade integration tests -- the real script, run as a subprocess
// (mirrors test/build-themes.test.mjs), against disposable fixture dirs so
// the real .sources/dotfiles / committed snapshot / gitignored output are
// never touched.
// ---------------------------------------------------------------------------

let scratch;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'system-stats-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function outJsonPath(outDir) {
  return join(outDir, 'src/data/generated/system-stats.json');
}

function runScript(env) {
  return execFileSync('node', [SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function writeLockfile(dir, pluginNames) {
  mkdirSync(join(dir, 'src/neovim'), { recursive: true });
  const lock = Object.fromEntries(pluginNames.map((name) => [name, { branch: 'main', commit: 'abc123' }]));
  writeFileSync(join(dir, 'src/neovim/lazy-lock.json'), JSON.stringify(lock));
}

describe('build-system-stats.mjs -- git-database tier (a checkout WITH .git)', () => {
  let dir;
  let outDir;

  beforeAll(() => {
    dir = join(scratch, 'git-checkout');
    outDir = join(scratch, 'git-out');
    mkdirSync(dir, { recursive: true });
    writeLockfile(dir, ['plugin-a', 'plugin-b', 'plugin-c']);
    writeFileSync(join(dir, 'README.md'), 'line one\nline two\nline three\n'); // 3 lines
    writeFileSync(join(dir, 'src/neovim/init.lua'), 'return {}\n'); // 1 line
    // A tracked binary file -- git grep -I must exclude it from the line sum,
    // but it still counts toward the file total (git ls-files doesn't care).
    writeFileSync(join(dir, 'binary.dat'), Buffer.from([1, 2, 0, 3, 4]));

    // -c commit.gpgsign=false: this is a disposable fixture repo created only
    // to exercise `git ls-files`/`git grep` against and deleted in afterAll --
    // not a real commit to real work. Without this override it would inherit
    // this machine's global commit.gpgsign=true and hang the suite waiting on
    // a GPG passphrase for a throwaway temp-dir repo nobody will ever look at.
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };
    execFileSync('git', ['init', '-q'], { cwd: dir, env: gitEnv });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'add', '-A'], { cwd: dir, env: gitEnv });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed'], { cwd: dir, env: gitEnv });
  });

  it('counts files via `git ls-files` and lines via `git grep -I --cached -c \'\'`', () => {
    const stdout = runScript({ SYSTEM_STATS_SOURCE_DIR: dir, SYSTEM_STATS_OUT_DIR: outDir });
    expect(stdout).toContain('source: git');
    const out = JSON.parse(readFileSync(outJsonPath(outDir), 'utf8'));
    expect(out).toEqual({
      pluginCount: 3,
      dotfilesFiles: 4, // README.md, init.lua, binary.dat, lazy-lock.json
      // 3 (README, trailing \n) + 1 (init.lua) + 1 (lazy-lock.json -- no
      // trailing newline, but git grep -c still counts a final unterminated
      // line once, same as countLinesInText); binary.dat excluded via -I.
      dotfilesLines: 5,
      dotfilesLinesLabel: '5',
      source: 'git',
      // A live count has no "measured" date to name -- always null, never
      // omitted (see build-system-stats.mjs's own comment on `out.measured`).
      measured: null,
      generatedAt: expect.any(String),
    });
  });
});

describe('build-system-stats.mjs -- filesystem-walk tier (a checkout with no .git)', () => {
  let dir;
  let outDir;

  beforeAll(() => {
    dir = join(scratch, 'fs-checkout');
    outDir = join(scratch, 'fs-out');
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeLockfile(dir, ['plugin-a', 'plugin-b']); // lazy-lock.json: 1 line, no trailing \n
    writeFileSync(join(dir, 'a.txt'), 'x\ny\n'); // 2 lines
    writeFileSync(join(dir, 'nested/b.txt'), 'one\ntwo\nthree\n'); // 3 lines
    writeFileSync(join(dir, 'photo.bin'), Buffer.from([0xff, 0x00, 0xaa])); // NUL byte -> binary
  });

  it('walks the filesystem, applying the NUL-byte binary heuristic, when no .git is present', () => {
    const stdout = runScript({ SYSTEM_STATS_SOURCE_DIR: dir, SYSTEM_STATS_OUT_DIR: outDir });
    expect(stdout).toContain('source: fs');
    const out = JSON.parse(readFileSync(outJsonPath(outDir), 'utf8'));
    expect(out.source).toBe('fs');
    expect(out.pluginCount).toBe(2);
    expect(out.dotfilesFiles).toBe(4); // lazy-lock.json, a.txt, nested/b.txt, photo.bin
    expect(out.dotfilesLines).toBe(6); // 1 (lock) + 2 (a.txt) + 3 (nested/b.txt); photo.bin excluded
    expect(out.measured).toBeNull(); // a live count, same as the git tier -- no date to name
  });
});

describe('build-system-stats.mjs -- fallback cascade (never hard-fails)', () => {
  it('falls back to the committed snapshot with a warning when the checkout is entirely absent', () => {
    const outDir = join(scratch, 'absent-out');
    const stdout = runScript({
      SYSTEM_STATS_SOURCE_DIR: join(scratch, 'does-not-exist'),
      SYSTEM_STATS_OUT_DIR: outDir,
    });
    expect(stdout).toMatch(/::warning::system-stats:.*no dotfiles checkout/);
    const out = JSON.parse(readFileSync(outJsonPath(outDir), 'utf8'));
    expect(out.source).toBe('snapshot');
    expect(out.pluginCount).toBeGreaterThan(0);
    expect(out.dotfilesFiles).toBeGreaterThan(0);
    // The REAL committed snapshot was read here (no SYSTEM_STATS_SNAPSHOT_PATH
    // override), so its own dated "measured" field should have come through --
    // this is exactly what colophon.astro's dated-snapshot wording names.
    expect(out.measured).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('falls back to the committed snapshot with a warning when a checkout exists but lazy-lock.json is missing', () => {
    const dir = join(scratch, 'no-lockfile');
    const outDir = join(scratch, 'no-lockfile-out');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'README.md'), 'hello\n'); // no .git, no src/neovim/lazy-lock.json

    const stdout = runScript({ SYSTEM_STATS_SOURCE_DIR: dir, SYSTEM_STATS_OUT_DIR: outDir });
    expect(stdout).toMatch(/::warning::system-stats:.*counting against/);
    const out = JSON.parse(readFileSync(outJsonPath(outDir), 'utf8'));
    expect(out.source).toBe('snapshot');
  });

  it('uses an EXPLICIT custom snapshot (SYSTEM_STATS_SNAPSHOT_PATH) when the checkout is absent', () => {
    const snapshotPath = join(scratch, 'custom-snapshot.json');
    writeFileSync(
      snapshotPath,
      JSON.stringify({ pluginCount: 7, dotfilesFiles: 8, dotfilesLines: 9000, measured: '2020-01-01' }),
    );
    const outDir = join(scratch, 'custom-snapshot-out');

    runScript({
      SYSTEM_STATS_SOURCE_DIR: join(scratch, 'still-does-not-exist'),
      SYSTEM_STATS_SNAPSHOT_PATH: snapshotPath,
      SYSTEM_STATS_OUT_DIR: outDir,
    });
    const out = JSON.parse(readFileSync(outJsonPath(outDir), 'utf8'));
    expect(out).toMatchObject({
      pluginCount: 7,
      dotfilesFiles: 8,
      dotfilesLines: 9000,
      dotfilesLinesLabel: '9.0K',
      source: 'snapshot',
      // The custom snapshot's own "measured" date passes through untouched.
      measured: '2020-01-01',
    });
  });

  it('falls back to hardcoded last-resort defaults (never throws) when even the snapshot is corrupt', () => {
    const snapshotPath = join(scratch, 'corrupt-snapshot.json');
    writeFileSync(snapshotPath, '{ not valid json');
    const outDir = join(scratch, 'corrupt-snapshot-out');

    const stdout = runScript({
      SYSTEM_STATS_SOURCE_DIR: join(scratch, 'yet-another-missing-dir'),
      SYSTEM_STATS_SNAPSHOT_PATH: snapshotPath,
      SYSTEM_STATS_OUT_DIR: outDir,
    });
    expect(stdout).toMatch(/::warning::system-stats:.*snapshot.*unusable/);
    const out = JSON.parse(readFileSync(outJsonPath(outDir), 'utf8'));
    expect(out.source).toBe('snapshot');
    expect(out.pluginCount).toBeGreaterThan(0); // the hardcoded fallback, not a crash
    // No file was actually read (the snapshot was corrupt) -- there is no
    // honest date to cite, so `measured` must be null, NOT fabricated from
    // e.g. HARDCODED_FALLBACK or today's date.
    expect(out.measured).toBeNull();
    expect(existsSync(outJsonPath(outDir))).toBe(true);
  });
});
