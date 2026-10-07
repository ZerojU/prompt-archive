import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  escapeHtml,
  buildModifiedHtml,
  proposeFilename,
  triggerDownload,
} from '../src/services/downloadService.js';

/**
 * Tests for the download service (downloadService.js).
 *
 * Property 10 (영역 외부 보존 및 특수문자 이스케이프) and Property 11 (수정본
 * 파일명 변환) are validated with fast-check across at least 100 runs, plus
 * concrete example-based assertions and a jsdom test for the side-effecting
 * triggerDownload that asserts a client-only download with no network calls.
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7**
 */

const NUM_RUNS = 100;

/** Reverse the five-character HTML entity escaping produced by escapeHtml. */
function unescapeHtml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&'); // ampersand LAST to mirror the escape order.
}

/**
 * Arbitrary for a "region-free" chunk of surrounding markup: arbitrary text
 * that is guaranteed NOT to contain its own prompt-content region, so the
 * expected outside bytes are exactly the generated prefix/suffix. We forbid the
 * literal substring `prompt-content` and the `<section` / `</section` tokens so
 * no accidental region boundary is introduced by the surrounding text.
 */
const regionFreeArb = fc
  .string({ minLength: 0, maxLength: 60 })
  .filter(
    (s) =>
      !/prompt-content/i.test(s) &&
      !/<section/i.test(s) &&
      !/<\/section/i.test(s),
  );

/** Arbitrary edited text, including the five special characters. */
const editedTextArb = fc.stringOf(
  fc.constantFrom(
    'a',
    'B',
    '1',
    ' ',
    '\n',
    '<',
    '>',
    '&',
    '"',
    "'",
    '한',
    '\t',
    'z',
  ),
  { minLength: 0, maxLength: 80 },
);

/** Opening-tag variants that all identify a prompt-content region. */
const openTagArb = fc.constantFrom(
  '<section class="prompt-content">',
  "<section class='prompt-content'>",
  '<section class="box prompt-content extra">',
  '<section id="p" class="prompt-content" data-x="y">',
  '<section  class = "prompt-content" >',
);

