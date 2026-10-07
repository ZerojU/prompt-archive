import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveDisplayName,
  buildDisplayTree,
  loadManifest,
} from '../src/services/manifestLoader.js';

/**
 * Tests for the manifest loader & category Display_Name mapping (Task 5).
 *
 * Property 5 (Display_Name 해석: 폴더 우선 · 전체경로 키 · 영문 폴백) is validated with
 * fast-check across >=100 runs, plus concrete examples. The async loader
 * (Task 5.2) is covered with stubbed fetch (no network) for manifest success,
 * manifest failure, missing category.json (404), and malformed category.json.
 *
 * **Validates: Requirements 3.2, 3.3, 3.6, 3.7** (plus 2.2, 2.8, 3.1, 3.4, 3.5
 * for the async loader cases).
 */

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Property 5 — resolveDisplayName
// ---------------------------------------------------------------------------

/** Arbitrary for an English-ish folder name (ASCII, non-empty). */
const folderNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,10}$/);

/** Arbitrary for a full root-relative path of 1..3 folder segments. */
const fullPathArb = fc
  .array(folderNameArb, { minLength: 1, maxLength: 3 })
  .map((segs) => segs.join('/'));

/** Arbitrary for a non-empty 한글 display name. */
const koreanNameArb = fc
  .array(fc.integer({ min: 0xac00, max: 0xd7a3 }), { minLength: 1, maxLength: 6 })
  .map((cps) => String.fromCodePoint(...cps));

