/**
 * DiffViewer component — Task 14 (실시간 Diff 시각화 / real-time Diff_View).
 *
 * Renders a `DiffSegment[]` (the output of `utils/diff.computeDiff`) into DOM
 * so a user editing a prompt can see, in real time, what changed between the
 * original Prompt_Content and the current Editor_Pane content.
 *
 * This module has two layers:
 *
 *   1. `renderDiff(root, segments)` — a (near-)pure DOM renderer. Given a root
 *      element and the segment array, it writes the diff visualization into
 *      `root` and nothing else. It does NOT compute diffs itself.
 *
 *   2. `createDiffView(root, { computeDiffImpl })` — a thin stateful wrapper
 *      that wires `computeDiff` + `renderDiff` behind an `update(original,
 *      modified)` sink, handling the "변경 없음" (no change) and diff-failure
 *      cases. The real-time 300ms debounce lives in the editor (Task 13,
 *      _R9.2_); it calls `update()` after the debounce fires. DiffViewer only
 *      needs `update()` to be safe and correct.
 *
 * Behavior → Requirements:
 *   - R9.3: When there are no added and no removed segments, show a "변경 없음"
 *           indicator and render NO add/del highlights.
 *   - R9.4: Added text is wrapped in `<ins class="diff-added">` — a background
 *           highlight distinct from removed and unchanged text.
 *   - R9.5: Removed text is wrapped in `<del class="diff-removed">` with
 *           strikethrough styling and a background distinct from added and
 *           unchanged text.
 *   - R9.6: A CHANGE is emitted by `computeDiff` as a removed segment followed
 *           by an added segment. Rendering the removed (strikethrough) segment
 *           immediately adjacent to the added (highlight) segment visually
 *           distinguishes the before/after of a change — no special-casing is
 *           needed; the adjacent del+ins pair IS the change visualization.
 *   - R9.7: When `computeDiff` throws, `update()` shows a diff-failure error
 *           indicator and KEEPS the previous (last good) rendering unchanged —
 *           the diff region is not blanked or altered on failure.
 *
 * Security: segment VALUES are always written via `textContent`, never
 * `innerHTML`, so diff content (which originates from user-edited prompt text)
 * can never inject markup into the page.
 *
 * Design reference: design.md "Components and Interfaces → DiffViewer" and the
 * "Error Handling" table row "Diff 계산 실패 → 원본 유지 + diff 실패 오류 표시".
 *
 * _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7._
 */

import { computeDiff as defaultComputeDiff } from '../utils/diff.js';

/** @typedef {import('../utils/diff.js').DiffSegment} DiffSegment */

const NO_CHANGE_TEXT = '변경 없음';
const DIFF_ERROR_TEXT = 'Diff 계산에 실패했습니다';

const CLASS_ADDED = 'diff-added';
const CLASS_REMOVED = 'diff-removed';
const CLASS_NOCHANGE = 'diff-nochange';
const CLASS_SEGMENTS = 'diff-segments';
const CLASS_ERROR = 'diff-error';

/**
 * Resolve a usable `document` from a root element (preferred) or the global.
 * @param {HTMLElement} root
 * @returns {Document}
 */
function resolveDoc(root) {
  const doc = (root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('DiffViewer requires a DOM environment');
  }
  return doc;
}

/**
 * Determine whether a segment array represents "변경 없음" (no change): no
 * segment is added and no segment is removed (_R9.3_). An empty array (both
 * inputs empty) also counts as no change.
 *
 * @param {DiffSegment[]} segments
 * @returns {boolean}
 */
export function isNoChange(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return true;
  }
  return !segments.some((s) => s && (s.added === true || s.removed === true));
}

/**
 * Render a `DiffSegment[]` into `root`.
 *
 * The root is cleared first, then:
 *   - If the segments represent no change (R9.3), a single `.diff-nochange`
 *     indicator reading "변경 없음" is rendered and NO add/del highlights.
 *   - Otherwise each segment is rendered in order:
 *       - added   → `<ins class="diff-added">`   (R9.4)
 *       - removed → `<del class="diff-removed">`  (R9.5, strikethrough via CSS)
 *       - unchanged → plain `<span>` with no highlight class
 *     A removed segment immediately followed by an added segment (as produced
 *     by `computeDiff` for a change) renders as adjacent del+ins, visually
 *     distinguishing before/after of the change (R9.6).
 *
 * Segment values are written with `textContent` only (never innerHTML) so a
 * value such as `"<b>x</b>"` is shown literally and cannot inject markup.
 *
 * No side effects beyond writing into `root`.
 *
 * @param {HTMLElement} root - Container to render into (cleared first).
 * @param {DiffSegment[]} segments - Output of `computeDiff`.
 */
