import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildManifest,
  extractTitle,
} from '../scripts/generate-manifest.js';

/**
 * Property tests for the PURE transform layer of the Manifest generator
 * (`buildManifest`, `extractTitle`). These import ONLY the pure functions, so
 * no filesystem access occurs.
 *
 * Property 2 (Manifest는 .html 파일만 포함) — Requirements 2.1
 * Property 3 (2단계 상한 및 깊은 파일 승격) — Requirements 2.4
 * Property 4 (제목 추출의 파일명 폴백) — Requirements 2.6
 *
 * **Validates: Requirements 2.1, 2.4, 2.6**
 */

const NUM_RUNS = 100;

// --- Generators -------------------------------------------------------------

/** A path-safe directory/file stem segment. */
const segmentArb = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);

/** An extension, biased toward .html but including others to exercise filtering. */
const extensionArb = fc.constantFrom('html', 'html', 'html', 'txt', 'md', 'json', 'css', 'js', 'png');

/**
 * A realistic relative path like "backend/spring.html" or
 * "a/b/c/deep.html": 1..5 directory segments plus a filename.ext. Directory
 * depth is intentionally allowed beyond 2 so the promotion rule is exercised.
 */
const fileEntryPathArb = fc
  .record({
    dirs: fc.array(segmentArb, { minLength: 1, maxLength: 5 }),
    name: segmentArb,
    ext: extensionArb,
  })
  .map(({ dirs, name, ext }) => `${dirs.join('/')}/${name}.${ext}`);

/** An HTML string that may or may not carry an extractable <title>. */
const htmlArb = fc.oneof(
  fc
    .stringMatching(/^[A-Za-z0-9 ]{1,20}$/)
    .map((t) => `<!DOCTYPE html><html><head><title>${t}</title></head><body><p>x</p></body></html>`),
  fc.constant('<!DOCTYPE html><html><head></head><body><p>no title here</p></body></html>'),
  fc.constant('<html><body>bare</body></html>'),
);

/** A FileEntry whose path may collide; buildManifest must dedupe folders. */
const fileEntryArb = fc.record({
  relativePath: fileEntryPathArb,
  htmlString: htmlArb,
});

const fileEntriesArb = fc.array(fileEntryArb, { minLength: 0, maxLength: 20 });

// --- Helpers ----------------------------------------------------------------

/**
 * Collect every prompt `file` across the whole category tree.
 * @param {import('../scripts/generate-manifest.js').CategoryNode[]} categories
 * @returns {string[]}
 */
function collectPromptFiles(categories) {
  const files = [];
  for (const cat of categories) {
    for (const p of cat.prompts) {
      files.push(p.file);
    }
    files.push(...collectPromptFiles(cat.children));
  }
  return files;
}

/**
 * Collect every prompt ref across the tree.
 * @param {import('../scripts/generate-manifest.js').CategoryNode[]} categories
 */
function collectPrompts(categories) {
  const prompts = [];
  for (const cat of categories) {
    for (const p of cat.prompts) {
      prompts.push({ prompt: p, categoryPath: cat.path });
    }
    prompts.push(...collectPrompts(cat.children));
  }
  return prompts;
}

/**
 * Maximum category depth in the tree (1-based). 0 for an empty tree.
 * @param {import('../scripts/generate-manifest.js').CategoryNode[]} categories
 * @param {number} depth
 * @returns {number}
 */
function maxDepth(categories, depth = 1) {
  let max = 0;
  for (const cat of categories) {
    max = Math.max(max, depth);
    max = Math.max(max, maxDepth(cat.children, depth + 1));
  }
  return max;
}

const isHtml = (file) => /\.html$/i.test(file);

// --- Property 2 -------------------------------------------------------------

