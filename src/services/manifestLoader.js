/**
 * Manifest loader & category Display_Name mapping — Task 5.
 *
 * This module has TWO cleanly separated layers:
 *
 *   1. PURE FUNCTIONS (Task 5.1) — `resolveDisplayName` and `buildDisplayTree`.
 *      They take an already-parsed Manifest and Category_Config and produce a
 *      new display-ready CategoryTree. No fetch, no DOM, no I/O, no mutation of
 *      the inputs. The property tests (Task 5.3) import and exercise these
 *      directly.
 *
 *   2. ASYNC LOADER (Task 5.2) — `loadManifest` fetches `manifest.json` and
 *      `config/category.json`, tolerates a missing/malformed category config
 *      (English fallback + a `configError` flag) WITHOUT failing the manifest
 *      load, and returns `{ok, tree?, error?, configError?}`.
 *
 * Design references: design.md "category.json 스키마", "Components → Services →
 * services/manifestLoader.js", the CategoryTree/CategoryNode/PromptRef typedefs,
 * the Error Handling table rows for Manifest/category load failures, and
 * "Correctness Properties → Property 5".
 *
 * _Requirements: 2.2, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7._
 */

/**
 * A single prompt reference inside the manifest.
 * @typedef {{title:string, file:string, path:string}} PromptRef
 */

/**
 * A category node in the display tree. `displayName` is injected by
 * `buildDisplayTree`; the raw manifest nodes do not carry it.
 * @typedef {Object} CategoryNode
 * @property {string} name              - English folder name (last path segment).
 * @property {string} path              - Root-relative category path (mapping key).
 * @property {string} [displayName]     - Resolved human-readable name (R3.2/3.3).
 * @property {PromptRef[]} prompts       - Prompts directly in this category.
 * @property {CategoryNode[]} children   - Nested (2-depth) categories.
 */

/**
 * The whole tree. `version` is carried through from the manifest.
 * @typedef {{version:number, generatedAt?:string, categories:CategoryNode[]}} CategoryTree
 */

/**
 * The category.json schema (Category_Config).
 *
 * Keys are ROOT-RELATIVE paths, so the same terminal folder name at different
 * depths maps independently (_R3.6_). Folder-level mapping takes precedence over
 * file-level mapping (_R3.7_).
 *
 *   {
 *     "folders": { "<fullPath>": "<한글>" },   // e.g. "backend/database": "데이터베이스"
 *     "files":   { "<filePath>": "<한글>" }     // e.g. "backend/spring.html": "스프링 부트"
 *   }
 *
 * @typedef {Object} CategoryConfig
 * @property {Object<string,string>} [folders] - Full-path → Display_Name for folders.
 * @property {Object<string,string>} [files]   - File-path → Display_Name for prompts.
 */

// ---------------------------------------------------------------------------
// PURE FUNCTIONS (Task 5.1)
// ---------------------------------------------------------------------------

/**
 * Resolve the Display_Name for a folder.
 *
 * Resolution rules (_R3.2, 3.3, 3.6, 3.7_):
 *   - The lookup key is the folder's FULL root-relative path (`fullPath`), so a
 *     terminal folder name shared across different full paths resolves
 *     independently (_R3.6_).
 *   - If `categoryConfig.folders[fullPath]` exists (and is a non-empty string),
 *     that 한글 Display_Name is returned. Folder-level mapping is the only
 *     mapping consulted here, so it always wins over any file-level mapping
 *     (_R3.7_ — folder precedence).
 *   - Otherwise the raw English folder name (`rawName`) is returned as the
 *     fallback (_R3.3_).
 *   - A null / empty / non-object config (or a non-object `folders`) yields the
 *     English fallback without throwing (_R3.4, 3.5_ tolerance).
 *
 * PURE: no side effects.
 *
 * @param {CategoryConfig|null|undefined} categoryConfig
 * @param {string} fullPath - Root-relative folder path (the mapping key, R3.6).
 * @param {string} rawName  - English folder name used as the fallback.
 * @returns {string} The resolved Display_Name (한글 mapping or English fallback).
 */
export function resolveDisplayName(categoryConfig, fullPath, rawName) {
  const fallback = rawName == null ? '' : String(rawName);

  if (!categoryConfig || typeof categoryConfig !== 'object') {
    return fallback;
  }

  const folders = categoryConfig.folders;
  if (!folders || typeof folders !== 'object') {
    return fallback;
  }

  const key = fullPath == null ? '' : String(fullPath);
  // Only accept own, string, non-empty mapping values. An empty/whitespace
  // mapping falls back to the English name rather than showing a blank label.
  if (Object.prototype.hasOwnProperty.call(folders, key)) {
    const mapped = folders[key];
    if (typeof mapped === 'string' && mapped.trim() !== '') {
      return mapped;
    }
  }

  return fallback;
}

