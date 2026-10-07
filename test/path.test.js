import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeBaseUrl, resolveUrl } from '../src/utils/path.js';

/**
 * Tests for the pure Base_URL path utilities.
 *
 * Property 1 (Base_URL 경로 해석 일관성) is validated with fast-check across at
 * least 100 runs, plus a few concrete example-based assertions for the key
 * deployment shapes.
 *
 * **Validates: Requirements 1.5, 1.6, 1.7**
 */

const NUM_RUNS = 100;

// Hardcoded-domain markers that must never appear in a resolved internal path.
const DOMAIN_MARKERS = ['http://', 'https://', 'github.io'];

/**
 * Arbitrary for a Base_URL input covering the deployment shapes from the spec:
 *   - root `/` (user page / local root — Requirement 1.7)
 *   - `./` relative local base
 *   - `/repo/` and `/repo` project page sub-path (Requirement 1.6)
 *   - generated repo-name segment paths (e.g. `/a/b/`), with occasional
 *     duplicate slashes to exercise normalization.
 */
const baseArb = fc.oneof(
  fc.constant('/'),
  fc.constant('./'),
  fc.constant('/repo/'),
  fc.constant('/repo'),
  fc.constant(''),
  fc
    .array(
      fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/),
      { minLength: 1, maxLength: 3 },
    )
    .map((segments) => {
      // Randomly build a base path; keep it leading-slash so it is a sub-path.
      const joined = segments.join('/');
      return '/' + joined + '/';
    }),
);

/**
 * Arbitrary for an internal relative resource path. Segments are safe path
 * tokens; we optionally prepend a leading slash and inject stray duplicate
 * slashes so the collapse behaviour is exercised. Never produces a scheme.
 */
const relativePathArb = fc
  .record({
    segments: fc.array(fc.stringMatching(/^[a-zA-Z0-9_.-]{1,12}$/), {
      minLength: 1,
      maxLength: 4,
    }),
    leadingSlash: fc.boolean(),
    extraSlashes: fc.boolean(),
  })
  .map(({ segments, leadingSlash, extraSlashes }) => {
    const sep = extraSlashes ? '//' : '/';
    let path = segments.join(sep);
    if (leadingSlash) {
      path = '/' + path;
    }
    return path;
  });

describe('computeBaseUrl', () => {
  it('normalizes the key deployment shapes', () => {
    // User page / local root and empty → root.
    expect(computeBaseUrl('/')).toBe('/');
    expect(computeBaseUrl('')).toBe('/');
    expect(computeBaseUrl(undefined)).toBe('/');
    expect(computeBaseUrl(null)).toBe('/');

    // Relative local base is preserved.
    expect(computeBaseUrl('./')).toBe('./');
    expect(computeBaseUrl('.')).toBe('./');

    // Project page sub-path: with and without trailing slash → single trailing.
    expect(computeBaseUrl('/repo/')).toBe('/repo/');
    expect(computeBaseUrl('/repo')).toBe('/repo/');

    // Duplicate slashes collapse.
    expect(computeBaseUrl('/repo//sub///')).toBe('/repo/sub/');
  });

  it('always ends with exactly one trailing slash and has no duplicate slashes', () => {
    fc.assert(
      fc.property(baseArb, (base) => {
        const normalized = computeBaseUrl(base);
        expect(normalized.endsWith('/')).toBe(true);
        // No duplicate slashes anywhere in the normalized base.
        expect(normalized.includes('//')).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('resolveUrl — Property 1: Base_URL 경로 해석 일관성', () => {
  it('result starts with the normalized base, has no domain, and no duplicate slashes', () => {
    fc.assert(
      fc.property(baseArb, relativePathArb, (base, relPath) => {
        const normalizedBase = computeBaseUrl(base);
        const result = resolveUrl(normalizedBase, relPath);

        // (a) Always begins with the normalized base prefix.
        expect(result.startsWith(normalizedBase)).toBe(true);

        // (b) No hardcoded domain / host / scheme.
        for (const marker of DOMAIN_MARKERS) {
          expect(result.includes(marker)).toBe(false);
        }

        // (c) No duplicate-slash `//` in the resolved path.
        expect(result.includes('//')).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is robust when passed a raw (un-normalized) base as well', () => {
    fc.assert(
      fc.property(baseArb, relativePathArb, (base, relPath) => {
        // resolveUrl normalizes internally, so passing the raw base must also
        // begin with the normalized base and stay slash-collapsed/domain-free.
        const normalizedBase = computeBaseUrl(base);
        const result = resolveUrl(base, relPath);

        expect(result.startsWith(normalizedBase)).toBe(true);
        expect(result.includes('//')).toBe(false);
        for (const marker of DOMAIN_MARKERS) {
          expect(result.includes(marker)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('resolveUrl — concrete key cases', () => {
  it('project page `/repo/` resolves internal resources under the sub-path', () => {
    const base = computeBaseUrl('/repo/');
    expect(resolveUrl(base, 'manifest.json')).toBe('/repo/manifest.json');
    expect(resolveUrl(base, 'prompts/backend/spring.html')).toBe(
      '/repo/prompts/backend/spring.html',
    );
    // Leading slash on the relative path does not create `//`.
    expect(resolveUrl(base, '/manifest.json')).toBe('/repo/manifest.json');
  });

  it('user page root `/` resolves internal resources at the root', () => {
    const base = computeBaseUrl('/');
    expect(resolveUrl(base, 'manifest.json')).toBe('/manifest.json');
    expect(resolveUrl(base, '/manifest.json')).toBe('/manifest.json');
    expect(resolveUrl(base, 'prompts/x.html')).toBe('/prompts/x.html');
  });

  it('local relative base `./` keeps paths relative without a domain', () => {
    const base = computeBaseUrl('./');
    expect(resolveUrl(base, 'manifest.json')).toBe('./manifest.json');
    expect(resolveUrl(base, 'prompts/x.html')).toBe('./prompts/x.html');
    expect(resolveUrl(base, '/manifest.json')).toBe('./manifest.json');
  });
});
