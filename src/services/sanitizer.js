/**
 * HTML Sanitizer — Task 6 (DOMPurify 래퍼).
 *
 * A thin, browser-first wrapper around DOMPurify that neutralizes untrusted
 * Prompt_File HTML before it is ever placed in the DOM. DOMPurify is one of the
 * two external runtime libraries explicitly permitted by the architecture (the
 * other being the diff library); it exists solely for the "HTML 정화" purpose
 * allowed by _R1.3_.
 *
 * Design references: design.md "비교표 3: HTML 정화 라이브러리 (채택: DOMPurify)",
 * "Components → Services → Sanitizer", "Security Considerations", and
 * "Correctness Properties → Property 12".
 *
 * ## What the configuration guarantees
 *
 *   - `<script>`, `<iframe>`, `<object>`, `<embed>` elements are removed
 *     (FORBID_TAGS). DOMPurify already strips `<script>` by default; the other
 *     active-content containers are forbidden explicitly so no cross-origin
 *     script resource can be loaded through them (_R12.1, 12.3, 12.4_).
 *   - Inline event-handler attributes (`on*` — onclick, onerror, onload, …) are
 *     removed. DOMPurify drops all `on*` handlers by default; we also set
 *     `FORBID_ATTR` for defense in depth (_R12.1_).
 *   - Dangerous URL schemes in `href`/`src` — `javascript:`, `data:`,
 *     `vbscript:` — are neutralized. DOMPurify blocks `javascript:`/`vbscript:`
 *     by default. Per _R12.2_ this requirement ALSO lists `data:` as dangerous
 *     in `href`/`src`. DOMPurify's `ALLOWED_URI_REGEXP` does not cover `data:`
 *     URIs on media tags (it has a built-in allowance for `data:` on `<img>`,
 *     `<audio>`, `<video>`, `<source>`, …), so we additionally register an
 *     `afterSanitizeAttributes` HOOK that strips any `href`/`src`/`xlink:href`/
 *     `poster` attribute whose value resolves to a dangerous scheme. This is
 *     stricter than DOMPurify's permissive default (which allows `data:`
 *     images); we follow the requirement and document the trade-off here.
 *   - If sanitization cannot be performed at all (no DOM/window available, or
 *     DOMPurify throws), we return a SAFE EMPTY STRING rather than ever
 *     surfacing raw HTML (_R12.6_).
 *
 * The public API is intentionally minimal: `sanitize(htmlString)`.
 */

import DOMPurify from 'dompurify';

/**
 * URL schemes considered safe in `href`/`src`. Everything else — including
 * `javascript:`, `vbscript:`, and (per _R12.2_) `data:` — is rejected. The
 * trailing alternation permits relative / scheme-less URLs (fragments, query
 * strings, absolute paths, bare filenames), mirroring DOMPurify's own default
 * regexp minus the `data:` allowance.
 *
 * @type {RegExp}
 */
const SAFE_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Dangerous URL schemes that must never remain in a URL-bearing attribute,
 * tolerating leading whitespace and control characters an attacker might use
 * to slip past a naive check. Checked by the attribute hook below.
 *
 * @type {RegExp}
 */
const DANGEROUS_SCHEME_REGEXP = /^[\s\u0000-\u001f]*(?:javascript|data|vbscript):/i;

/** URL-bearing attributes the hook inspects for dangerous schemes. */
const URL_ATTRS = ['href', 'src', 'xlink:href', 'poster', 'action', 'formaction', 'background'];

/**
 * DOMPurify configuration shared by every `sanitize` call.
 *
 * - FORBID_TAGS: active-content containers that must never survive.
 * - FORBID_ATTR: inline event handlers (belt-and-suspenders; DOMPurify also
 *   strips these by default).
 * - ALLOWED_URI_REGEXP: the strict scheme allow-list above (blocks `data:`).
 * - RETURN_TRUSTED_TYPE: false so we always get a plain string back.
 *
 * @type {import('dompurify').Config}
 */
const SANITIZE_CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: [
    'onclick',
    'onerror',
    'onload',
    'onmouseover',
    'onmouseout',
    'onfocus',
    'onblur',
    'onchange',
    'onsubmit',
    'onkeydown',
    'onkeyup',
    'onkeypress',
    'oninput',
    'onanimationstart',
    'onanimationend',
  ],
  ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  RETURN_TRUSTED_TYPE: false,
};

/**
 * Lazily-resolved DOMPurify instance bound to a DOM `window`.
 *
 * Browser-first: when a global `window` exists (the browser, or Vitest's jsdom
 * environment which installs a global `window`/`document`), the default import
 * is already a working, window-bound purifier. If the default import is a
 * factory that has not yet bound to a window (some bundling/SSR shapes), we
 * explicitly bind it to the global `window`. We do NOT add jsdom as a runtime
 * dependency — we only ever use an already-present global `window`.
 *
 * @type {{ sanitize: (dirty: string, cfg?: object) => string } | null}
 */
