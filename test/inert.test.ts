import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { setBackgroundInert } from '../src/lib/inert';

/*
 * setBackgroundInert backs the ⌘K palette's manual modality (Palette.astro is
 * a <div role="dialog">, not a native <dialog> shown with showModal() -- see
 * src/lib/inert.ts for the full rationale on why that means inert has to be
 * applied by hand). These tests exercise it against a Base.astro/Shell.astro-
 * shaped <body>: skip link, topbar, the .shell grid, the mobile nav dialog,
 * and the palette itself as the LAST sibling -- mirroring the real DOM order.
 */
function shellDoc() {
  const { document } = parseHTML(`<!doctype html><html><body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="topbar">topbar</header>
    <div class="shell">shell content</div>
    <dialog class="nav-sheet">nav sheet</dialog>
    <command-palette>palette</command-palette>
  </body></html>`);
  return document;
}

describe('setBackgroundInert', () => {
  it('marks every sibling inert except the one passed as `keep`', () => {
    const doc = shellDoc();
    const palette = doc.querySelector('command-palette')!;
    setBackgroundInert(doc.body, palette, true);

    expect(doc.querySelector('.skip-link')?.hasAttribute('inert')).toBe(true);
    expect(doc.querySelector('.topbar')?.hasAttribute('inert')).toBe(true);
    expect(doc.querySelector('.shell')?.hasAttribute('inert')).toBe(true);
    expect(doc.querySelector('.nav-sheet')?.hasAttribute('inert')).toBe(true);
    // The dialog itself -- the element the background is inert FOR -- is
    // never inerted (that would make the palette untouchable too).
    expect(palette.hasAttribute('inert')).toBe(false);
  });

  it('removes inert from every sibling on close, restoring the pre-open state exactly', () => {
    const doc = shellDoc();
    const palette = doc.querySelector('command-palette')!;
    setBackgroundInert(doc.body, palette, true);
    setBackgroundInert(doc.body, palette, false);

    for (const child of Array.from(doc.body.children)) {
      expect(child.hasAttribute('inert')).toBe(false);
    }
  });

  it('is idempotent in both directions (repeat open, repeat close)', () => {
    const doc = shellDoc();
    const palette = doc.querySelector('command-palette')!;
    setBackgroundInert(doc.body, palette, true);
    setBackgroundInert(doc.body, palette, true);
    expect(doc.querySelector('.shell')?.hasAttribute('inert')).toBe(true);

    setBackgroundInert(doc.body, palette, false);
    setBackgroundInert(doc.body, palette, false);
    expect(doc.querySelector('.shell')?.hasAttribute('inert')).toBe(false);
  });

  it('never touches the kept element even when re-closing without ever opening', () => {
    const doc = shellDoc();
    const palette = doc.querySelector('command-palette')!;
    setBackgroundInert(doc.body, palette, false);
    expect(palette.hasAttribute('inert')).toBe(false);
    for (const child of Array.from(doc.body.children)) {
      expect(child.hasAttribute('inert')).toBe(false);
    }
  });
});