/**
 * Resolve a file-level Display_Name for a prompt.
 *
 * File-level mapping is consulted ONLY for the prompt's own file path. Folder
 * precedence (_R3.7_) is a folder-vs-file concern handled at the folder level;
 * for a prompt title we simply apply the file mapping when present and fall
 * back to the manifest-provided title otherwise. This keeps the tree extensible
 * (_R3.4/3.7_) without disturbing folder resolution.
 *
 * @param {CategoryConfig|null|undefined} categoryConfig
 * @param {string} filePath   - Root-relative file path (e.g. "backend/spring.html").
 * @param {string} fallbackTitle - Manifest-provided title used when unmapped.
 * @returns {string}
 */
function resolveFileDisplayName(categoryConfig, filePath, fallbackTitle) {
  const fallback = fallbackTitle == null ? '' : String(fallbackTitle);

  if (!categoryConfig || typeof categoryConfig !== 'object') {
    return fallback;
  }
  const files = categoryConfig.files;
  if (!files || typeof files !== 'object') {
    return fallback;
  }

  const key = filePath == null ? '' : String(filePath);
  if (Object.prototype.hasOwnProperty.call(files, key)) {
    const mapped = files[key];
    if (typeof mapped === 'string' && mapped.trim() !== '') {
      return mapped;
    }
  }
  return fallback;
}

/**
 * Normalize a manifest `file` path into the root-relative key used by the
 * `files` map. Manifest PromptRef `file` is stored as "prompts/<relative>";
 * the category.json `files` keys are root-relative WITHOUT the "prompts/"
 * prefix (per design.md "backend/spring.html"). Strip a leading "prompts/".
 *
 * @param {string} file
 * @returns {string}
 */
