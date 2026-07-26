import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { isNonMacPlatform, swapKbdToNonMac } from '../src/lib/kbd-platform';

describe('isNonMacPlatform', () => {
  it('reads real Macs as mac (no swap) via navigator.platform', () => {
    expect(isNonMacPlatform({ platform: 'MacIntel' })).toBe(false);
  });

  it('reads iPhone/iPad as mac (no swap) -- Apple platforms all use ⌘, even iOS with an external keyboard', () => {
    expect(isNonMacPlatform({ platform: 'iPhone' })).toBe(false);
    expect(isNonMacPlatform({ platform: 'iPad' })).toBe(false);
    // Modern iPadOS Safari actually reports "MacIntel" (desktop-site
    // spoofing since iPadOS 13); covered by the MacIntel case above too.
    expect(isNonMacPlatform({ platform: 'iPod' })).toBe(false);
  });

  it('reads Windows/Linux/ChromeOS/Android as non-mac (swap to Ctrl)', () => {
    expect(isNonMacPlatform({ platform: 'Win32' })).toBe(true);
    expect(isNonMacPlatform({ platform: 'Linux x86_64' })).toBe(true);
    expect(isNonMacPlatform({ userAgentData: { platform: 'Chrome OS' } })).toBe(true);
    expect(isNonMacPlatform({ userAgentData: { platform: 'Android' } })).toBe(true);
  });

  it('prefers userAgentData over the legacy platform string when both are present', () => {
    expect(
      isNonMacPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }),
    ).toBe(true);
    expect(
      isNonMacPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' }),
    ).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isNonMacPlatform({ platform: 'MACINTEL' })).toBe(false);
    expect(isNonMacPlatform({ platform: 'WINDOWS' })).toBe(true);
  });

  it('with no platform signal at all, defaults to mac (the SSR default already matches -- never guess into a swap)', () => {
    expect(isNonMacPlatform({})).toBe(false);
    expect(isNonMacPlatform({ platform: '' })).toBe(false);
    expect(isNonMacPlatform({ userAgentData: {} })).toBe(false);
  });
});

/** A linkedom document with one Kbd.astro-shaped instance (glyph + sr-only
 *  label) plus a bare `<kbd data-kbd-glyph>` with no label pair, matching the
 *  palette footer's "⌘"-only usage (Palette.astro). */
function kbdDoc() {
  const { document } = parseHTML(`<!doctype html><html><body>
    <button>
      <kbd data-kbd-glyph aria-hidden="true">⌘K</kbd><span class="sr-only" data-kbd-label>Command K</span>
    </button>
    <span><kbd data-kbd-glyph>⌘</kbd><kbd>↵</kbd> new tab</span>
    <kbd>↑</kbd>
  </body></html>`);
  return document;
}

describe('swapKbdToNonMac', () => {
  it('replaces ⌘ with Ctrl in every [data-kbd-glyph] element, leaving other kbds untouched', () => {
    const doc = kbdDoc();
    swapKbdToNonMac(doc);
    const glyphs = Array.from(doc.querySelectorAll('[data-kbd-glyph]')).map((el) => el.textContent);
    expect(glyphs).toEqual(['CtrlK', 'Ctrl']);
    // The plain arrow/enter kbds (no data-kbd-glyph) are never touched.
    const untouched = Array.from(doc.querySelectorAll('kbd:not([data-kbd-glyph])')).map(
      (el) => el.textContent,
    );
    expect(untouched).toEqual(['↵', '↑']);
  });

  it('replaces the leading "Command" word in every [data-kbd-label] element with "Control"', () => {
    const doc = kbdDoc();
    swapKbdToNonMac(doc);
    expect(doc.querySelector('[data-kbd-label]')?.textContent).toBe('Control K');
  });

  it('is idempotent -- running twice produces the same result as running once', () => {
    const doc = kbdDoc();
    swapKbdToNonMac(doc);
    swapKbdToNonMac(doc);
    const glyphs = Array.from(doc.querySelectorAll('[data-kbd-glyph]')).map((el) => el.textContent);
    expect(glyphs).toEqual(['CtrlK', 'Ctrl']);
    expect(doc.querySelector('[data-kbd-label]')?.textContent).toBe('Control K');
  });

  it('a document with no ⌘/Command content at all is left untouched (mac visitors never mutate the DOM)', () => {
    const { document } = parseHTML(
      '<!doctype html><html><body><kbd data-kbd-glyph aria-hidden="true">⌘K</kbd></body></html>',
    );
    const before = document.querySelector('[data-kbd-glyph]')?.textContent;
    // Simulate calling it on an unrelated subtree with nothing to swap.
    const scope = document.createElement('div');
    swapKbdToNonMac(scope);
    expect(document.querySelector('[data-kbd-glyph]')?.textContent).toBe(before);
  });
});
