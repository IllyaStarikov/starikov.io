/*
 * Tool-page enhancements: copy buttons on the SYNOPSIS command blocks and on
 * the SOURCE `git clone` line. Progressive -- with no JS the commands are still
 * fully visible and selectable; this only adds one-tap copy.
 *
 * Runs on astro:page-load so it re-attaches after every ClientRouter swap, and
 * is idempotent (a data flag guards against double-wrapping). The success state
 * uses a check icon with a small spring; the global reduced-motion rule turns
 * the spring off.
 */

const COPY_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CHECK_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function flashCopied(button: HTMLButtonElement): void {
  button.classList.add('is-copied');
  button.innerHTML = CHECK_ICON;
  button.setAttribute('aria-label', 'Copied');
  window.setTimeout(() => {
    button.classList.remove('is-copied');
    button.innerHTML = COPY_ICON;
    button.setAttribute('aria-label', button.dataset.copyLabel ?? 'Copy');
  }, 1400);
}

function attachCopy(button: HTMLButtonElement, getText: () => string): void {
  button.addEventListener('click', async () => {
    const text = getText().replace(/\n+$/, '');
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(button);
    } catch {
      // Clipboard blocked (insecure context / denied): select the text as a
      // fallback so the user can copy manually.
      const range = document.createRange();
      const target = button.previousElementSibling ?? button.parentElement;
      if (target) {
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  });
}

function makeButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-btn';
  button.dataset.copyLabel = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = COPY_ICON;
  return button;
}

function enhance(): void {
  // SYNOPSIS command blocks: wrap each <pre> so a copy button can sit over it.
  document.querySelectorAll<HTMLPreElement>('[data-synopsis] pre').forEach((pre) => {
    if (pre.dataset.copyReady) return;
    pre.dataset.copyReady = 'true';
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.parentNode?.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const button = makeButton('Copy command');
    attachCopy(button, () => pre.querySelector('code')?.textContent ?? pre.textContent ?? '');
    wrap.appendChild(button);
  });

  // Explicit copy targets (the SOURCE clone line).
  document.querySelectorAll<HTMLButtonElement>('button[data-copy-target]').forEach((button) => {
    if (button.dataset.copyReady) return;
    button.dataset.copyReady = 'true';
    const selector = button.getAttribute('data-copy-target');
    const target = selector ? document.querySelector(selector) : null;
    button.dataset.copyLabel = button.getAttribute('aria-label') ?? 'Copy';
    if (!button.innerHTML.trim()) button.innerHTML = COPY_ICON;
    attachCopy(button, () => target?.textContent ?? '');
  });
}

document.addEventListener('astro:page-load', enhance);