describe('buildManifest — Property 2: Manifest는 .html 파일만 포함', () => {
  it('every prompt entry points to a .html file; every input .html appears exactly once; no non-.html appears', () => {
    fc.assert(
      fc.property(fileEntriesArb, (entries) => {
        const manifest = buildManifest(entries, '2026-01-01T00:00:00.000Z');
        const emittedFiles = collectPromptFiles(manifest.categories);

        // Every emitted prompt points to a .html file.
        for (const file of emittedFiles) {
          expect(isHtml(file)).toBe(true);
        }

        // Expected set: input .html files, normalized to "prompts/<relativePath>".
        const inputHtml = entries
          .filter((e) => isHtml(e.relativePath))
          .map((e) => `prompts/${e.relativePath}`);

        // Each input .html appears exactly once (count-preserving, including dups).
        const sortedEmitted = [...emittedFiles].sort();
        const sortedExpected = [...inputHtml].sort();
        expect(sortedEmitted).toEqual(sortedExpected);

        // No non-.html file appears.
        const inputNonHtml = entries.filter((e) => !isHtml(e.relativePath));
        for (const e of inputNonHtml) {
          expect(emittedFiles).not.toContain(`prompts/${e.relativePath}`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 3 -------------------------------------------------------------

describe('buildManifest — Property 3: 2단계 상한 및 깊은 파일 승격', () => {
  it('no emitted category exceeds depth 2, and every input .html prompt is present exactly once under a depth<=2 category', () => {
    fc.assert(
      fc.property(fileEntriesArb, (entries) => {
        const manifest = buildManifest(entries, '2026-01-01T00:00:00.000Z');

        // No category deeper than depth 2.
        expect(maxDepth(manifest.categories)).toBeLessThanOrEqual(2);

        // No category node's path has more than 2 segments.
        const prompts = collectPrompts(manifest.categories);
        for (const { categoryPath } of prompts) {
          const segs = categoryPath.split('/').filter(Boolean);
          expect(segs.length).toBeLessThanOrEqual(2);
        }

        // No loss: every input .html present exactly once.
        const emittedFiles = collectPromptFiles(manifest.categories);
        const inputHtml = entries
          .filter((e) => isHtml(e.relativePath))
          .map((e) => `prompts/${e.relativePath}`);
        expect([...emittedFiles].sort()).toEqual([...inputHtml].sort());

        // Each prompt is assigned to its nearest 2-depth ancestor: the owning
        // category path must be a prefix of the prompt's directory segments.
        for (const { prompt, categoryPath } of prompts) {
          const rel = prompt.file.replace(/^prompts\//, '');
          const dirSegs = rel.split('/').filter(Boolean).slice(0, -1);
          const expected = dirSegs.slice(0, 2).join('/');
          expect(categoryPath).toBe(expected);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 4 -------------------------------------------------------------

describe('extractTitle — Property 4: 제목 추출의 파일명 폴백', () => {
  it('uses extracted title when present, else filename-without-extension, and is never empty for a non-empty fallback', () => {
    fc.assert(
      fc.property(
        fc.option(fc.stringMatching(/^[A-Za-z0-9 ]{1,20}$/), { nil: null }),
        segmentArb,
        (titleText, fallbackName) => {
          const html =
            titleText !== null && titleText.trim() !== ''
              ? `<!DOCTYPE html><html><head><title>${titleText}</title></head><body></body></html>`
              : `<!DOCTYPE html><html><head></head><body><p>content</p></body></html>`;

          const result = extractTitle(html, fallbackName);

          if (titleText !== null && titleText.trim() !== '') {
            expect(result).toBe(titleText.trim());
          } else {
            expect(result).toBe(fallbackName);
          }

          // Non-empty fallback → non-empty result.
          expect(result.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Concrete example trees -------------------------------------------------

describe('buildManifest — concrete examples', () => {
  it('a 3-level-deep .html is promoted to its nearest 2-depth category', () => {
    const manifest = buildManifest(
      [{ relativePath: 'a/b/c/deep.html', htmlString: '<title>Deep</title>' }],
      '2026-01-01T00:00:00.000Z',
    );
    expect(maxDepth(manifest.categories)).toBe(2);
    const prompts = collectPrompts(manifest.categories);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].categoryPath).toBe('a/b');
    expect(prompts[0].prompt.file).toBe('prompts/a/b/c/deep.html');
    expect(prompts[0].prompt.title).toBe('Deep');
  });

  it('a .txt file is excluded', () => {
    const manifest = buildManifest(
      [
        { relativePath: 'backend/spring.html', htmlString: '<title>Spring</title>' },
        { relativePath: 'backend/notes.txt', htmlString: 'ignored' },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    const files = collectPromptFiles(manifest.categories);
    expect(files).toEqual(['prompts/backend/spring.html']);
  });

  it('empty tree → empty categories (valid, no throw)', () => {
    const manifest = buildManifest([], '2026-01-01T00:00:00.000Z');
    expect(manifest.categories).toEqual([]);
    expect(manifest.version).toBe(1);
    expect(manifest.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('nested two-level tree keeps parent prompts and child category', () => {
    const manifest = buildManifest(
      [
        { relativePath: 'backend/spring.html', htmlString: '<title>Spring Boot 설정</title>' },
        { relativePath: 'backend/database/pg.html', htmlString: '<title>PostgreSQL 튜닝</title>' },
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(manifest.categories).toHaveLength(1);
    const backend = manifest.categories[0];
    expect(backend.name).toBe('backend');
    expect(backend.path).toBe('backend');
    expect(backend.prompts.map((p) => p.file)).toEqual(['prompts/backend/spring.html']);
    expect(backend.children).toHaveLength(1);
    expect(backend.children[0].path).toBe('backend/database');
    expect(backend.children[0].prompts[0].title).toBe('PostgreSQL 튜닝');
  });

  it('falls back to filename without extension when no title/h1 is extractable', () => {
    const manifest = buildManifest(
      [{ relativePath: 'frontend/react-hooks.html', htmlString: '<html><body>no title</body></html>' }],
      '2026-01-01T00:00:00.000Z',
    );
    const prompts = collectPrompts(manifest.categories);
    expect(prompts[0].prompt.title).toBe('react-hooks');
  });

  it('uses first <h1> when <title> is absent', () => {
    const title = extractTitle('<html><body><h1>Heading Title</h1></body></html>', 'fallback');
    expect(title).toBe('Heading Title');
  });
});