let purifierInstance = null;

/**
 * Register the `afterSanitizeAttributes` hook (idempotently) that strips any
 * URL-bearing attribute whose value resolves to a dangerous scheme
 * (`javascript:`/`data:`/`vbscript:`). This closes DOMPurify's built-in `data:`
 * allowance on media tags so _R12.2_ holds for `data:` as well.
 *
 * @param {{ addHook?: Function }} instance
 * @returns {void}
 */
function installSchemeGuard(instance) {
  if (!instance || typeof instance.addHook !== 'function' || instance.__schemeGuardInstalled) {
    return;
  }
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (!node || typeof node.getAttribute !== 'function') return;
    for (const attr of URL_ATTRS) {
      if (!node.hasAttribute(attr)) continue;
      const value = node.getAttribute(attr) || '';
      if (DANGEROUS_SCHEME_REGEXP.test(value)) {
        node.removeAttribute(attr);
      }
    }
  });
  // Mark so repeated getPurifier() calls do not stack duplicate hooks.
  try {
    Object.defineProperty(instance, '__schemeGuardInstalled', {
      value: true,
      enumerable: false,
    });
  } catch {
    instance.__schemeGuardInstalled = true;
  }
}

/**
 * Resolve (once) a usable, window-bound DOMPurify instance, or `null` if no DOM
 * is available in this environment.
 *
 * @returns {{ sanitize: (dirty: string, cfg?: object) => string } | null}
 */
function getPurifier() {
  if (purifierInstance && typeof purifierInstance.sanitize === 'function') {
    return purifierInstance;
  }

  // Case 1: default import is already a bound purifier (browser / jsdom global).
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    // DOMPurify exposes `isSupported` only when it has a working DOM. In the
    // browser and under the vitest jsdom env this is true.
    if (DOMPurify.isSupported) {
      purifierInstance = DOMPurify;
      installSchemeGuard(purifierInstance);
      return purifierInstance;
    }
    // Default import exists but is not DOM-bound yet: try binding to a global
    // window if one is present.
    if (typeof globalThis !== 'undefined' && globalThis.window && typeof DOMPurify === 'function') {
      try {
        const bound = /** @type {any} */ (DOMPurify)(globalThis.window);
        if (bound && typeof bound.sanitize === 'function' && bound.isSupported) {
          purifierInstance = bound;
          installSchemeGuard(purifierInstance);
          return purifierInstance;
        }
      } catch {
        /* fall through to null */
      }
    }
  }

  // Case 2: default import is a factory. Bind it to the global window.
  if (
    typeof DOMPurify === 'function' &&
    typeof globalThis !== 'undefined' &&
    globalThis.window
  ) {
    try {
      const bound = /** @type {any} */ (DOMPurify)(globalThis.window);
      if (bound && typeof bound.sanitize === 'function') {
        purifierInstance = bound;
        installSchemeGuard(purifierInstance);
        return purifierInstance;
      }
    } catch {
      /* fall through to null */
    }
  }

  return null;
}

/**
 * Sanitize an untrusted HTML string, returning HTML that is safe to insert into
 * the DOM.
 *
 * Guarantees (_R12.1–12.4_): the returned string contains no `<script>`,
 * `<iframe>`, `<object>`, or `<embed>` elements, no `on*` inline event-handler
 * attributes, and no `javascript:`/`data:`/`vbscript:` schemes in `href`/`src`.
 * Sanitization is idempotent: `sanitize(sanitize(x)) === sanitize(x)`
 * (Property 12).
 *
 * Fallback (_R12.6_): if the input is not a string, or no DOM/DOMPurify is
 * available, or DOMPurify throws, this returns a SAFE EMPTY STRING. Raw,
 * un-sanitized HTML is never returned.
 *
 * @param {string} htmlString - Untrusted HTML to clean.
 * @returns {string} Sanitized HTML (possibly empty), never raw input.
 */
export function sanitize(htmlString) {
  // R12.6: non-string input cannot be processed → safe empty string.
  if (typeof htmlString !== 'string') {
    return '';
  }

  const purifier = getPurifier();
  if (!purifier) {
    // No DOM available: we cannot safely parse/clean, so return empty rather
    // than echoing raw HTML back (_R12.6_).
    return '';
  }

  try {
    const clean = purifier.sanitize(htmlString, SANITIZE_CONFIG);
    // DOMPurify returns a string when RETURN_TRUSTED_TYPE is false; guard anyway.
    return typeof clean === 'string' ? clean : String(clean);
  } catch {
    // R12.6: sanitization failed → safe empty string, never raw HTML.
    return '';
  }
}

/**
 * Return the configured, window-bound DOMPurify instance (or `null` if no DOM
 * is available). Exposed for advanced callers/tests that need the underlying
 * purifier; the primary public API remains {@link sanitize}.
 *
 * @returns {{ sanitize: (dirty: string, cfg?: object) => string } | null}
 */
export function getSanitizer() {
  return getPurifier();
}

export default sanitize;
