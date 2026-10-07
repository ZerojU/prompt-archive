/**
 * Pure path / Base_URL utilities.
 *
 * These functions let the Archive_App resolve every internal resource path
 * (scripts, styles, prompt data, manifest, ...) against a runtime-computed
 * Base_URL instead of a hardcoded domain/host. This keeps the app working
 * identically on a GitHub Pages project page sub-path (`/repo/`), a user page
 * root (`/`), and local development (`localhost/`).
 *
 * Both functions are PURE: no DOM access, no globals, no side effects. The Vite
 * base (normally read from `import.meta.env.BASE_URL`) is passed in as an
 * argument so the logic stays fully testable.
 *
 * _Requirements: 1.5 (compute Base_URL at runtime, no hardcoded absolute paths),
 *                1.6 (project page sub-path `/repo/`),
 *                1.7 (user page / local root `/`)._
 *
 * Normalization convention (documented, enforced by `computeBaseUrl`):
 *   - A normalized Base_URL ALWAYS ends with exactly one trailing slash.
 *   - Duplicate slashes inside the path are collapsed to a single `/`.
 *   - A relative local base (`./` or `.`) is preserved as `./` so Vite's
 *     relative-asset mode keeps working.
 *   - Empty / nullish / `/` all normalize to the root `/`.
 */

/**
 * Collapse any run of two or more `/` into a single `/`.
 *
 * Internal resource paths are relative (never contain a `scheme://` authority),
 * so a blanket collapse is safe here and intentionally kept simple.
 *
 * @param {string} value
 * @returns {string}
 */
function collapseSlashes(value) {
  return value.replace(/\/{2,}/g, '/');
}

/**
 * Normalize a Vite base URL into a canonical Base_URL.
 *
 * Handles inputs such as `/`, `./`, `/repo/`, `/repo`, `repo`, `''`, and values
 * with duplicate slashes. The result always ends with exactly one trailing
 * slash. The relative local base (`./`) is preserved so it is NOT rewritten to
 * an absolute root (which would break relative asset loading in local/dev).
 *
 * No domain or host is ever introduced (Requirements 1.5, 1.6, 1.7).
 *
 * @param {string} viteBaseUrl - e.g. `import.meta.env.BASE_URL`.
 * @returns {string} Normalized Base_URL ending with a single `/`.
 */
export function computeBaseUrl(viteBaseUrl) {
  // Empty / nullish → root.
  if (viteBaseUrl == null || viteBaseUrl === '') {
    return '/';
  }

  const trimmed = String(viteBaseUrl).trim();

  if (trimmed === '' || trimmed === '/') {
    return '/';
  }

  // Preserve the relative local base. `.` and `./` (with any trailing slashes)
  // all canonicalize to `./`.
  if (/^\.\/*$/.test(trimmed)) {
    return './';
  }

  // Collapse duplicate slashes everywhere in the path.
  let result = collapseSlashes(trimmed);

  // Ensure exactly one trailing slash.
  if (!result.endsWith('/')) {
    result += '/';
  }

  return result;
}

/**
 * Join a normalized Base_URL with an internal relative resource path.
 *
 * The relative path is treated as internal (never an absolute URL with a
 * `scheme://` authority), so slashes are collapsed freely in the joined path.
 * The result ALWAYS begins with the normalized base and contains no duplicate
 * `//` sequences in the path portion. No domain/host is introduced
 * (Requirements 1.5, 1.6, 1.7).
 *
 * @param {string} baseUrl - A normalized Base_URL (ideally from `computeBaseUrl`).
 * @param {string} relativePath - Internal relative resource path, e.g.
 *                                 `prompts/x.html` or `/manifest.json`.
 * @returns {string} The combined, slash-collapsed path beginning with the base.
 */
export function resolveUrl(baseUrl, relativePath) {
  // Normalize the base defensively so callers may pass a raw Vite base too.
  const base = computeBaseUrl(baseUrl);
  const rel = relativePath == null ? '' : String(relativePath);

  // Simple concatenation then collapse duplicate slashes. Because `base` ends
  // with `/`, a leading `/` on `rel` just becomes a single `/` after collapse.
  const joined = collapseSlashes(base + rel);

  return joined;
}
