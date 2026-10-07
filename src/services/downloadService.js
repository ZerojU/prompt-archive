/**
 * Download service for the "수정 결과 HTML 다운로드" feature (_Requirements: R10_).
 *
 * The user edits a Prompt_File and downloads the result as an HTML file. The
 * downloaded document must preserve the ORIGINAL document byte-for-byte outside
 * the prompt-content region (doctype, head, surrounding markup, whitespace,
 * encoding) and only replace the INNER content of the prompt-content region
 * with the edited text, HTML-entity-escaping that text so the document
 * structure can never break (_Requirements: 10.2, 10.3, 10.4_). Everything
 * happens client-side; no original or modified data is ever sent to any server
 * (_Requirements: 10.1, 10.7_).
 *
 * This module is split into:
 *   - PURE functions (`escapeHtml`, `buildModifiedHtml`, `proposeFilename`) that
 *     do string transformation only — no DOM, no Blob, no I/O. A string-based
 *     (NOT DOMParser/innerHTML) implementation is REQUIRED for byte-preservation:
 *     round-tripping through the DOM would normalize/rewrite the untouched
 *     regions and violate R10.2/R10.4.
 *   - A SIDE-EFFECT function (`triggerDownload`) that creates a Blob and uses a
 *     temporary `<a download>` element to save the file client-side.
 */

/**
 * The five HTML special characters and their entity replacements. Escaping all
 * five guarantees the edited text, once substituted into the prompt-content
 * region, cannot introduce new tags, break out of an attribute, or corrupt the
 * surrounding document structure (_Requirements: 10.3_).
 *
 * @type {ReadonlyArray<[RegExp, string]>}
 */
const ESCAPE_RULES = [
  [/&/g, '&amp;'], // MUST run first so entity ampersands aren't double-escaped.
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&#39;'],
];

/**
 * HTML-entity-escape a string: `<`, `>`, `&`, `"`, `'` → `&lt; &gt; &amp;
 * &quot; &#39;`. Pure. Used by {@link buildModifiedHtml} to make the edited
 * text safe to inject into the document (_Requirements: 10.3_).
 *
 * The `&` rule runs first; otherwise the `&` in e.g. `&lt;` produced by a later
 * rule would be re-escaped to `&amp;lt;`.
 *
 * @param {string} text - Arbitrary text to escape.
 * @returns {string} The HTML-entity-escaped text.
 */
export function escapeHtml(text) {
  let out = text == null ? '' : String(text);
  for (const [pattern, replacement] of ESCAPE_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Matches the opening `<section ...class="prompt-content"...>` tag of the FIRST
 * prompt-content region.
 *
 * Region identification strategy (string-based, byte-preserving):
 *   - `<section` followed by any attributes, where one attribute is
 *     `class` whose (single- or double-quoted) value CONTAINS the token
 *     `prompt-content`. Extra classes and other attributes in any order are
 *     allowed (e.g. `<section id="p" class="box prompt-content">`).
 *   - The regex captures the full opening tag so it can be re-emitted verbatim
 *     (the opening/closing tags themselves are preserved byte-for-byte; only
 *     the inner content between them is replaced).
 *
 * `[^>]*` deliberately stops at the first `>`, so the opening tag cannot span a
 * nested `>`; standard `<section ...>` opening tags do not contain `>`.
 *
 * @type {RegExp}
 */
const OPEN_TAG_RE =
  /<section\b[^>]*\bclass\s*=\s*("[^"]*\bprompt-content\b[^"]*"|'[^']*\bprompt-content\b[^']*')[^>]*>/i;

/** Matches a `</section>` closing tag (case-insensitive, tolerant whitespace). */
const CLOSE_TAG_RE = /<\/section\s*>/i;

/**
 * Build the modified HTML document by replacing ONLY the inner content of the
 * first `<section class="prompt-content">…</section>` region with the escaped
 * edited text, preserving everything outside that region byte-for-byte
 * (_Requirements: 10.2, 10.3, 10.4_).
 *
 * Implementation is purely string-based to guarantee byte preservation: the
 * document is split into `prefix` + `openTag` + `inner` + `closeTag` + `suffix`,
 * and only `inner` is substituted. `prefix`, `openTag`, `closeTag`, and
 * `suffix` are concatenated back verbatim.
 *
 * Return shape (documented; the property tests rely on it):
 *   - On success: `{ ok: true, html }` where `html` is the full modified
 *     document string.
 *   - On failure (region cannot be identified): `{ ok: false, reason }`. The
 *     original is NOT altered and no error is thrown, so the caller can show an
 *     error message (_Requirements: 10.6_). `reason` is one of
 *     `'no-open-tag'` or `'no-close-tag'`.
 *
 * @param {string} originalHtml - The original Prompt_File HTML document.
 * @param {string} editedText   - The user's edited prompt text (raw, unescaped).
 * @returns {{ ok: true, html: string } | { ok: false, reason: string }}
 */
export function buildModifiedHtml(originalHtml, editedText) {
  const source = originalHtml == null ? '' : String(originalHtml);

  const openMatch = OPEN_TAG_RE.exec(source);
  if (!openMatch) {
    // No identifiable prompt-content region → do not alter the original (R10.6).
    return { ok: false, reason: 'no-open-tag' };
  }

  const openTag = openMatch[0];
  const openStart = openMatch.index;
  const innerStart = openStart + openTag.length;

  // Find the matching closing tag AFTER the opening tag.
  CLOSE_TAG_RE.lastIndex = 0;
  const closeMatch = CLOSE_TAG_RE.exec(source.slice(innerStart));
  if (!closeMatch) {
    return { ok: false, reason: 'no-close-tag' };
  }

  const closeTag = closeMatch[0];
  const innerEnd = innerStart + closeMatch.index;
  const closeEnd = innerEnd + closeTag.length;

  // Byte-preserved outside regions.
  const prefix = source.slice(0, openStart);
  const suffix = source.slice(closeEnd);

  const escapedInner = escapeHtml(editedText);

  const html = prefix + openTag + escapedInner + closeTag + suffix;
  return { ok: true, html };
}

/**
 * Propose a download filename by inserting `_modified` before the LAST
 * extension of the original filename (_Requirements: 10.5_).
 *
 * Examples / edge cases (documented):
 *   - `spring.html`   → `spring_modified.html`
 *   - `a.b.html`      → `a.b_modified.html`   (only the LAST ext is split)
 *   - `README`        → `README_modified`     (no extension → append suffix)
 *   - `.gitignore`    → `.gitignore_modified` (leading dot is not an extension
 *                        separator; a leading-dot name has no "name.ext" split)
 *   - `archive.`      → `archive_modified.`   (trailing dot: empty extension)
 *   - `` (empty)      → `_modified`
 *
 * Pure. No I/O.
 *
 * @param {string} originalFilename - The original Prompt_File filename.
 * @returns {string} The proposed `name_modified.ext` filename.
 */
export function proposeFilename(originalFilename) {
  const name = originalFilename == null ? '' : String(originalFilename);

  const lastDot = name.lastIndexOf('.');

  // No dot, OR the only dot is the leading char (dotfile like `.gitignore`):
  // there is no extension to insert before, so append the suffix.
  if (lastDot <= 0) {
    return `${name}_modified`;
  }

  const base = name.slice(0, lastDot);
  const ext = name.slice(lastDot); // includes the leading '.'
  return `${base}_modified${ext}`;
}

/**
 * Resolve a dependency from the provided overrides, falling back to the global
 * value. Allows injection for testability while defaulting to browser globals
 * so the jsdom test environment works out of the box.
 *
 * @param {Record<string, unknown>} overrides
 * @param {string} key
 * @returns {unknown}
 */
function resolveDep(overrides, key) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key];
  }
  return typeof globalThis !== 'undefined' ? globalThis[key] : undefined;
}

