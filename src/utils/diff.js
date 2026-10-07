/**
 * Pure diff utility — a thin wrapper around the bundled, verified Diff_Library
 * (jsdiff, the `diff` package).
 *
 * The Archive_App compares the original Prompt_Content against the current
 * Editor_Pane content to drive the real-time Diff_View. The design (비교표 2,
 * "HTML 원본/수정 Diff 방식 비교") selects jsdiff because its segment-array API
 * (`{value, added, removed}`) maps directly onto the add / del / unchanged DOM
 * highlighting the DiffViewer needs. The library is intentionally abstracted
 * behind `computeDiff` here so it can be swapped (e.g. for diff-match-patch)
 * without touching the DiffViewer (_Requirements: 1.3, 9.1_).
 *
 * This module is PURE: no DOM access, no globals, no side effects.
 *
 * Granularity: LINE-LEVEL (`diffLines`). Deleting whole lines or sections (for
 * example an entire bracketed block like `[입력]\n- …\n- …`) is the common
 * prompt-edit operation, so line-level granularity matches how prompts are
 * actually edited. It also AVOIDS a word-level artifact: `diffWords` tokenizes
 * on word/punctuation boundaries and can treat shared punctuation (e.g. a `[`
 * that also appears in a retained `[분석]`) as an UNCHANGED token, leaving the
 * opening `[` of a deleted block stranded on screen while the rest of the block
 * is marked removed. Line-level diffing emits clean whole-line add/del/unchanged
 * segments with no such stray-bracket splitting, and it preserves BOTH-side
 * round-trips exactly for line-structured content. Line-level segments still map
 * cleanly onto the added-background / deleted-background-with-strikethrough /
 * unchanged highlighting the Diff_View renders (_Requirements: 9.4, 9.5, 9.6_).
 *
 * Segment shape convention (documented, matched by the property tests):
 *   - Every returned segment has exactly the shape `{ value, added?, removed? }`.
 *   - An ADDED segment has `added: true` and no `removed` key.
 *   - A REMOVED segment has `removed: true` and no `added` key.
 *   - An UNCHANGED segment has NEITHER `added` nor `removed` set (both keys are
 *     absent). It is never emitted with `added:false`/`removed:false`.
 * This means "변경 없음" (no change) is detectable as: no segment has
 * `added === true` and no segment has `removed === true` (_Requirements: 9.3_).
 */

import { diffLines } from 'diff';

/**
 * A single diff segment.
 *
 * @typedef {Object} DiffSegment
 * @property {string} value   - The text content of this segment.
 * @property {boolean} [added]   - `true` when this text was added in `modified`.
 * @property {boolean} [removed] - `true` when this text was removed from `original`.
 */

/**
 * Compute the line-level diff between two strings.
 *
 * Wraps jsdiff's `diffLines` and normalizes every change object into the exact
 * `DiffSegment` shape documented above. Unchanged segments carry neither the
 * `added` nor the `removed` key; added/removed segments carry exactly one.
 * Line-level granularity keeps deleted whole-line blocks intact (no stray
 * punctuation left behind) and preserves both-side round-trips exactly for
 * line-structured content; see the module header for the rationale.
 *
 * Edge cases:
 *   - Identical strings → segments with no `added`/`removed` (possibly a single
 *     unchanged segment, or an empty array when both inputs are empty).
 *   - Empty `original` → the whole `modified` string appears as added text.
 *   - Empty `modified` → the whole `original` string appears as removed text.
 *   - Both empty → an empty segment array.
 *
 * Non-string inputs are coerced to strings so the function never throws on
 * `null`/`undefined`/number inputs; callers normally pass strings.
 *
 * @param {string} original - The original (reference) content.
 * @param {string} modified - The modified (edited) content.
 * @returns {DiffSegment[]} Normalized diff segments.
 */
export function computeDiff(original, modified) {
  const originalStr = original == null ? '' : String(original);
  const modifiedStr = modified == null ? '' : String(modified);

  const parts = diffLines(originalStr, modifiedStr);

  /** @type {DiffSegment[]} */
  const segments = [];

  for (const part of parts) {
    // jsdiff may surface a trailing empty-string change in some cases; skip
    // zero-length segments since they carry no visual meaning.
    if (!part.value) {
      continue;
    }

    if (part.added) {
      segments.push({ value: part.value, added: true });
    } else if (part.removed) {
      segments.push({ value: part.value, removed: true });
    } else {
      // Unchanged: neither key is set.
      segments.push({ value: part.value });
    }
  }

  return segments;
}
