import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toPlainText } from '../src/components/PromptViewer.js';

/**
 * Property test for the clipboard plain-text conversion (Task 11.5).
 *
 * Property 8 (일반 텍스트 복사 변환): for arbitrary Prompt_Content, the plain-text
 * conversion used for clipboard copy contains NO HTML tag markup while
 * preserving the readable text content of the source.
 *
 * We generate content by wrapping readable text nodes in random HTML tags and
 * assert that:
 *   1. the output contains no `<`/`>` tag markers, and
 *   2. the output preserves the concatenation of the readable text nodes
 *      (whitespace-normalized to tolerate parser-inserted/collapsed spacing).
 *
 * Runs under the jsdom env (global document available), with numRuns >= 100.
 *
 * **Validates: Requirements 6.2**
 */

const NUM_RUNS = 200;

/** Inline tags that do not introduce block whitespace when parsed. */
const INLINE_TAGS = ['b', 'i', 'em', 'strong', 'span', 'u', 'small', 'code'];

/**
 * Readable text with NO HTML-significant characters (`< > &`) so it survives a
 * parse/innerHTML round-trip verbatim and can be matched after conversion.
 * Non-empty, trimmed of surrounding whitespace so concatenation is stable.
 */
const readableText = fc
  .stringMatching(/^[A-Za-z0-9 ._,!?()\-]+$/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => s.length > 0);

/** A single HTML fragment: readable text wrapped in a random inline tag. */
const taggedFragment = fc.record({
  tag: fc.constantFrom(...INLINE_TAGS),
  text: readableText,
});

describe('Property 8 — toPlainText produces markup-free, content-preserving text', () => {
  it('output contains no tag markers and preserves the text nodes (fast-check)', () => {
    fc.assert(
      fc.property(fc.array(taggedFragment, { minLength: 1, maxLength: 8 }), (fragments) => {
        const html = fragments.map((f) => `<${f.tag}>${f.text}</${f.tag}>`).join('');
        const out = toPlainText(html);

        // 1) No HTML tag markup remains.
        expect(out.includes('<')).toBe(false);
        expect(out.includes('>')).toBe(false);

        // 2) Readable text content preserved: concatenation of the text nodes
        //    matches (whitespace-normalized).
        const expected = fragments.map((f) => f.text).join('');
        const norm = (s) => s.replace(/\s+/g, ' ').trim();
        expect(norm(out)).toBe(norm(expected));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('entity-encoded special characters are decoded, never left as markup', () => {
    fc.assert(
      fc.property(readableText, readableText, (a, b) => {
        // Build content whose text includes the five special chars via entities.
        const html = `<p>${a} &lt;&gt;&amp;&quot;&#39; ${b}</p>`;
        const out = toPlainText(html);
        // The decoded specials appear; no tag markup for the wrapper remains.
        expect(out).toContain('<');
        expect(out).toContain('>');
        expect(out).toContain('&');
        expect(out).toContain('"');
        expect(out).toContain("'");
        // But the wrapping <p> tag itself is gone (no "<p>" literal).
        expect(out.includes('<p>')).toBe(false);
        expect(out.includes('</p>')).toBe(false);
        expect(out).toContain(a);
        expect(out).toContain(b);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