/**
 * Trigger a client-side download of `htmlString` as an HTML file named
 * `filename` (_Requirements: 10.1, 10.7_).
 *
 * Creates a `Blob` of type `text/html`, obtains an object URL via
 * `URL.createObjectURL`, clicks a temporary `<a download=filename>` element to
 * save the file, then revokes the object URL. NOTHING is uploaded to any server
 * — the entire operation is local to the browser (_Requirements: 10.7_).
 *
 * Dependencies (`document`, `URL`, `Blob`) are resolved from globals by default
 * so the function works in a browser and under jsdom, but may be injected via
 * `deps` for testability.
 *
 * Environment guard (documented choice): if `document`, `URL`, or `Blob` is
 * unavailable (e.g. the module is imported in a non-DOM context), the function
 * THROWS a clear `Error` rather than silently doing nothing, so a misuse is
 * surfaced immediately. Importing the module never crashes; only CALLING
 * `triggerDownload` without a DOM does.
 *
 * @param {string} htmlString - The HTML document contents to download.
 * @param {string} filename   - The suggested download filename.
 * @param {{ document?: Document, URL?: typeof URL, Blob?: typeof Blob }} [deps]
 *   Optional dependency overrides (defaults to browser globals).
 * @returns {void}
 */
export function triggerDownload(htmlString, filename, deps = {}) {
  const doc = /** @type {Document} */ (resolveDep(deps, 'document'));
  const UrlApi = /** @type {typeof URL} */ (resolveDep(deps, 'URL'));
  const BlobApi = /** @type {typeof Blob} */ (resolveDep(deps, 'Blob'));

  if (!doc || !UrlApi || !BlobApi) {
    throw new Error(
      'triggerDownload requires a DOM environment (document, URL, and Blob).',
    );
  }

  const blob = new BlobApi([htmlString == null ? '' : String(htmlString)], {
    type: 'text/html',
  });

  const objectUrl = UrlApi.createObjectURL(blob);
  try {
    const anchor = doc.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    // Appending is required by some browsers for the click to dispatch.
    if (doc.body) {
      doc.body.appendChild(anchor);
    }
    anchor.click();
    if (anchor.parentNode) {
      anchor.parentNode.removeChild(anchor);
    }
  } finally {
    // Always release the object URL — no network, no leak (_Requirements: 10.7_).
    UrlApi.revokeObjectURL(objectUrl);
  }
}
