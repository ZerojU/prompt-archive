import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { createPromptEditor } from '../src/components/PromptEditor.js';

/**
 * Property 7 — Editor_Pane 초기화 충실도 (Task 13.3).
 *
 * For any original Prompt_Content string (including ones containing `\n`,
 * `\r\n`, and trailing whitespace), after creating the editor the Editor_Pane's
 * initial value equals the original CHARACTER-FOR-CHARACTER (with line breaks
 * canonicalized to LF), and EVERY line break is preserved.
 *
 * Platform invariant: a `<textarea>` applies the HTML spec's "textarea line
 * break normalization" to its `value` (every `\r\n` and lone `\r` becomes `\n`
 * on both set and get). Real browsers do this too, so char-for-char fidelity is
 * verified against the LF-normalized original — the component normalizes once
 * up front so the stored original, the seed, and every read-back agree. "Every
 * newline preserved" is checked by comparing the total line-break count of the
 * original (counting `\r\n`/`\r`/`\n`) against the `\n` count of the seed.
 *
 * **Validates: Requirements 8.3, 8.5**
 *
 * Runs under the jsdom env (document is available).
 */

/** Canonicalize line breaks to LF, mirroring the component / textarea platform. */
function normalizeLineBreaks(s) {
  return s.replace(/\r\n?/g, '\n');
}

/** Count line breaks treating `\r\n`, lone `\r`, and `\n` each as one break. */
function countLineBreaks(s) {
  return (s.match(/\r\n|\r|\n/g) || []).length;
}

const NUM_RUNS = 100;

function makeRoot() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

const roots = [];
afterEach(() => {
  while (roots.length) {
    const r = roots.pop();
    if (r && r.parentNode) r.parentNode.removeChild(r);
  }
});

/**
 * Build strings from a mix of letters, spaces, `\n`, and `\r\n` so the
 * generator deliberately exercises both newline conventions and trailing
 * whitespace. We assemble from "chunk" tokens and join them, occasionally
 * appending trailing whitespace, to guarantee rich newline coverage rather
 * than relying on incidental generation.
 */
const chunkArb = fc.constantFrom(
  'a',
  'bc',
  'Hello',
  'world',
  ' ',
  '  ',
  '가나다',
  '\n',
  '\r\n',
  'x\ny',
  'p\r\nq',
  '',
);

const contentArb = fc
  .array(chunkArb, { minLength: 0, maxLength: 40 })
  .map((parts) => parts.join(''))
  // Occasionally ensure trailing whitespace/newlines are present.
  .chain((s) =>
    fc.constantFrom('', ' ', '  \n', '\r\n', '\t', ' \n ').map((suffix) => s + suffix),
  );

describe('Property 7 — Editor_Pane initialization fidelity (R8.3, R8.5)', () => {
  it('seeds the Editor_Pane with the original char-for-char (LF-normalized), preserving every line break', () => {
    fc.assert(
      fc.property(contentArb, (original) => {
        const root = makeRoot();
        roots.push(root);

        const editor = createPromptEditor(root, original, () => {});
        const expected = normalizeLineBreaks(original);

        // Character-for-character identity (LF-normalized) via the getter...
        expect(editor.getValue()).toBe(expected);
        // ...and via the DOM node directly.
        expect(root.querySelector('.editor-input').value).toBe(expected);

        // EVERY line break preserved: the total count of breaks in the original
        // (counting \r\n / \r / \n) equals the \n count in the seed. None lost.
        expect((editor.getValue().match(/\n/g) || []).length).toBe(
          countLineBreaks(original),
        );

        // Non-newline characters are untouched: stripping all line breaks from
        // both sides yields identical text.
        expect(editor.getValue().replace(/\n/g, '')).toBe(original.replace(/\r\n|\r|\n/g, ''));

        // Original_Pane also mirrors the (normalized) original (read-only).
        expect(root.querySelector('.editor-original').value).toBe(expected);

        editor.destroy();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('explicit CRLF/LF mixed example: every break preserved as LF, chars intact', () => {
    const original = 'line1\r\nline2\nline3\r\n\n  trailing  \n';
    const expected = 'line1\nline2\nline3\n\n  trailing  \n';
    const root = makeRoot();
    roots.push(root);
    const editor = createPromptEditor(root, original, () => {});
    expect(editor.getValue()).toBe(expected);
    // Line-break count preserved: 5 breaks in the original, 5 LFs in the seed.
    expect(countLineBreaks(original)).toBe(5);
    expect((editor.getValue().match(/\n/g) || []).length).toBe(5);
    editor.destroy();
  });
});
