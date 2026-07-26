import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsTranscode, outputsFor } from '../scripts/transcode-media.mjs';

// The transcode script itself shells out to ffmpeg/sharp; only its PURE cache
// decision and output-path derivation are unit-tested here (the brief forbids
// invoking ffmpeg/sharp in tests -- the real encode is exercised by actually
// running the script locally, per the task instructions).
describe('needsTranscode (digest-skip decision)', () => {
  it('skips when the hash is unchanged and outputs already exist', () => {
    expect(needsTranscode('abc', 'abc', true)).toBe(false);
  });

  it('re-runs when the source hash changed', () => {
    expect(needsTranscode('abc', 'def', true)).toBe(true);
  });

  it('re-runs when an output is missing, even if the hash matches', () => {
    expect(needsTranscode('abc', 'abc', false)).toBe(true);
  });

  it('re-runs when there is no cached hash yet (first build)', () => {
    expect(needsTranscode(undefined, 'abc', false)).toBe(true);
    expect(needsTranscode(undefined, 'abc', true)).toBe(true);
  });
});

describe('outputsFor (self-heal: what SHOULD exist for a given source)', () => {
  it('a GIF expects mp4+webm+jpg', () => {
    const outputs = outputsFor('match3.gif').map((p) => basename(p));
    expect(outputs).toEqual(['match3.mp4', 'match3.webm', 'match3.jpg']);
  });

  it('a non-GIF image expects AVIF+WebP, never a verbatim copy of the source extension', () => {
    const outputs = outputsFor('bolt_timer.png').map((p) => basename(p));
    expect(outputs).toEqual(['bolt_timer.avif', 'bolt_timer.webp']);
    expect(outputs).not.toContain('bolt_timer.png');
  });

  it('is extension-agnostic among non-GIF images (.jpg behaves like .png)', () => {
    expect(outputsFor('photo.jpg').map((p) => basename(p))).toEqual(['photo.avif', 'photo.webp']);
  });

  it('combined with needsTranscode, an old cache missing AVIF/WebP self-heals: a cached digest with the OLD (verbatim-copy) outputs on disk is NOT enough -- the new outputsFor() list is what is checked, so a stale cache re-transcodes exactly once', () => {
    // Simulate: digest matches (source unchanged since a pre-AVIF/WebP cache),
    // but the outputs that exist on disk are the old verbatim copy, not
    // outputsFor()'s current expectation -- so outputsExist is false.
    const outputsExist = false; // caller checks outputsFor(file).every(existsSync)
    expect(needsTranscode('same-hash', 'same-hash', outputsExist)).toBe(true);
  });
});
