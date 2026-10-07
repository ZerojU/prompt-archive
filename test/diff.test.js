import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeDiff } from '../src/utils/diff.js';

/**
 * Tests for the pure diff utility (jsdiff wrapper).
 *
 * Property 9 (Diff 라운드트립 및 무변경 식별) is validated with fast-check across
 * at least 100 runs, plus concrete example-based assertions for an addition, a
 * pure deletion, and identical input.
 *
 * **Validates: Requirements 9.1, 9.3**
 */

const NUM_RUNS = 100;

/**
 * Arbitrary for a "line stream" string: zero or more simple line tokens joined
 * by `\n`, optionally with a trailing `\n`. computeDiff uses jsdiff's
 * LINE-LEVEL diff (`diffLines`), which emits clean whole-line add/del/unchanged
 * segments, so BOTH-side round-trips hold BYTE-EXACTLY for line-structured
 * content: reconstruct(non-removed) === modified AND reconstruct(non-added) ===
 * original. Each line token is a short alphanumeric string so lines are
 * distinct and unambiguous to the differ.
 */
const lineStreamArb = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/), { minLength: 0, maxLength: 12 })
  .chain((lines) =>
    fc.boolean().map((trailingNewline) => {
      const joined = lines.join('\n');
      return trailingNewline && joined.length > 0 ? joined + '\n' : joined;
    }),
  );

/**
 * Reconstruct a side of the diff by concatenating segment values that match a
 * predicate. The modified string is rebuilt from unchanged + added segments
 * (i.e. everything NOT removed); the original from unchanged + removed.
 *
 * @param {import('../src/utils/diff.js').DiffSegment[]} segments
 * @param {(seg: import('../src/utils/diff.js').DiffSegment) => boolean} keep
 * @returns {string}
 */
function reconstruct(segments, keep) {
  return segments
    .filter(keep)
    .map((seg) => seg.value)
    .join('');
}

const isRemoved = (seg) => seg.removed === true;
const isAdded = (seg) => seg.added === true;

