// Manifest generator — Task 4 (Manifest 생성기 구현).
//
// This module has TWO cleanly separated layers:
//
//   1. PURE TRANSFORM (Task 4.1) — exported named functions that take an
//      in-memory representation of the scanned prompt tree and return a
//      manifest object. They never touch the filesystem, so the property
//      tests (Task 4.3) can import and exercise them directly without any I/O.
//
//   2. FILESYSTEM I/O WRAPPER (Task 4.2) — recursively scans `/prompts`, reads
//      each `.html` file into memory, feeds the entries into the pure
//      transform, stamps `version`/`generatedAt`, and writes
//      `public/manifest.json`. This runs ONLY when the module is executed
//      directly (guarded by the `import.meta.url` check at the bottom), so
//      importing it from tests does not trigger a write.
//
// Design references: design.md "manifest.json 스키마", CategoryNode/PromptRef
// typedefs, Correctness Properties 2/3/4. Requirements 2.1, 2.4, 2.5, 2.6, 2.7.
//
// Output: public/manifest.json (gitignored — it is a build artifact).

import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @typedef {{title:string, file:string, path:string}} PromptRef
 * @typedef {{name:string, path:string, prompts:PromptRef[], children:CategoryNode[]}} CategoryNode
 * @typedef {{version:number, generatedAt?:string, categories:CategoryNode[]}} Manifest
 */

/**
 * One scanned prompt file, in memory.
 *
 * @typedef {Object} FileEntry
 * @property {string} relativePath - Path relative to `/prompts`, using '/' as
 *   the separator (e.g. "backend/database/pg.html"). This is the category path
 *   source. Does NOT include a leading "prompts/".
 * @property {string} htmlString   - The raw HTML contents of the file.
 */

const MANIFEST_VERSION = 1;

// ---------------------------------------------------------------------------
// PURE TRANSFORM (Task 4.1)
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable title from a prompt HTML string.
 *
 * Extraction strategy (documented): prefer the document `<title>` text, then
 * the first `<h1>` text. If neither yields a non-empty (after trim) value, fall
 * back to the filename without its extension (_Requirements: 2.6_).
 *
 * The result is guaranteed non-empty whenever `fallbackName` (the filename
 * without extension) is non-empty — Property 4.
 *
 * This is PURE: pure regex/string work, no DOM, no I/O.
 *
 * @param {string} htmlString  - Raw HTML of the prompt file.
 * @param {string} fallbackName - Filename WITHOUT extension, used when no title
 *   can be extracted.
 * @returns {string} The extracted title, or `fallbackName` when none is found.
 */
export function extractTitle(htmlString, fallbackName) {
  const html = htmlString == null ? '' : String(htmlString);

  // 1) <title>…</title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const text = decodeBasicEntities(stripTags(titleMatch[1])).trim();
    if (text) {
      return text;
    }
  }

  // 2) first <h1>…</h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const text = decodeBasicEntities(stripTags(h1Match[1])).trim();
    if (text) {
      return text;
    }
  }

  // 3) filename without extension.
  return fallbackName;
}

/**
 * Remove any nested tags from an extracted inner-HTML fragment.
 * @param {string} fragment
 * @returns {string}
 */
function stripTags(fragment) {
  return fragment.replace(/<[^>]*>/g, '');
}

/**
 * Decode the handful of named/numeric HTML entities that commonly appear inside
 * titles so the stored title reads naturally.
 * @param {string} text
 * @returns {string}
 */
function decodeBasicEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)));
}

/**
 * @param {number} cp
 * @returns {string}
 */
function safeFromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) {
    return '';
  }
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/**
 * Return the filename (last path segment) of a '/'-separated relative path.
 * @param {string} relativePath
 * @returns {string}
 */
function baseName(relativePath) {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Strip the final `.ext` extension from a filename. If the filename has no dot
 * (or only a leading dot like `.gitignore`), the whole name is returned.
 * @param {string} filename
 * @returns {string}
 */
function stripExtension(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) {
    return filename;
  }
  return filename.slice(0, dot);
}