describe('resolveDisplayName — Property 5: 폴더 우선 · 전체경로 키 · 영문 폴백', () => {
  it('returns the folder mapping when the full path is mapped', () => {
    fc.assert(
      fc.property(fullPathArb, koreanNameArb, folderNameArb, (fullPath, korean, rawName) => {
        const config = { folders: { [fullPath]: korean } };
        expect(resolveDisplayName(config, fullPath, rawName)).toBe(korean);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('folder mapping wins even when a file mapping also exists (R3.7)', () => {
    fc.assert(
      fc.property(fullPathArb, koreanNameArb, koreanNameArb, folderNameArb, (fullPath, folderKo, fileKo, rawName) => {
        const config = {
          folders: { [fullPath]: folderKo },
          files: { [fullPath]: fileKo, [`${fullPath}.html`]: fileKo },
        };
        // resolveDisplayName is the FOLDER resolver — it must consult folders only.
        expect(resolveDisplayName(config, fullPath, rawName)).toBe(folderKo);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the English raw name when no folder mapping exists (R3.3)', () => {
    fc.assert(
      fc.property(fullPathArb, folderNameArb, (fullPath, rawName) => {
        // Config maps a DIFFERENT path, so this one is unmapped.
        const config = { folders: { [`${fullPath}/other-unlikely-key`]: '다름' } };
        expect(resolveDisplayName(config, fullPath, rawName)).toBe(rawName);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves independently per full path even with a shared terminal folder name (R3.6)', () => {
    fc.assert(
      fc.property(
        folderNameArb,
        folderNameArb,
        folderNameArb,
        koreanNameArb,
        koreanNameArb,
        (parentA, parentB, terminal, koA, koB) => {
          fc.pre(parentA !== parentB);
          const pathA = `${parentA}/${terminal}`;
          const pathB = `${parentB}/${terminal}`;
          const config = { folders: { [pathA]: koA, [pathB]: koB } };
          // Same terminal folder name `terminal`, but each full path resolves
          // to its own mapping.
          expect(resolveDisplayName(config, pathA, terminal)).toBe(koA);
          expect(resolveDisplayName(config, pathB, terminal)).toBe(koB);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('tolerates null/empty/invalid configs by returning the English fallback', () => {
    for (const bad of [null, undefined, {}, { folders: null }, { folders: 42 }, 'nope', 7]) {
      expect(resolveDisplayName(bad, 'backend', 'backend')).toBe('backend');
    }
    // Empty-string mapping also falls back rather than showing a blank label.
    expect(resolveDisplayName({ folders: { backend: '' } }, 'backend', 'backend')).toBe('backend');
  });
});

describe('resolveDisplayName — concrete cases', () => {
  const config = {
    folders: { backend: '백엔드', 'backend/database': '데이터베이스' },
    files: { 'backend/spring.html': '스프링' },
  };

  it('resolves a 1-depth folder', () => {
    expect(resolveDisplayName(config, 'backend', 'backend')).toBe('백엔드');
  });

  it('resolves a nested 2-depth folder by full path', () => {
    expect(resolveDisplayName(config, 'backend/database', 'database')).toBe('데이터베이스');
  });

  it('falls back to English for an unmapped folder', () => {
    expect(resolveDisplayName(config, 'frontend', 'frontend')).toBe('frontend');
  });

  it('same terminal name "database" at two different full paths resolves independently', () => {
    const cfg = {
      folders: {
        'backend/database': '백엔드-DB',
        'analytics/database': '분석-DB',
      },
    };
    expect(resolveDisplayName(cfg, 'backend/database', 'database')).toBe('백엔드-DB');
    expect(resolveDisplayName(cfg, 'analytics/database', 'database')).toBe('분석-DB');
  });

  it('folder mapping wins over a present file mapping for the same key', () => {
    const cfg = {
      folders: { 'backend/spring.html': '폴더-우선' },
      files: { 'backend/spring.html': '파일-매핑' },
    };
    expect(resolveDisplayName(cfg, 'backend/spring.html', 'spring.html')).toBe('폴더-우선');
  });
});

// ---------------------------------------------------------------------------
// buildDisplayTree
// ---------------------------------------------------------------------------

const sampleManifest = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  categories: [
    {
      name: 'backend',
      path: 'backend',
      prompts: [{ title: 'Spring Boot 설정', file: 'prompts/backend/spring.html', path: 'backend' }],
      children: [
        {
          name: 'database',
          path: 'backend/database',
          prompts: [{ title: 'PG 튜닝', file: 'prompts/backend/database/pg.html', path: 'backend/database' }],
          children: [],
        },
      ],
    },
    {
      name: 'frontend',
      path: 'frontend',
      prompts: [{ title: 'React Hooks', file: 'prompts/frontend/react-hooks.html', path: 'frontend' }],
      children: [],
    },
  ],
};

describe('buildDisplayTree', () => {
  it('injects displayName on every node (nested) and falls back to English when unmapped', () => {
    const config = { folders: { backend: '백엔드', 'backend/database': '데이터베이스' } };
    const tree = buildDisplayTree(sampleManifest, config);

    expect(tree.version).toBe(1);
    expect(tree.generatedAt).toBe('2026-01-01T00:00:00.000Z');

    const backend = tree.categories.find((c) => c.path === 'backend');
    expect(backend.displayName).toBe('백엔드');

    const database = backend.children.find((c) => c.path === 'backend/database');
    expect(database.displayName).toBe('데이터베이스');

    const frontend = tree.categories.find((c) => c.path === 'frontend');
    expect(frontend.displayName).toBe('frontend'); // unmapped → English fallback
  });

  it('applies file-level display names to prompts, folder-resolution unaffected', () => {
    const config = {
      folders: { backend: '백엔드' },
      files: { 'backend/spring.html': '스프링 부트' },
    };
    const tree = buildDisplayTree(sampleManifest, config);
    const backend = tree.categories.find((c) => c.path === 'backend');
    const spring = backend.prompts[0];
    expect(spring.displayName).toBe('스프링 부트');
    expect(spring.title).toBe('Spring Boot 설정'); // original title preserved
  });

  it('does not mutate the input manifest', () => {
    const snapshot = JSON.parse(JSON.stringify(sampleManifest));
    buildDisplayTree(sampleManifest, { folders: { backend: '백엔드' } });
    expect(sampleManifest).toEqual(snapshot);
    expect('displayName' in sampleManifest.categories[0]).toBe(false);
  });

  it('yields a valid empty tree for a null/invalid manifest', () => {
    expect(buildDisplayTree(null, null)).toEqual({ version: 1, categories: [] });
    expect(buildDisplayTree({}, null)).toEqual({ version: 1, categories: [] });
  });

  it('falls back to all-English when config is null/malformed', () => {
    const tree = buildDisplayTree(sampleManifest, null);
    expect(tree.categories.find((c) => c.path === 'backend').displayName).toBe('backend');
    expect(tree.categories.find((c) => c.path === 'frontend').displayName).toBe('frontend');
  });
});

// ---------------------------------------------------------------------------
// loadManifest — async, stubbed fetch (no network)
// ---------------------------------------------------------------------------

/** Minimal Response-like stub. */
function okJson(data) {
  return { ok: true, status: 200, json: async () => data };
}
function notFound() {
  return { ok: false, status: 404, json: async () => ({}) };
}
function okBadJson() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token in JSON');
    },
  };
}

/** Build a fetch stub that dispatches by URL substring. */
function makeFetch({ manifest, category }) {
  return async (url) => {
    const u = String(url);
    if (u.includes('manifest.json')) {
      if (manifest instanceof Error) throw manifest;
      return manifest;
    }
    if (u.includes('category.json')) {
      if (category instanceof Error) throw category;
      return category;
    }
    return notFound();
  };
}

const identityResolve = (base, rel) => `${base}${rel}`;

describe('loadManifest — async (stubbed fetch)', () => {
  it('manifest load success builds a display tree with mapping (R2.2, 3.1, 3.2)', async () => {
    const fetchImpl = makeFetch({
      manifest: okJson(sampleManifest),
      category: okJson({ folders: { backend: '백엔드', 'backend/database': '데이터베이스' } }),
    });
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.configError).toBeUndefined();
    const backend = result.tree.categories.find((c) => c.path === 'backend');
    expect(backend.displayName).toBe('백엔드');
    expect(backend.children[0].displayName).toBe('데이터베이스');
  });

  it('manifest fetch failure → {ok:false} (R2.8)', async () => {
    const fetchImpl = makeFetch({
      manifest: new Error('network down'),
      category: okJson({}),
    });
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.tree).toBeUndefined();
    expect(result.error).toMatch(/Manifest 로드 실패/);
  });

  it('manifest non-OK response → {ok:false} (R2.8)', async () => {
    const fetchImpl = makeFetch({ manifest: notFound(), category: okJson({}) });
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 404/);
  });

  it('category.json missing (404) → ok:true with English fallback + configError (R3.4)', async () => {
    const fetchImpl = makeFetch({
      manifest: okJson(sampleManifest),
      category: notFound(),
    });
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.configError).toBeTruthy();
    // English fallback since config was unavailable.
    expect(result.tree.categories.find((c) => c.path === 'backend').displayName).toBe('backend');
  });

  it('category.json malformed JSON → ok:true with English fallback + configError (R3.5)', async () => {
    const fetchImpl = makeFetch({
      manifest: okJson(sampleManifest),
      category: okBadJson(),
    });
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.configError).toMatch(/파싱 실패/);
    expect(result.tree.categories.find((c) => c.path === 'frontend').displayName).toBe('frontend');
  });

  it('category.json fetch throws → ok:true with English fallback + configError (R3.4)', async () => {
    const fetchImpl = makeFetch({
      manifest: okJson(sampleManifest),
      category: new Error('conn reset'),
    });
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.configError).toBeTruthy();
    expect(result.tree.categories.find((c) => c.path === 'backend').displayName).toBe('backend');
  });

  it('returns ok:false when fetch is unavailable', async () => {
    const result = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl: undefined });
    // Default fetchImpl falls back to globalThis.fetch; force unavailable by passing null.
    const forced = await loadManifest(identityResolve, { baseUrl: '/', fetchImpl: null });
    expect(forced.ok).toBe(false);
    // result may be ok/false depending on env; just assert it resolves.
    expect(typeof result.ok).toBe('boolean');
  });
});