export function renderDiff(root, segments) {
  if (!root || typeof root.appendChild !== 'function') {
    throw new TypeError('renderDiff: root must be an HTMLElement');
  }
  const doc = resolveDoc(root);

  // Clear existing rendering.
  while (root.firstChild) root.removeChild(root.firstChild);

  const list = Array.isArray(segments) ? segments : [];

  // R9.3: no change → indicator, no highlights.
  if (isNoChange(list)) {
    const note = doc.createElement('div');
    note.className = CLASS_NOCHANGE;
    note.setAttribute('role', 'status');
    note.textContent = NO_CHANGE_TEXT;
    root.appendChild(note);
    return;
  }

  const container = doc.createElement('div');
  container.className = CLASS_SEGMENTS;

  for (const seg of list) {
    if (!seg || typeof seg.value !== 'string' || seg.value === '') {
      continue;
    }

    let el;
    if (seg.added === true) {
      // R9.4: added text — background highlight, distinct element.
      el = doc.createElement('ins');
      el.className = CLASS_ADDED;
    } else if (seg.removed === true) {
      // R9.5: removed text — distinct background + strikethrough (via CSS).
      el = doc.createElement('del');
      el.className = CLASS_REMOVED;
    } else {
      // Unchanged — no highlight class.
      el = doc.createElement('span');
      el.className = 'diff-unchanged';
    }

    // Always textContent: diff content is never interpreted as markup.
    el.textContent = seg.value;
    container.appendChild(el);
  }

  root.appendChild(container);
}

/**
 * Create a stateful Diff_View bound to `root`.
 *
 * The returned `update(original, modified)` is the SINK the editor calls after
 * its 300ms debounce (_R9.2_ — the debounce itself lives in the editor, Task
 * 13). `update` computes the diff via `computeDiffImpl` and renders it. On a
 * thrown error from `computeDiffImpl` it shows a diff-failure indicator and
 * keeps the previous (last good) rendering (_R9.7_).
 *
 * @param {HTMLElement} root - Container to own.
 * @param {object} [options]
 * @param {(original:string, modified:string)=>DiffSegment[]} [options.computeDiffImpl]
 *   Diff function; defaults to `utils/diff.computeDiff`. Injectable for tests.
 * @returns {{
 *   element: HTMLElement,
 *   update: (original: string, modified: string) => boolean,
 *   clear: () => void,
 *   destroy: () => void,
 * }}
 */
export function createDiffView(root, options = {}) {
  if (!root || typeof root.appendChild !== 'function') {
    throw new TypeError('createDiffView: root must be an HTMLElement');
  }
  const doc = resolveDoc(root);
  const computeDiffImpl =
    typeof options.computeDiffImpl === 'function' ? options.computeDiffImpl : defaultComputeDiff;

  // --- DOM scaffold --------------------------------------------------------
  while (root.firstChild) root.removeChild(root.firstChild);

  const container = doc.createElement('section');
  container.className = 'diff-view';
  container.setAttribute('aria-label', 'Diff 보기');

  // Error region (R9.7). Hidden unless there is a diff-failure message.
  const errorEl = doc.createElement('div');
  errorEl.className = CLASS_ERROR;
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  // The region that holds the rendered segments / 변경 없음 indicator. On diff
  // failure this is intentionally left untouched to preserve the last render.
  const diffRegion = doc.createElement('div');
  diffRegion.className = 'diff-region';

  container.appendChild(errorEl);
  container.appendChild(diffRegion);
  root.appendChild(container);

  // Render an initial "변경 없음" so the view is never empty.
  renderDiff(diffRegion, []);

  /** @param {string} message */
  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  /**
   * Compute + render the diff. Returns true on success, false when the diff
   * computation threw (in which case the previous rendering is preserved and a
   * diff-failure error is shown) (_R9.7_).
   *
   * @param {string} original
   * @param {string} modified
   * @returns {boolean}
   */
  function update(original, modified) {
    let segments;
    try {
      segments = computeDiffImpl(original, modified);
    } catch {
      // R9.7: keep the previous (last good) rendering; show failure indicator.
      showError(DIFF_ERROR_TEXT);
      return false;
    }
    clearError();
    renderDiff(diffRegion, segments);
    return true;
  }

  /** Reset the view to the "변경 없음" state and clear any error. */
  function clear() {
    clearError();
    renderDiff(diffRegion, []);
  }

  return {
    element: container,
    update,
    clear,
    destroy() {
      while (root.firstChild) root.removeChild(root.firstChild);
    },
  };
}

export default renderDiff;