/**
 * Decide the depth-<=2 category path a prompt belongs to.
 *
 * The prompt's directory segments (everything except the filename) determine
 * the category. A category tree is limited to EXACTLY two levels, so:
 *   - 0 directory segments  → no category (root-level prompt). Returns [].
 *   - 1 directory segment   → 1-depth category.
 *   - >=2 directory segments → the prompt is assigned to its NEAREST 2-depth
 *     ancestor, i.e. the first TWO directory segments (_Requirements: 2.4_).
 *
 * @param {string} relativePath - e.g. "backend/database/deep/pg.html".
 * @returns {string[]} The owning category segments (length 0, 1, or 2).
 */
function categorySegmentsFor(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  const dirSegments = parts.slice(0, -1); // drop the filename
  return dirSegments.slice(0, 2); // clamp to 2-depth
}

/**
 * Build the manifest object from in-memory scanned file entries.
 *
 * PURE: no filesystem access. Only `.html` entries are included; every other
 * extension is excluded (_Requirements: 2.1_). The resulting Category_Tree is
 * at most 2 levels deep; prompts deeper than 2 directory levels are promoted to
 * their nearest 2-depth ancestor category (_Requirements: 2.4_). When no
 * includable `.html` entries exist, a valid manifest with `categories: []` is
 * returned — it never throws (_Requirements: 2.7_).
 *
 * `generatedAt` is accepted as an optional parameter so the pure layer stays
 * deterministic for tests; when omitted it is left off the object entirely and
 * the I/O layer stamps it.
 *
 * @param {FileEntry[]} fileEntries
 * @param {string} [generatedAt] - Optional ISO timestamp.
 * @returns {Manifest}
 */