describe('escapeHtml', () => {
  it('escapes all five special characters', () => {
    expect(escapeHtml(`<a href="x" data='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;',
    );
  });

  it('escapes & first so entities are not double-escaped', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(unescapeHtml(escapeHtml('a & b < c'))).toBe('a & b < c');
  });
});

describe('buildModifiedHtml — Property 10: 영역 외부 보존 및 특수문자 이스케이프', () => {
  it('preserves bytes outside the region and escapes the edited text inside', () => {
    fc.assert(
      fc.property(
        regionFreeArb,
        openTagArb,
        regionFreeArb,
        editedTextArb,
        (prefix, openTag, suffix, editedText) => {
          // Sandwich a generated region between region-free prefix/suffix so we
          // know the exact expected outside bytes.
          const original = `${prefix}${openTag}ORIGINAL BODY${suffix === '' ? '' : ''}</section>${suffix}`;

          const result = buildModifiedHtml(original, editedText);
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const html = result.html;

          // (a) Everything outside the region is byte-identical: the result
          // must start with prefix+openTag and end with </section>+suffix.
          expect(html.startsWith(`${prefix}${openTag}`)).toBe(true);
          expect(html.endsWith(`</section>${suffix}`)).toBe(true);

          // Extract the inner content between the known boundaries.
          const innerStart = `${prefix}${openTag}`.length;
          const innerEnd = html.length - `</section>${suffix}`.length;
          const inner = html.slice(innerStart, innerEnd);

          // (b) Inner equals the HTML-escaped edited text; un-escaping it
          // returns the original edited text.
          expect(inner).toBe(escapeHtml(editedText));
          expect(unescapeHtml(inner)).toBe(editedText);

          // (c) No raw unescaped <, >, ", ' remain inside the region, and every
          // & inside is the start of a known entity.
          expect(inner.includes('<')).toBe(false);
          expect(inner.includes('>')).toBe(false);
          expect(inner.includes('"')).toBe(false);
          expect(inner.includes("'")).toBe(false);
          // Remove known entities; no stray & should remain.
          const withoutEntities = inner
            .replace(/&lt;/g, '')
            .replace(/&gt;/g, '')
            .replace(/&quot;/g, '')
            .replace(/&#39;/g, '')
            .replace(/&amp;/g, '');
          expect(withoutEntities.includes('&')).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('buildModifiedHtml — concrete cases', () => {
  it('preserves a full document with doctype/head and replaces only the region', () => {
    const original = [
      '<!DOCTYPE html>',
      '<html lang="ko">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <title>스프링 부트 설정</title>',
      '</head>',
      '<body>',
      '  <article class="prompt">',
      '    <section class="prompt-content">original body here</section>',
      '  </article>',
      '</body>',
      '</html>',
      '',
    ].join('\n');

    const result = buildModifiedHtml(original, 'brand new prompt text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Doctype/head/surrounding markup preserved byte-for-byte.
    expect(result.html).toContain('<!DOCTYPE html>\n<html lang="ko">');
    expect(result.html).toContain('  <meta charset="UTF-8">');
    expect(result.html).toContain('<title>스프링 부트 설정</title>');
    expect(result.html).toContain('  </article>\n</body>\n</html>\n');
    // Region inner replaced.
    expect(result.html).toContain(
      '<section class="prompt-content">brand new prompt text</section>',
    );
    expect(result.html).not.toContain('original body here');
  });

  it('returns { ok:false } when there is no prompt-content region (R10.6)', () => {
    const original =
      '<!DOCTYPE html><html><body><p>no region here</p></body></html>';
    const result = buildModifiedHtml(original, 'anything');
    expect(result.ok).toBe(false);
    // Original is not altered (we never return a mutated html on failure).
    expect(result).not.toHaveProperty('html');
  });

  it('escapes a <script> payload so it is not executable, surrounding doc intact', () => {
    const original =
      '<body><section class="prompt-content">x</section></body>';
    const malicious = `<script>alert('xss')</script> & "quoted"`;
    const result = buildModifiedHtml(original, malicious);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.html).toContain(
      '&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;',
    );
    // No raw <script> tag ends up in the document body region.
    expect(result.html).not.toContain('<script>');
    // Surrounding doc intact.
    expect(result.html.startsWith('<body><section class="prompt-content">')).toBe(
      true,
    );
    expect(result.html.endsWith('</section></body>')).toBe(true);
  });
});

describe('proposeFilename — Property 11: 수정본 파일명 변환', () => {
  it('inserts _modified before the last extension', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9._-]{1,20}$/),
        fc.stringMatching(/^[a-zA-Z0-9]{1,6}$/),
        (base, ext) => {
          const filename = `${base}.${ext}`;
          const result = proposeFilename(filename);
          const lastDot = filename.lastIndexOf('.');
          const expectedBase = filename.slice(0, lastDot);
          const expectedExt = filename.slice(lastDot);
          expect(result).toBe(`${expectedBase}_modified${expectedExt}`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('spring.html → spring_modified.html', () => {
    expect(proposeFilename('spring.html')).toBe('spring_modified.html');
  });

  it('a.b.html → a.b_modified.html (only last extension split)', () => {
    expect(proposeFilename('a.b.html')).toBe('a.b_modified.html');
  });

  it('no extension appends _modified', () => {
    expect(proposeFilename('README')).toBe('README_modified');
  });

  it('leading-dot name is treated as having no extension', () => {
    expect(proposeFilename('.gitignore')).toBe('.gitignore_modified');
  });

  it('empty filename yields _modified', () => {
    expect(proposeFilename('')).toBe('_modified');
  });
});

describe('triggerDownload — client-only download, no network (R10.1, R10.7)', () => {
  let createObjectURL;
  let revokeObjectURL;
  let clickSpy;
  let fetchSpy;
  let createdBlobs;

  beforeEach(() => {
    createdBlobs = [];
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();

    // Spy on anchor clicks without triggering a real navigation.
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    // Ensure no network call occurs during a download.
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    // Wrap Blob to record constructed blobs while keeping real behavior.
    const RealBlob = globalThis.Blob;
    class RecordingBlob extends RealBlob {
      constructor(parts, options) {
        super(parts, options);
        createdBlobs.push({ parts, options, type: this.type });
      }
    }
    vi.stubGlobal('Blob', RecordingBlob);
    vi.stubGlobal('URL', { ...globalThis.URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete globalThis.fetch;
  });

  it('creates a text/html Blob, clicks an anchor with the filename, revokes the URL, and makes no network call', () => {
    triggerDownload('<html>modified</html>', 'spring_modified.html');

    // A Blob of type text/html was created.
    expect(createdBlobs.length).toBe(1);
    expect(createdBlobs[0].options.type).toBe('text/html');
    expect(createdBlobs[0].type).toBe('text/html');

    // Object URL lifecycle.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    // Anchor was clicked.
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // No network call whatsoever.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sets the download attribute to the provided filename', () => {
    // Capture the anchor at click time via the href/download it carries.
    let capturedDownload = null;
    let capturedHref = null;
    clickSpy.mockImplementation(function () {
      capturedDownload = this.getAttribute('download');
      capturedHref = this.getAttribute('href');
    });

    triggerDownload('<html>x</html>', 'my_modified.html');

    expect(capturedDownload).toBe('my_modified.html');
    expect(capturedHref).toBe('blob:mock-url');
  });

  it('throws a clear error when the DOM is unavailable', () => {
    expect(() =>
      triggerDownload('<html>x</html>', 'f.html', {
        document: undefined,
        URL: undefined,
        Blob: undefined,
      }),
    ).toThrow(/DOM environment/);
  });
});