function fileMapKey(file) {
  const f = file == null ? '' : String(file);
  return f.replace(/^prompts\//, '');
}

/**
 * Build a NEW CategoryTree with a resolved `displayName` on every category node
 * (and a resolved `displayName` on every prompt), merging the manifest with the
 * Category_Config.
 *
 * - A category node's `displayName` is resolved via `resolveDisplayName` using
 *   `node.path` as the full-path key (_R3.6_) and `node.name` as the English
 *   fallback (_R3.3_). This recurses through `children`.
 * - A prompt's `displayName` is resolved via the file-level mapping, falling
 *   back to the manifest title. The original `title` is preserved as-is.
 * - The input manifest is NOT mutated: a deep clone of the relevant structure
 *   is produced.
 * - A null/invalid manifest yields a valid empty tree (`{version, categories:[]}`),
 *   and a null/invalid config simply means every node falls back to English.
 *
 * PURE: no fetch, no DOM, no mutation of inputs.
 *
 * @param {{version?:number, generatedAt?:string, categories?:CategoryNode[]}|null|undefined} manifest
 * @param {CategoryConfig|null|undefined} categoryConfig
 * @returns {CategoryTree}
 */
export function buildDisplayTree(manifest, categoryConfig) {
  const safeManifest =
    manifest && typeof manifest === 'object' ? manifest : {};
  const categories = Array.isArray(safeManifest.categories)
    ? safeManifest.categories
    : [];

  /**
   * @param {CategoryNode} node
   * @returns {CategoryNode}
   */
  function cloneNode(node) {
    const name = node && typeof node.name === 'string' ? node.name : '';
    const path = node && typeof node.path === 'string' ? node.path : '';
    const prompts = Array.isArray(node && node.prompts) ? node.prompts : [];
    const children = Array.isArray(node && node.children) ? node.children : [];

    return {
      name,
      path,
      displayName: resolveDisplayName(categoryConfig, path, name),
      prompts: prompts.map((p) => clonePrompt(p)),
      children: children.map((c) => cloneNode(c)),
    };
  }

  /**
   * @param {PromptRef} prompt
   * @returns {PromptRef & {displayName:string}}
   */
  function clonePrompt(prompt) {
    const title =
      prompt && typeof prompt.title === 'string' ? prompt.title : '';
    const file = prompt && typeof prompt.file === 'string' ? prompt.file : '';
    const path = prompt && typeof prompt.path === 'string' ? prompt.path : '';
    return {
      title,
      file,
      path,
      displayName: resolveFileDisplayName(categoryConfig, fileMapKey(file), title),
    };
  }

  /** @type {CategoryTree} */
  const tree = {
    version:
      typeof safeManifest.version === 'number' ? safeManifest.version : 1,
    categories: categories.map((c) => cloneNode(c)),
  };
  if (typeof safeManifest.generatedAt === 'string') {
    tree.generatedAt = safeManifest.generatedAt;
  }
  return tree;
}

// ---------------------------------------------------------------------------
// ASYNC LOADER (Task 5.2)
// ---------------------------------------------------------------------------

/**
 * Fetch and parse the manifest and category config, then build the display
 * tree.
 *
 * Behavior (_R2.2, 2.8, 3.1, 3.4, 3.5_):
 *   - Fetches `manifest.json` at the URL built from `resolveUrl(baseUrl, …)`.
 *     On a failed response, a thrown fetch error, or a JSON parse error, returns
 *     `{ ok:false, error }` so the app can stay running and notify the user
 *     (_R2.8_). The manifest is required for a tree.
 *   - Fetches `config/category.json`. If it is MISSING (non-OK response, e.g.
 *     404) OR malformed JSON, this does NOT throw and does NOT prevent the
 *     manifest from loading: the tree is built with NO mapping (English
 *     fallback) and a `configError` message is set so the UI can surface a
 *     mapping-load error (_R3.4, 3.5_).
 *   - On success returns `{ ok:true, tree }` where `tree =
 *     buildDisplayTree(manifest, configOrNull)`, plus `configError` when the
 *     category config was missing/malformed.
 *
 * `fetchImpl` and `resolveUrl` are injectable so tests can stub them without
 * touching the network. `resolveUrl` defaults to identity (treat the given
 * relative paths as the fetch URLs) and `baseUrl` defaults to the root.
 *
 * @param {(baseUrl:string, relativePath:string)=>string} [resolveUrl]
 *   URL builder (e.g. the pure `resolveUrl` from utils/path.js). Defaults to a
 *   simple join so the loader is usable without wiring.
 * @param {Object} [options]
 * @param {string} [options.baseUrl='/']      - Base_URL passed to `resolveUrl`.
 * @param {typeof fetch} [options.fetchImpl]  - Injectable fetch (defaults to
 *   `globalThis.fetch`).
 * @param {string} [options.manifestPath='manifest.json']
 * @param {string} [options.categoryPath='config/category.json']
 * @returns {Promise<{ok:boolean, tree?:CategoryTree, error?:string, configError?:string}>}
 */
export async function loadManifest(resolveUrl, options = {}) {
  const {
    baseUrl = '/',
    fetchImpl = (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined),
    manifestPath = 'manifest.json',
    categoryPath = 'config/category.json',
  } = options;

  const buildUrl =
    typeof resolveUrl === 'function'
      ? resolveUrl
      : (base, rel) => `${base}${rel}`;

  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch is not available in this environment' };
  }

  // --- 1) Manifest (required) ---------------------------------------------
  let manifest;
  try {
    const manifestUrl = buildUrl(baseUrl, manifestPath);
    const res = await fetchImpl(manifestUrl);
    if (!res || !res.ok) {
      const status = res && typeof res.status === 'number' ? res.status : '?';
      return { ok: false, error: `Manifest 로드 실패 (HTTP ${status})` };
    }
    manifest = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: `Manifest 로드 실패: ${errorMessage(err)}`,
    };
  }

  // --- 2) Category config (optional, English fallback on failure) ---------
  let categoryConfig = null;
  let configError;
  try {
    const categoryUrl = buildUrl(baseUrl, categoryPath);
    const res = await fetchImpl(categoryUrl);
    if (!res || !res.ok) {
      const status = res && typeof res.status === 'number' ? res.status : '?';
      configError = `Category_Config 로드 실패 (HTTP ${status}) — 영문명으로 표시합니다`;
    } else {
      try {
        categoryConfig = await res.json();
      } catch (parseErr) {
        categoryConfig = null;
        configError = `Category_Config 파싱 실패 — 영문명으로 표시합니다 (${errorMessage(parseErr)})`;
      }
    }
  } catch (err) {
    // A missing config must never prevent the manifest from loading (_R3.4_).
    categoryConfig = null;
    configError = `Category_Config 로드 실패 — 영문명으로 표시합니다 (${errorMessage(err)})`;
  }

  const tree = buildDisplayTree(manifest, categoryConfig);

  /** @type {{ok:boolean, tree:CategoryTree, configError?:string}} */
  const result = { ok: true, tree };
  if (configError) {
    result.configError = configError;
  }
  return result;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  if (err && typeof err === 'object' && 'message' in err) {
    return String(/** @type {{message:unknown}} */ (err).message);
  }
  return String(err);
}