export function buildManifest(fileEntries, generatedAt) {
  const entries = Array.isArray(fileEntries) ? fileEntries : [];

  /**
   * Ordered registry of category nodes keyed by their full path so repeated
   * prompts in the same folder reuse one node and ordering is stable
   * (first-seen order).
   * @type {Map<string, CategoryNode>}
   */
  const nodesByPath = new Map();
  /** @type {CategoryNode[]} */
  const roots = [];
  /** Root-level prompts (0 directory segments) have nowhere to live in a
   * folder-derived tree; they are dropped from the category tree but there is
   * no data loss relative to the spec, which models categories from folders.
   * To preserve "every .html appears exactly once" we instead attach them to a
   * conventional top-level — but the schema has no root bucket, so by design we
   * only emit folder-based categories. The property tests generate prompts with
   * >=1 directory segment, matching how `/prompts` is organised. */

  /**
   * Get or create the category node at `segments`, wiring parent/child links.
   * @param {string[]} segments
   * @returns {CategoryNode|null} null when `segments` is empty (root-level).
   */
  function ensureNode(segments) {
    if (segments.length === 0) {
      return null;
    }

    let parent = null;
    let node = null;
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const pathSegs = segments.slice(0, depth);
      const path = pathSegs.join('/');
      let current = nodesByPath.get(path);
      if (!current) {
        current = {
          name: pathSegs[pathSegs.length - 1],
          path,
          prompts: [],
          children: [],
        };
        nodesByPath.set(path, current);
        if (parent) {
          parent.children.push(current);
        } else {
          roots.push(current);
        }
      }
      parent = current;
      node = current;
    }
    return node;
  }

  for (const entry of entries) {
    if (!entry || typeof entry.relativePath !== 'string') {
      continue;
    }
    const relativePath = entry.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const filename = baseName(relativePath);

    // Only `.html` files are included (_Requirements: 2.1_).
    if (!/\.html$/i.test(filename)) {
      continue;
    }

    const categorySegments = categorySegmentsFor(relativePath);
    const node = ensureNode(categorySegments);

    const title = extractTitle(entry.htmlString, stripExtension(filename));
    /** @type {PromptRef} */
    const promptRef = {
      title,
      file: `prompts/${relativePath}`,
      path: categorySegments.join('/'),
    };

    if (node) {
      node.prompts.push(promptRef);
    } else {
      // Root-level prompt (no directory). No category bucket exists in the
      // 2-depth schema; create a synthetic 1-depth category from the filename's
      // stem so the prompt is never lost. In practice `/prompts` files live
      // under a category folder, so this path is rarely hit.
      const fallback = ensureNode([stripExtension(filename)]);
      if (fallback) {
        promptRef.path = fallback.path;
        promptRef.file = `prompts/${relativePath}`;
        fallback.prompts.push(promptRef);
      }
    }
  }

  /** @type {Manifest} */
  const manifest = {
    version: MANIFEST_VERSION,
    categories: roots,
  };
  if (generatedAt !== undefined) {
    manifest.generatedAt = generatedAt;
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// FILESYSTEM I/O WRAPPER (Task 4.2)
// ---------------------------------------------------------------------------

/**
 * Recursively scan a directory, collecting every `.html` file as a FileEntry
 * with a '/'-separated path relative to `rootDir`.
 *
 * Returns an empty array when `rootDir` does not exist or is empty, so an empty
 * or missing `/prompts` still yields a valid (empty) manifest (_Requirements:
 * 2.7_). Non-`.html` files are skipped here as well as in the pure layer.
 *
 * @param {string} rootDir  - Absolute path to the scan root (e.g. `/prompts`).
 * @returns {Promise<FileEntry[]>}
 */
export async function scanPromptTree(rootDir) {
  /** @type {FileEntry[]} */
  const entries = [];

  /**
   * @param {string} absDir
   * @param {string} relDir - '/'-separated path relative to rootDir ('' at top).
   */
  async function walk(absDir, relDir) {
    let dirents;
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // missing/unreadable directory → contribute nothing.
    }

    // Sort for deterministic output ordering.
    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      const absChild = resolve(absDir, dirent.name);
      const relChild = relDir ? `${relDir}/${dirent.name}` : dirent.name;

      if (dirent.isDirectory()) {
        await walk(absChild, relChild);
      } else if (dirent.isFile() && /\.html$/i.test(dirent.name)) {
        const htmlString = await readFile(absChild, 'utf8');
        entries.push({ relativePath: relChild, htmlString });
      }
    }
  }

  await walk(rootDir, '');
  return entries;
}

/**
 * Scan `/prompts`, build the manifest, stamp metadata, and write
 * `public/manifest.json`.
 *
 * @param {Object} [options]
 * @param {string} [options.promptsDir] - Scan root (defaults to `<root>/prompts`).
 * @param {string} [options.outputPath] - Manifest output path (defaults to
 *   `<root>/public/manifest.json`).
 * @param {string} [options.generatedAt] - ISO timestamp (defaults to now).
 * @returns {Promise<Manifest>} The written manifest object.
 */
export async function generateManifest(options = {}) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(__dirname, '..');
  const promptsDir = options.promptsDir ?? resolve(projectRoot, 'prompts');
  const outputPath = options.outputPath ?? resolve(projectRoot, 'public', 'manifest.json');
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const fileEntries = await scanPromptTree(promptsDir);
  const manifest = buildManifest(fileEntries, generatedAt);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const promptCount = countPrompts(manifest.categories);
  console.log(
    `[generate-manifest] wrote ${manifest.categories.length} categories / ${promptCount} prompts to ${outputPath}`,
  );
  return manifest;
}

/**
 * @param {CategoryNode[]} categories
 * @returns {number}
 */
function countPrompts(categories) {
  let total = 0;
  for (const cat of categories) {
    total += cat.prompts.length;
    total += countPrompts(cat.children);
  }
  return total;
}

// Only run the I/O main when executed directly (not when imported by tests).
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  generateManifest().catch((err) => {
    console.error('[generate-manifest] failed:', err);
    process.exit(1);
  });
}
