import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * theme-control.ts's open/close popover state machine (v1.1 polish Task 8:
 * named in review as the one interactive script with no unit coverage --
 * popover-position.ts already covers the position MATH separately). Unlike
 * theme-boot.ts (which is deliberately built to emit a source STRING, sandboxed
 * per test via `new Function` -- see theme-boot.test.mjs), theme-control.ts is
 * a real ES module with top-level side effects: it reads the ambient
 * `window`/`document`/`matchMedia`/`localStorage`/`CustomEvent` globals
 * directly (never as injected parameters), and calls `boot()` at module-eval
 * time, which wires every `[data-theme-control]` already in `document` at
 * that instant.
 *
 * That is still testable, not "genuinely impractical" -- it just needs the
 * globals in place BEFORE the module evaluates, which a static top-of-file
 * import can't do (imports are hoisted ahead of any test-local setup). Each
 * test instead:
 *   1. builds a fresh linkedom document shaped like ThemeControl.astro's real
 *      markup (mirrored in themeControlHtml() below) and assigns it, along
 *      with stub matchMedia/localStorage and linkedom's OWN Event/CustomEvent
 *      constructors, to `globalThis` (see the CustomEvent note below);
 *   2. calls `vi.resetModules()` then `await import('../src/scripts/theme-control')`
 *      so the module's top-level `boot()` runs fresh against THIS test's DOM.
 *
 * Custom window-property leak (found empirically, not guessed -- and already
 * documented once in this codebase, see theme-boot.test.mjs's own comment on
 * the same root cause): linkedom's `parseHTML()` returns a genuinely distinct
 * `window` OBJECT each call (`a.window === b.window` is false), but expando
 * properties assigned onto one leak onto every later one anyway (verified
 * directly: `a.window.__foo = 'x'` makes `b.window.__foo` read `'x'` too, for
 * a `b` parsed from a SEPARATE parseHTML() call). Left alone, that means
 * `window.__themeControlGlobalsWired` reads `true` starting from the SECOND
 * test in this file, so `wireGlobals()` bails out before ever registering the
 * 'astro:before-swap'/'themechange' listeners on that test's own document --
 * reproduced by hand: a full `astro:before-swap` round-trip passes in
 * isolation but fails the instant a prior test in the same file has already
 * mounted once. mount() below explicitly zeroes both of theme-control.ts's
 * own window flags (`__setTheme`, `__themeControlGlobalsWired`) after
 * assigning the fresh window/document and before importing, exactly
 * mirroring theme-boot.test.mjs's `window.__themeBooted = undefined` reset.
 *
 * CustomEvent gotcha (also found empirically): Node ships its own
 * global `CustomEvent`, and theme-control.ts's `dispatchPopoverState` calls
 * the BARE `CustomEvent` identifier -- if `globalThis.CustomEvent` is left as
 * Node's native one while `globalThis.document` is a linkedom document,
 * linkedom's own `dispatchEvent` throws ("Cannot set property eventPhase ...
 * which has only a getter") trying to mutate an event object shaped by a
 * different DOM implementation. Fix: point `globalThis.CustomEvent`/`Event`
 * at the SAME linkedom `window`'s constructors, exactly like `window`/
 * `document` themselves.
 *
 * Two narrow, real limitations of this harness (documented rather than
 * silently worked around):
 *   - linkedom v0.18.13's `Element.focus()` does not update
 *     `document.activeElement` (verified empirically: calling `.focus()`
 *     leaves it unchanged). `document.activeElement` IS a plain writable
 *     property, though, so the roving tests below set it directly to stand
 *     in for "this element currently has focus" and verify roving's RESULT
 *     via `vi.spyOn(el, 'focus')` rather than re-reading activeElement
 *     afterward -- real assertions, just aimed at a different observable.
 *   - `open()`'s defense-in-depth guard (`trigger.offsetParent === null`,
 *     for a control that lives in a display:none subtree) is not exercisable
 *     here: linkedom never computes real layout, so `offsetParent` is always
 *     `undefined`, never `null` -- the guard can't be driven either way. Not
 *     tested below; this is the one behavior left to manual/browser
 *     verification, same as popover-position.ts's documented layout gap.
 */

const FAMILIES = ['tokyonight', 'catppuccin', 'github'] as const;

