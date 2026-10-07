import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { extractPromptContent, loadPrompt } from '../src/services/promptLoader.js';

/**
 * Tests for the prompt loader & content extraction (Task 7).
 *
 * Property 6 (Prompt_Content 추출: 권장 구조 우선, 없으면 body) is validated with
 * fast-check across >=100 runs, plus concrete examples. The async loader
 * (Task 7.2) is covered with stubbed fetch (no network): success returns
 * sanitized content + rawHtml, a <script> is sanitized out of content but kept
 * in rawHtml, 404/non-OK → {ok:false}, timeout → {ok:false}, and empty content
 * → {ok:true, empty:true}.
 *
 * **Validates: Requirements 5.3, 5.4, 5.5** (plus 5.1, 5.6, 5.7, 12.5 for the
 * async loader cases).
 *
 * Runs under the jsdom env (DOMParser + global window available).
 */

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Property 6 — extractPromptContent
// ---------------------------------------------------------------------------

/**
 * Plain readable text with NO HTML-significant characters, so it survives a
 * parse/innerHTML round-trip verbatim and can be asserted against. We also keep
 * it non-empty so "present as readable text" assertions are meaningful.
 */
const readableTextArb = fc
  .stringMatching(/^[A-Za-z0-9 .,!?()가-힣\n-]{1,40}$/)
  .filter((s) => s.trim().length > 0);

/**
 * "inside" text drawn from a letter-only alphabet, and "outside" text drawn
 * from a DISJOINT digit-only alphabet. Using non-overlapping character sets
 * guarantees neither string can be a substring of the other, so the
 * exclusion check (outside text absent from the extracted section) is never
 * spuriously defeated by incidental substring overlap.
 */
const insideTextArb = fc.stringMatching(/^[A-Za-z]{1,20}$/).filter((s) => s.length > 0);
const outsideTextArb = fc.stringMatching(/^[0-9]{1,20}$/).filter((s) => s.length > 0);

/** A short safe tag name for building nested markup inside a region. */
const safeInlineArb = fc.constantFrom('p', 'span', 'strong', 'em', 'div', 'code');