describe('computeDiff — Property 9: Diff 라운드트립 및 무변경 식별', () => {
  it('reconstructing non-removed segments (unchanged + added) equals the modified string', () => {
    fc.assert(
      fc.property(lineStreamArb, lineStreamArb, (original, modified) => {
        const segments = computeDiff(original, modified);
        const rebuiltModified = reconstruct(segments, (seg) => !isRemoved(seg));
        expect(rebuiltModified).toBe(modified);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reconstructing non-added segments (unchanged + removed) equals the original string byte-for-byte', () => {
    // Line-level diffing preserves the original-side round-trip exactly for
    // line-structured content (no boundary-whitespace artifact), so this is a
    // strict byte-exact comparison.
    fc.assert(
      fc.property(lineStreamArb, lineStreamArb, (original, modified) => {
        const segments = computeDiff(original, modified);
        const rebuiltOriginal = reconstruct(segments, (seg) => !isAdded(seg));
        expect(rebuiltOriginal).toBe(original);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('computeDiff(x, x) produces no added and no removed segments (변경 없음)', () => {
    fc.assert(
      fc.property(lineStreamArb, (x) => {
        const segments = computeDiff(x, x);
        expect(segments.some(isAdded)).toBe(false);
        expect(segments.some(isRemoved)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('every segment has the normalized {value, added?, removed?} shape', () => {
    fc.assert(
      fc.property(lineStreamArb, lineStreamArb, (original, modified) => {
        const segments = computeDiff(original, modified);
        for (const seg of segments) {
          // value is always a non-empty string.
          expect(typeof seg.value).toBe('string');
          expect(seg.value.length).toBeGreaterThan(0);

          // A segment is never both added and removed.
          expect(seg.added === true && seg.removed === true).toBe(false);

          // Unchanged segments carry NEITHER key (not added:false/removed:false).
          if (seg.added !== true && seg.removed !== true) {
            expect('added' in seg).toBe(false);
            expect('removed' in seg).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('computeDiff — concrete cases', () => {
  it('identical input yields no change markers', () => {
    const text = 'You are an AI assistant that helps users.';
    const segments = computeDiff(text, text);
    expect(segments.some(isAdded)).toBe(false);
    expect(segments.some(isRemoved)).toBe(false);
    // Reconstructs back to the same string.
    expect(reconstruct(segments, () => true)).toBe(text);
  });

  it('a within-line word change surfaces the whole old line removed and whole new line added', () => {
    // With line-level diffing, changing a word inside a line marks the ENTIRE
    // old line removed and the ENTIRE new line added (there is no partial-word
    // segment). The added segment carries the new word; the removed carries the
    // old line.
    const original = 'intro line\nYou are an AI assistant that helps users.\nouttro line\n';
    const modified = 'intro line\nYou are an AI assistant that helps Korean users.\nouttro line\n';
    const segments = computeDiff(original, modified);

    const added = segments.filter(isAdded);
    const removed = segments.filter(isRemoved);
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);
    // The added segment contains the new word and the full new line.
    expect(added.map((s) => s.value).join('')).toContain('Korean');
    // The removed segment is the full old line (which did not contain "Korean").
    expect(removed.map((s) => s.value).join('')).toContain(
      'You are an AI assistant that helps users.',
    );

    // Strict round-trip on BOTH sides.
    expect(reconstruct(segments, (seg) => !isRemoved(seg))).toBe(modified);
    expect(reconstruct(segments, (seg) => !isAdded(seg))).toBe(original);
  });

  it('deleting a middle line surfaces that line as a removed segment and no additions', () => {
    const original = 'alpha\nbeta\ngamma\n';
    const modified = 'alpha\ngamma\n';
    const segments = computeDiff(original, modified);

    const removed = segments.filter(isRemoved);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.map((s) => s.value).join('')).toContain('beta');
    expect(segments.some(isAdded)).toBe(false);

    expect(reconstruct(segments, (seg) => !isRemoved(seg))).toBe(modified);
    expect(reconstruct(segments, (seg) => !isAdded(seg))).toBe(original);
  });

  it('deleting a bracketed multi-line block leaves no stray "[" and keeps [분석] intact (regression)', () => {
    // Regression for the word-level bug: `diffWords` treated the shared `[`
    // punctuation token in the deleted `[입력]` block as UNCHANGED (because
    // `[분석]` also starts with `[`), stranding a lone `[` on screen. Line-level
    // diffing deletes the whole block cleanly and keeps `[분석]` intact.
    const original = '설명\n\n[입력]\n- 항목1\n- 항목2\n\n[분석]\n1. 비용\n';
    const modified = '설명\n\n[분석]\n1. 비용\n';
    const segments = computeDiff(original, modified);

    // No segment is a stray bare "[" and no segment splits the bracket from 입력.
    for (const seg of segments) {
      expect(seg.value).not.toBe('[');
      expect(seg.value).not.toBe('[\n');
    }

    // The [입력] block is fully contained within removed segments.
    const removedText = segments.filter(isRemoved).map((s) => s.value).join('');
    expect(removedText).toContain('[입력]');
    expect(removedText).toContain('- 항목1');
    expect(removedText).toContain('- 항목2');

    // [분석] stays intact inside a KEEP (unchanged) segment — never removed,
    // never added, never split from its opening bracket.
    const unchangedText = segments
      .filter((seg) => !isAdded(seg) && !isRemoved(seg))
      .map((s) => s.value)
      .join('');
    expect(unchangedText).toContain('[분석]');
    expect(segments.filter(isRemoved).map((s) => s.value).join('')).not.toContain('[분석]');
    expect(segments.filter(isAdded).map((s) => s.value).join('')).not.toContain('[분석]');

    // There are no additions (pure deletion), and the round-trips hold exactly.
    expect(segments.some(isAdded)).toBe(false);
    expect(reconstruct(segments, (seg) => !isRemoved(seg))).toBe(modified);
    expect(reconstruct(segments, (seg) => !isAdded(seg))).toBe(original);
  });

  it('empty original makes the whole modified string added', () => {
    const segments = computeDiff('', 'brand new content');
    expect(segments.every((s) => s.added === true)).toBe(true);
    expect(reconstruct(segments, () => true)).toBe('brand new content');
  });

  it('empty modified makes the whole original string removed', () => {
    const segments = computeDiff('old content here', '');
    expect(segments.every((s) => s.removed === true)).toBe(true);
    expect(reconstruct(segments, (seg) => !isRemoved(seg))).toBe('');
  });

  it('both empty yields an empty segment array', () => {
    expect(computeDiff('', '')).toEqual([]);
  });
});