function themeControlHtml(defaultFamily = 'tokyonight'): string {
  const familyRows = FAMILIES.map(
    (f) =>
      `<li><button type="button" data-family="${f}" data-swatch-light='{"bg":"#fff","fg":"#000","accent":"#111111"}' data-swatch-dark='{"bg":"#000","fg":"#fff","accent":"#7aa2f7"}' aria-pressed="false"><span data-family-dot aria-hidden="true"></span><span data-family-name>${f}</span></button></li>`,
  ).join('');
  return `<!doctype html><html><body>
    <div data-theme-control data-default-family="${defaultFamily}">
      <button type="button" data-theme-trigger aria-haspopup="dialog" aria-expanded="false" aria-controls="theme-popover">
        <span data-theme-dot aria-hidden="true"></span>
        <span data-theme-label>Tokyonight</span>
      </button>
      <div class="theme-control__popover" id="theme-popover" role="dialog" data-theme-popover hidden>
        <ul>${familyRows}</ul>
        <div>
          <button type="button" data-mode="light" aria-pressed="false">Light</button>
          <button type="button" data-mode="dark" aria-pressed="false">Dark</button>
          <button type="button" data-mode="system" aria-pressed="false">System</button>
        </div>
      </div>
    </div>
    <button type="button" id="outside">outside the control</button>
    <button type="button" id="remote-anchor">theme: tokyonight/storm</button>
  </body></html>`;
}

interface Mounted {
  window: any;
  document: any;
  mod: typeof import('../src/scripts/theme-control');
  trigger: any;
  popover: any;
  familyButtons: any[];
  modeButtons: any[];
  outside: any;
  remoteAnchor: any;
  isOpen: () => boolean;
  /** Builds + dispatches a linkedom-native CustomEvent, with extra properties
   *  (key, relatedTarget, ...) grafted on via defineProperty -- linkedom
   *  implements neither KeyboardEvent nor FocusEvent, but the listeners under
   *  test only ever duck-type-read `.key`/`.relatedTarget`/`.target` off
   *  whatever object they're handed, so this is a faithful stand-in. */
  fire: (el: any, type: string, props?: Record<string, unknown>) => any;
}