describe('extractPromptContent — Property 6: 권장 구조 우선, 없으면 body', () => {
  it('extracts section.prompt-content content and excludes body-but-outside-section text', () => {
    fc.assert(
      fc.property(insideTextArb, outsideTextArb, safeInlineArb, (inside, outside, tag) => {
        const html = `<!DOCTYPE html><html><head><title>t</title></head><body>
          <p class="outside">${outside}</p>
          <article class="prompt">
            <section class="prompt-content"><${tag}>${inside}</${tag}></section>
          </article>
        </body></html>`;

        const extracted = extractPromptContent(html);

        // The section's inner content is present as readable (parsed) text.
        expect(extracted).toContain(inside);
        // The nested markup is preserved as parsed content (a real tag, not escaped).
        expect(extracted).toContain(`<${tag}>`);
        // Text outside the section (but inside body) is NOT included.
        expect(extracted).not.toContain(outside);
        // Not an escaped dump of the whole file.
        expect(extracted).not.toContain('&lt;section');
        expect(extracted).not.toContain('<!DOCTYPE');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('extracts body content when no section.prompt-content exists', () => {
    fc.assert(
      fc.property(readableTextArb, safeInlineArb, (text, tag) => {
        const html = `<!DOCTYPE html><html><head><title>t</title></head><body><${tag}>${text}</${tag}></body></html>`;

        const extracted = extractPromptContent(html);

        // Body content extracted and readable.
        expect(extracted).toContain(text);
        expect(extracted).toContain(`<${tag}>`);
        // Not an escaped literal dump of the raw file.
        expect(extracted).not.toContain('&lt;body');
        expect(extracted).not.toContain('<!DOCTYPE');
        // The <head>/<title> markup is not part of the body extraction.
        expect(extracted).not.toContain('<title>');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never exposes raw tag source as literal escaped text', () => {
    fc.assert(
      fc.property(fc.boolean(), readableTextArb, (withSection, text) => {
        const inner = `<p>${text}</p>`;
        const html = withSection
          ? `<body><article class="prompt"><section class="prompt-content">${inner}</section></article></body>`
          : `<body>${inner}</body>`;

        const extracted = extractPromptContent(html);
        // The <p> is a real parsed element, not an escaped "&lt;p&gt;" dump.
        expect(extracted).toContain('<p>');
        expect(extracted).not.toContain('&lt;p&gt;');
        expect(extracted).toContain(text);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('extractPromptContent — concrete examples', () => {
  it('recommended-structure doc → section content', () => {
    const html = `<!DOCTYPE html><html><head><title>스프링</title></head><body>
      <article class="prompt">
        <section class="prompt-content"><p>프롬프트 본문입니다.</p></section>
      </article>
    </body></html>`;
    const out = extractPromptContent(html);
    expect(out).toContain('<p>프롬프트 본문입니다.</p>');
    expect(out).not.toContain('<title>');
  });

  it('no-section doc → body content', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><h1>제목</h1><p>본문</p></body></html>`;
    const out = extractPromptContent(html);
    expect(out).toContain('<h1>제목</h1>');
    expect(out).toContain('<p>본문</p>');
    expect(out).not.toContain('<title>');
  });

  it('nested markup inside section is preserved as parsed content', () => {
    const html = `<body><article class="prompt"><section class="prompt-content">
      <ul><li><strong>굵게</strong></li><li><em>기울임</em></li></ul>
    </section></article></body>`;
    const out = extractPromptContent(html);
    expect(out).toContain('<ul>');
    expect(out).toContain('<strong>굵게</strong>');
    expect(out).toContain('<em>기울임</em>');
    expect(out).not.toContain('&lt;ul&gt;');
  });

  it('empty section → empty content', () => {
    const html = `<body><article class="prompt"><section class="prompt-content"></section></article></body>`;
    const out = extractPromptContent(html);
    expect(out.trim()).toBe('');
  });

  it('non-string / empty input → empty string', () => {
    expect(extractPromptContent('')).toBe('');
    expect(extractPromptContent(null)).toBe('');
    expect(extractPromptContent(undefined)).toBe('');
    expect(extractPromptContent(42)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// loadPrompt — async, stubbed fetch (no network)
// ---------------------------------------------------------------------------

/** Minimal Response-like stub returning text. */
function okText(text) {
  return { ok: true, status: 200, text: async () => text };
}
function notFound() {
  return { ok: false, status: 404, text: async () => '' };
}

const identityResolve = (base, rel) => `${base}${rel}`;

describe('loadPrompt — async (stubbed fetch, no network)', () => {
  it('success returns sanitized content + original rawHtml (R5.1, R12.5)', async () => {
    const html =
      '<body><article class="prompt"><section class="prompt-content"><p>안녕하세요</p></section></article></body>';
    const fetchImpl = vi.fn(async () => okText(html));

    const result = await loadPrompt(identityResolve, 'prompts/x.html', {
      baseUrl: '/',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('안녕하세요');
    expect(result.content).toContain('<p>');
    // rawHtml is the untouched fetched source.
    expect(result.rawHtml).toBe(html);
    // URL built via resolveUrl(baseUrl, promptPath).
    expect(fetchImpl).toHaveBeenCalledWith('/prompts/x.html', expect.anything());
  });

  it('a <script> in fetched HTML is removed from content but kept in rawHtml (R12.5)', async () => {
    const html =
      '<body><article class="prompt"><section class="prompt-content">' +
      '<p>본문</p><script>alert(1)</script>' +
      '</section></article></body>';
    const fetchImpl = vi.fn(async () => okText(html));

    const result = await loadPrompt(identityResolve, 'prompts/x.html', {
      baseUrl: '/',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    // Sanitized: no executable script survives in the rendered content.
    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('alert(1)');
    expect(result.content).toContain('본문');
    // rawHtml retains the original (for 원본 보기 / download).
    expect(result.rawHtml).toContain('<script>alert(1)</script>');
  });

  it('accepts an injected sanitizeImpl and uses it (R12.5)', async () => {
    const html =
      '<body><article class="prompt"><section class="prompt-content"><p>hi</p></section></article></body>';
    const fetchImpl = vi.fn(async () => okText(html));
    const sanitizeImpl = vi.fn((s) => `SANITIZED:${s}`);

    const result = await loadPrompt(identityResolve, 'prompts/x.html', {
      baseUrl: '/',
      fetchImpl,
      sanitizeImpl,
    });

    expect(sanitizeImpl).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.content.startsWith('SANITIZED:')).toBe(true);
  });

  it('404 / non-OK response → {ok:false} without throwing (R5.6)', async () => {
    const fetchImpl = vi.fn(async () => notFound());
    const result = await loadPrompt(identityResolve, 'prompts/missing.html', {
      baseUrl: '/',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/404/);
  });

  it('fetch rejection → {ok:false} without throwing (R5.6)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await loadPrompt(identityResolve, 'prompts/x.html', {
      baseUrl: '/',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network down/);
  });

  it('timeout → {ok:false}; a hanging fetch is aborted via AbortController (R5.1, R5.6)', async () => {
    // Hanging fetch that only rejects when the AbortController fires.
    const fetchImpl = vi.fn(
      (url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init && init.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        }),
    );

    const result = await loadPrompt(identityResolve, 'prompts/slow.html', {
      baseUrl: '/',
      fetchImpl,
      timeoutMs: 20, // tiny timeout for a deterministic, fast test
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/시간 초과/);
  });

  it('empty-content document → {ok:true, empty:true, content:""} (R5.7)', async () => {
    const html =
      '<body><article class="prompt"><section class="prompt-content"></section></article></body>';
    const fetchImpl = vi.fn(async () => okText(html));

    const result = await loadPrompt(identityResolve, 'prompts/empty.html', {
      baseUrl: '/',
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.empty).toBe(true);
    expect(result.content).toBe('');
    // rawHtml still available even for empty content.
    expect(result.rawHtml).toBe(html);
  });

  it('unavailable fetch → {ok:false} (does not throw)', async () => {
    const result = await loadPrompt(identityResolve, 'prompts/x.html', {
      baseUrl: '/',
      fetchImpl: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fetch/);
  });
});