async function mount(opts: { storage?: Record<string, string>; defaultFamily?: string } = {}): Promise<Mounted> {
  const { storage = {}, defaultFamily = 'tokyonight' } = opts;
  const { window, document } = parseHTML(themeControlHtml(defaultFamily));

  const localStorage = {
    getItem: (k: string) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k: string, v: string) => {
      storage[k] = String(v);
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
  };
  function matchMedia(query: string) {
    return {
      media: query,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  (globalThis as any).window = window;
  (globalThis as any).document = document;
  (globalThis as any).localStorage = localStorage;
  (globalThis as any).matchMedia = matchMedia;
  // See the module doc comment above: must be linkedom's OWN constructors,
  // not Node's native globals, or linkedom's dispatchEvent throws.
  (globalThis as any).CustomEvent = window.CustomEvent;
  (globalThis as any).Event = window.Event;
  // See the module doc comment above: undoes linkedom's cross-instance
  // expando-property leak for theme-control.ts's own two window flags, so
  // every test's wireGlobals()/`if (!window.__setTheme)` guard behaves as if
  // this were truly the first page load, not the Nth in this file.
  (window as any).__setTheme = undefined;
  (window as any).__themeControlGlobalsWired = undefined;

  vi.resetModules();
  const mod = await import('../src/scripts/theme-control');

  // Non-null: themeControlHtml() above always renders one -- a missing
  // popover in the fixture is a bug in this file, not a real "might not
  // exist" case worth threading `| null` through every helper below.
  const popover = document.querySelector('[data-theme-popover]')!;
  const fire = (el: any, type: string, props: Record<string, unknown> = {}) => {
    const evt = new window.CustomEvent(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries(props)) {
      Object.defineProperty(evt, k, { value: v, configurable: true });
    }
    el.dispatchEvent(evt);
    return evt;
  };

  return {
    window,
    document,
    mod,
    trigger: document.querySelector('[data-theme-trigger]'),
    popover,
    familyButtons: Array.from(document.querySelectorAll('[data-family]')),
    modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
    outside: document.getElementById('outside'),
    remoteAnchor: document.getElementById('remote-anchor'),
    isOpen: () => !popover.hasAttribute('hidden'),
    fire,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).matchMedia;
  delete (globalThis as any).CustomEvent;
  delete (globalThis as any).Event;
});

describe('trigger click: open/close toggle', () => {
  it('starts closed (popover hidden, trigger aria-expanded=false)', async () => {
    const { popover, trigger, isOpen } = await mount();
    expect(isOpen()).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(popover.hasAttribute('hidden')).toBe(true);
  });

  it('first click opens: unhides the popover, flips aria-expanded, focuses the active family row', async () => {
    const { trigger, familyButtons, isOpen, fire } = await mount({
      storage: { 'theme:family': 'tokyonight' },
    });
    const tokyonightBtn = familyButtons.find((b) => b.dataset.family === 'tokyonight');
    const focusSpy = vi.spyOn(tokyonightBtn, 'focus');

    fire(trigger, 'click');

    expect(isOpen()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // syncControl (run at wire time) already marked the stored family's row
    // aria-pressed=true, which is exactly the row open() should focus.
    expect(tokyonightBtn.getAttribute('aria-pressed')).toBe('true');
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('open() focuses familyButtons[0] as a fallback when no row is aria-pressed (a corrupt/unknown stored family)', async () => {
    const { trigger, familyButtons, fire } = await mount({
      storage: { 'theme:family': 'not-a-real-family' },
    });
    const focusSpy = vi.spyOn(familyButtons[0], 'focus');
    fire(trigger, 'click');
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('second click closes: re-hides the popover, flips aria-expanded back, returns focus to the trigger', async () => {
    const { trigger, isOpen, fire } = await mount();
    const triggerFocusSpy = vi.spyOn(trigger, 'focus');

    fire(trigger, 'click'); // open
    fire(trigger, 'click'); // close

    expect(isOpen()).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(triggerFocusSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatches a themepopover CustomEvent with {open:true}/{open:false} on each transition', async () => {
    const { document, trigger, fire } = await mount();
    const seen: boolean[] = [];
    document.addEventListener('themepopover', (e: any) => seen.push(e.detail.open));

    fire(trigger, 'click');
    fire(trigger, 'click');

    expect(seen).toEqual([true, false]);
  });
});

describe('Escape: closes and stops propagation', () => {
  it('closes the popover and calls stopPropagation on the keydown event', async () => {
    const { trigger, popover, isOpen, window, fire } = await mount();
    fire(trigger, 'click');
    expect(isOpen()).toBe(true);

    const evt = new window.CustomEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'key', { value: 'Escape', configurable: true });
    const stopSpy = vi.spyOn(evt, 'stopPropagation');
    popover.dispatchEvent(evt);

    expect(isOpen()).toBe(false);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});

describe('outside interaction closes the popover; inside interaction does not', () => {
  it('a click outside the control closes it, WITHOUT returning focus to the trigger', async () => {
    const { trigger, outside, isOpen, fire } = await mount();
    const triggerFocusSpy = vi.spyOn(trigger, 'focus');
    fire(trigger, 'click');
    expect(isOpen()).toBe(true);

    fire(outside, 'click', { bubbles: true });

    expect(isOpen()).toBe(false);
    // onOutsideClick calls close(false) -- an outside click is not the same
    // as a deliberate toggle-close, so focus must not jump back to the trigger.
    expect(triggerFocusSpy).not.toHaveBeenCalled();
  });

  it('a click on the popover itself (inside the control) does not close it', async () => {
    const { trigger, popover, isOpen, fire } = await mount();
    fire(trigger, 'click');
    expect(isOpen()).toBe(true);

    fire(popover, 'click', { bubbles: true });

    expect(isOpen()).toBe(true);
  });

  it('focusout to an element outside the popover closes it (non-modal tab-out)', async () => {
    const { trigger, popover, outside, isOpen, fire } = await mount();
    fire(trigger, 'click');
    expect(isOpen()).toBe(true);

    fire(popover, 'focusout', { relatedTarget: outside });

    expect(isOpen()).toBe(false);
  });

  it('focusout to an element still inside the popover does not close it', async () => {
    const { trigger, popover, familyButtons, isOpen, fire } = await mount();
    fire(trigger, 'click');
    expect(isOpen()).toBe(true);

    fire(popover, 'focusout', { relatedTarget: familyButtons[1] });

    expect(isOpen()).toBe(true);
  });

  it('focusout with relatedTarget=null (focus left the document entirely) is ignored, not treated as outside', async () => {
    const { trigger, popover, isOpen, fire } = await mount();
    fire(trigger, 'click');
    expect(isOpen()).toBe(true);

    fire(popover, 'focusout', { relatedTarget: null });

    expect(isOpen()).toBe(true);
  });
});

describe('arrow-key roving among family rows', () => {
  it('ArrowDown moves from the current row to the next one', async () => {
    const { trigger, popover, familyButtons, document, fire } = await mount();
    fire(trigger, 'click');
    document.activeElement = familyButtons[0]; // tokyonight
    const nextFocus = vi.spyOn(familyButtons[1], 'focus');

    fire(popover, 'keydown', { key: 'ArrowDown' });

    expect(nextFocus).toHaveBeenCalledTimes(1);
  });

  it('ArrowUp from the first row wraps to the last', async () => {
    const { trigger, popover, familyButtons, document, fire } = await mount();
    fire(trigger, 'click');
    document.activeElement = familyButtons[0];
    const lastFocus = vi.spyOn(familyButtons[familyButtons.length - 1], 'focus');

    fire(popover, 'keydown', { key: 'ArrowUp' });

    expect(lastFocus).toHaveBeenCalledTimes(1);
  });

  it('Home/End jump to the first/last row regardless of current position', async () => {
    const { trigger, popover, familyButtons, document, fire } = await mount();
    fire(trigger, 'click');
    document.activeElement = familyButtons[1];
    const firstFocus = vi.spyOn(familyButtons[0], 'focus');
    const lastFocus = vi.spyOn(familyButtons[familyButtons.length - 1], 'focus');

    fire(popover, 'keydown', { key: 'Home' });
    fire(popover, 'keydown', { key: 'End' });

    expect(firstFocus).toHaveBeenCalledTimes(1);
    expect(lastFocus).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the current activeElement is not one of the family rows (idx === -1 early-return)', async () => {
    const { trigger, popover, familyButtons, document, fire } = await mount();
    fire(trigger, 'click');
    document.activeElement = trigger; // focus is on the trigger, not a row
    const spies = familyButtons.map((b) => vi.spyOn(b, 'focus'));

    fire(popover, 'keydown', { key: 'ArrowDown' });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('family/mode row clicks call the shared window.__setTheme mutation API', () => {
  it('clicking a family row applies that family with the currently stored mode, and leaves the popover open', async () => {
    const { trigger, familyButtons, window, isOpen, fire } = await mount({
      storage: { 'theme:family': 'tokyonight', 'theme:mode': 'dark' },
    });
    const setThemeSpy = vi.fn();
    window.__setTheme = setThemeSpy;
    fire(trigger, 'click');

    const catppuccinBtn = familyButtons.find((b) => b.dataset.family === 'catppuccin');
    fire(catppuccinBtn, 'click');

    expect(setThemeSpy).toHaveBeenCalledWith('catppuccin', 'dark');
    // Picking a family is not a dismissal -- a visitor compares live.
    expect(isOpen()).toBe(true);
  });

  it('clicking a mode row applies the currently stored family with that mode', async () => {
    const { trigger, modeButtons, window, fire } = await mount({
      storage: { 'theme:family': 'github', 'theme:mode': 'system' },
    });
    const setThemeSpy = vi.fn();
    window.__setTheme = setThemeSpy;
    fire(trigger, 'click');

    const lightBtn = modeButtons.find((b) => b.dataset.mode === 'light');
    fire(lightBtn, 'click');

    expect(setThemeSpy).toHaveBeenCalledWith('github', 'light');
  });
});

describe('openThemePopover(anchor): the SystemCard remote trigger', () => {
  it('opens the SAME shared popover, anchored to the remote element, and returns focus to IT (not the sidebar trigger) on close', async () => {
    const { trigger, remoteAnchor, popover, mod, isOpen } = await mount();
    const triggerFocusSpy = vi.spyOn(trigger, 'focus');
    const remoteFocusSpy = vi.spyOn(remoteAnchor, 'focus');

    mod.openThemePopover(remoteAnchor);
    expect(isOpen()).toBe(true);
    expect(popover.hasAttribute('hidden')).toBe(false);

    // Close via Escape (a normal, returnFocus=true close).
    const evt = new (globalThis as any).window.CustomEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'key', { value: 'Escape', configurable: true });
    popover.dispatchEvent(evt);

    expect(isOpen()).toBe(false);
    expect(remoteFocusSpy).toHaveBeenCalledTimes(1);
    expect(triggerFocusSpy).not.toHaveBeenCalled();
  });
});

describe('astro:before-swap: a ClientRouter navigation closes an open popover without stealing focus', () => {
  it('closes the popover but does NOT return focus anywhere (a navigation is about to move focus itself)', async () => {
    const { document, trigger, remoteAnchor, mod, isOpen, fire } = await mount();
    const triggerFocusSpy = vi.spyOn(trigger, 'focus');
    const remoteFocusSpy = vi.spyOn(remoteAnchor, 'focus');

    mod.openThemePopover(remoteAnchor);
    expect(isOpen()).toBe(true);

    fire(document, 'astro:before-swap');

    expect(isOpen()).toBe(false);
    expect(triggerFocusSpy).not.toHaveBeenCalled();
    expect(remoteFocusSpy).not.toHaveBeenCalled();
  });

  it('is harmless when the popover is already closed (closePrimaryPopover no-ops via isOpen() guard)', async () => {
    const { document, isOpen, fire } = await mount();
    expect(isOpen()).toBe(false);
    expect(() => fire(document, 'astro:before-swap')).not.toThrow();
    expect(isOpen()).toBe(false);
  });
});

describe('re-wiring guard: a second astro:page-load (persisted sidebar across a swap) does not double-wire', () => {
  it('one trigger click still only opens once, not open-then-immediately-close from a duplicate listener', async () => {
    const { document, trigger, isOpen, fire } = await mount();

    // Simulates ClientRouter firing astro:page-load again against the SAME
    // transition:persist'd sidebar node -- boot() must be idempotent per
    // control (root.dataset.themeControlWired) or this second call would
    // register a second, independent click listener on the same trigger.
    fire(document, 'astro:page-load');

    fire(trigger, 'click');

    expect(isOpen()).toBe(true);
  });
});
