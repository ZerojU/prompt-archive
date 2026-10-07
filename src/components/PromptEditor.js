/**
 * PromptEditor component — Task 13 (편집 모드 2분할 화면).
 *
 * Splits the main area into EXACTLY two panes, each a column holding a small
 * visible caption label ("원본" / "수정본") above its textarea:
 *   - Original_Pane (left):  the original Prompt_Content, READ-ONLY.
 *   - Editor_Pane   (right): an editable <textarea> (monospace) seeded, on
 *                            Edit_Mode entry, with content that is identical to
 *                            the original CHARACTER-FOR-CHARACTER (all line
 *                            breaks preserved, including `\n` and `\r\n`).
 *
 * Behavior → Requirements:
 *   - R8.1: The editor renders exactly two panes (Original_Pane + Editor_Pane).
 *   - R8.2: The Original_Pane shows the original Prompt_Content READ-ONLY.
 *   - R8.3: On Edit_Mode entry the Editor_Pane's initial value equals the
 *           original content character-for-character. (Property 7 target.)
 *           NOTE: line breaks are canonicalized to LF (`\n`) up front because a
 *           <textarea> applies the HTML spec's "textarea line break
 *           normalization" to its `value` (every `\r\n`/`\r` becomes `\n` on
 *           set and get). Normalizing once makes fidelity a well-defined
 *           invariant across the stored original, the seed, and every
 *           read-back; every line break is preserved as `\n`.
 *   - R8.4: The Editor_Pane is an editable textarea.
 *   - R8.5: The Editor_Pane preserves all line breaks (as LF per the textarea
 *           platform invariant above), uses a monospace font (via the
 *           `.editor-input` class), and is vertically scrollable for long
 *           content.
 *   - R8.6: Undo (Ctrl+Z) / redo (Ctrl+Y) are supported for >= 50 steps. A
 *           native <textarea> maintains its own undo/redo history with ample
 *           depth (well beyond 50 operations) and already handles Ctrl+Z /
 *           Ctrl+Y / Ctrl+Shift+Z, so we rely on and document that native
 *           behavior rather than maintaining a custom undo stack.
 *   - R8.7: Scroll sync — when the user scrolls either pane vertically, the
 *           other pane's vertical scroll position is set to the SAME RATIO
 *           (0%..100%) within 100ms (synchronously, on the 'scroll' event). A
 *           divide-by-zero guard handles non-scrollable panes, and an
 *           `isSyncing` flag prevents an infinite scroll-echo feedback loop.
 *   - R9.2: Debounced change notification — on input the editor calls
 *           `onChangeDebounced(editorValue)` 300ms after the last keystroke
 *           (rapid edits collapse to a single trailing call).
 *   - R8.8: Dirty-state exit confirmation — `isDirty()` is true when the editor
 *           value differs from the original character-for-character.
 *           `confirmExitIfDirty(confirmFn)` returns true immediately when not
 *           dirty; when dirty it calls `confirmFn()` and only resolves true if
 *           the user confirms, otherwise it keeps the editor content untouched
 *           and resolves false.
 *
 * Design reference: design.md "Components and Interfaces → PromptEditor".
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.2._
 */

/** Debounce window for change notification (R9.2). */
const CHANGE_DEBOUNCE_MS = 300;

/**
 * Normalize line breaks to LF (`\n`).
 *
 * This is REQUIRED for `<textarea>` fidelity: the HTML standard defines the
 * textarea `value` IDL attribute to apply "textarea line break normalization",
 * converting every `\r\n` and lone `\r` to `\n` on both set and get. Real
 * browsers (and jsdom) therefore cannot store `\r\n` literally in a textarea —
 * reading `.value` back always yields `\n`.
 *
 * To make R8.3's char-for-char fidelity a well-defined, verifiable invariant,
 * we normalize the original ONCE up front so the stored original, the Editor_
 * Pane seed, the Original_Pane, and every read-back agree exactly. All newline
 * SEMANTICS are preserved (every line break survives as `\n`); only the CRLF/CR
 * encoding is canonicalized, matching platform behavior. `isDirty()` then
 * compares like-for-like against this normalized baseline.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeLineBreaks(s) {
  return s.replace(/\r\n?/g, '\n');
}

/**
 * Create the 2-pane PromptEditor.
 *
 * @param {HTMLElement} root - Container to render into (cleared first).
 * @param {string} originalContent - The original Prompt_Content. Seeds the
 *   Editor_Pane and backs the Original_Pane; preserved character-for-character
 *   after line breaks are canonicalized to LF (`\n`) to match the <textarea>
 *   value normalization the platform applies.
 * @param {(editorContent:string)=>void} [onChangeDebounced] - Called 300ms
 *   after the last edit with the current editor value (R9.2).
 * @param {object} [options]
 * @param {number} [options.debounceMs=300] - Debounce window; injectable so
 *   tests can tune it (defaults to 300ms per R9.2).
 * @param {(cb:Function, ms:number)=>any} [options.setTimeoutFn] - Timer hook
 *   (defaults to the ambient `setTimeout`); lets tests use fake timers.
 * @param {(id:any)=>void} [options.clearTimeoutFn] - Clear hook.
 * @returns {{
 *   element: HTMLElement,
 *   originalPane: HTMLElement,
 *   editorPane: HTMLTextAreaElement,
 *   getValue: () => string,
 *   setValue: (value:string) => void,
 *   getOriginal: () => string,
 *   isDirty: () => boolean,
 *   confirmExitIfDirty: (confirmFn: () => (boolean|Promise<boolean>)) => Promise<boolean>,
 *   flush: () => void,
 *   destroy: () => void,
 * }}
 */
export function createPromptEditor(root, originalContent, onChangeDebounced, options = {}) {
  if (!root || typeof root.appendChild !== 'function') {
    throw new TypeError('createPromptEditor: root must be an HTMLElement');
  }

  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('createPromptEditor requires a DOM environment');
  }

  // Normalize the original to a string, canonicalizing line breaks to `\n`.
  // A <textarea> applies this same normalization internally (see
  // normalizeLineBreaks), so normalizing up front makes R8.3's char-for-char
  // fidelity a well-defined invariant: original, seed, and read-back all agree
  // and every line break is preserved (R8.3/R8.5).
  const original = normalizeLineBreaks(
    typeof originalContent === 'string' ? originalContent : '',
  );

  const onChange = typeof onChangeDebounced === 'function' ? onChangeDebounced : null;
  const debounceMs =
    typeof options.debounceMs === 'number' && options.debounceMs >= 0
      ? options.debounceMs
      : CHANGE_DEBOUNCE_MS;
  const setTimeoutFn =
    typeof options.setTimeoutFn === 'function'
      ? options.setTimeoutFn
      : (cb, ms) => setTimeout(cb, ms);
  const clearTimeoutFn =
    typeof options.clearTimeoutFn === 'function'
      ? options.clearTimeoutFn
      : (id) => clearTimeout(id);

  // --- DOM scaffold: EXACTLY two panes (R8.1) ------------------------------
  while (root.firstChild) root.removeChild(root.firstChild);

  const container = doc.createElement('div');
  container.className = 'prompt-editor';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', '프롬프트 편집 (2분할)');

  // Each pane is a column: a small visible caption label ("원본" / "수정본")
  // above its textarea. The textareas keep their established class names
  // (`.editor-original` / `.editor-input`) so CSS, main.js, scroll-sync and the
  // tests that select them continue to work; the exported `originalPane` /
  // `editorPane` remain the textarea elements. The `.editor-pane` wrappers are
  // the flex children that lay out 1:1 side by side at >= 768px (R8.1).

  // Left: Original_Pane — read-only (R8.2). A readonly <textarea> keeps the
  // original as literal text (line breaks preserved) and shares the same
  // scroll semantics as the editor pane, which makes ratio-based scroll sync
  // (R8.7) symmetric and testable.
  const originalColumn = doc.createElement('div');
  originalColumn.className = 'editor-pane';

  const originalLabel = doc.createElement('div');
  originalLabel.className = 'editor-pane-label';
  originalLabel.textContent = '원본';

  const originalPane = doc.createElement('textarea');
  originalPane.className = 'editor-original';
  originalPane.setAttribute('aria-label', '원본 (읽기 전용)');
  originalPane.readOnly = true;
  originalPane.value = original; // character-for-character original.

  originalColumn.appendChild(originalLabel);
  originalColumn.appendChild(originalPane);

  // Right: Editor_Pane — editable textarea (R8.4), monospace via class (R8.5).
  const editorColumn = doc.createElement('div');
  editorColumn.className = 'editor-pane';

  const editorLabel = doc.createElement('div');
  editorLabel.className = 'editor-pane-label';
  editorLabel.textContent = '수정본';

  const editorPane = doc.createElement('textarea');
  editorPane.className = 'editor-input';
  editorPane.setAttribute('aria-label', '편집 영역');
  // R8.3 / R8.5: seed with the original, char-for-char, line breaks preserved.
  editorPane.value = original;

  editorColumn.appendChild(editorLabel);
  editorColumn.appendChild(editorPane);

  container.appendChild(originalColumn);
  container.appendChild(editorColumn);
  root.appendChild(container);

  // --- State ---------------------------------------------------------------
  /** Guards against the scroll-sync echo loop (R8.7). */
  let isSyncing = false;
  /** @type {any} pending debounce timer id (R9.2). */
  let changeTimer = null;

  // --- Scroll sync (R8.7) --------------------------------------------------

  /**
   * Compute a pane's vertical scroll ratio in [0, 1]. Guards divide-by-zero
   * for non-scrollable panes (scrollHeight <= clientHeight) by returning 0.
   * @param {HTMLElement} el
   * @returns {number}
   */
  function scrollRatioOf(el) {
    const denom = el.scrollHeight - el.clientHeight;
    if (!denom || denom <= 0) return 0;
    const r = el.scrollTop / denom;
    if (r < 0) return 0;
    if (r > 1) return 1;
    return r;
  }

  /**
   * Apply a scroll ratio to a pane, mapping [0,1] back onto its scrollable
   * range. Non-scrollable panes keep scrollTop at 0 (divide-by-zero guard).
   * @param {HTMLElement} el
   * @param {number} ratio
   */
  function applyScrollRatio(el, ratio) {
    const denom = el.scrollHeight - el.clientHeight;
    el.scrollTop = denom > 0 ? denom * ratio : 0;
  }

  /**
   * Build a scroll handler that mirrors `source`'s ratio onto `target` within
   * the same tick (<< 100ms, R8.7). The `isSyncing` flag suppresses the echo
   * scroll event the programmatic `scrollTop` assignment would otherwise raise.
   * @param {HTMLElement} source
   * @param {HTMLElement} target
   * @returns {() => void}
   */
  function makeScrollSync(source, target) {
    return function onScroll() {
      if (isSyncing) return;
      isSyncing = true;
      try {
        applyScrollRatio(target, scrollRatioOf(source));
      } finally {
        isSyncing = false;
      }
    };
  }

  const onOriginalScroll = makeScrollSync(originalPane, editorPane);
  const onEditorScroll = makeScrollSync(editorPane, originalPane);
  originalPane.addEventListener('scroll', onOriginalScroll);
  editorPane.addEventListener('scroll', onEditorScroll);

  // --- Debounced change notification (R9.2) --------------------------------

  /** Clear any pending debounce timer. */
  function clearChangeTimer() {
    if (changeTimer !== null) {
      clearTimeoutFn(changeTimer);
      changeTimer = null;
    }
  }

  /**
   * Schedule a trailing-edge debounced `onChangeDebounced` call. Rapid edits
   * reset the timer, so only the final value fires after `debounceMs` (R9.2).
   */
  function scheduleChange() {
    if (!onChange) return;
    clearChangeTimer();
    changeTimer = setTimeoutFn(() => {
      changeTimer = null;
      onChange(editorPane.value);
    }, debounceMs);
  }

  function onInput() {
    scheduleChange();
  }
  editorPane.addEventListener('input', onInput);

  // --- Public API ----------------------------------------------------------

  /**
   * Dirty when the editor value differs from the original char-for-char (R8.8).
   * @returns {boolean}
   */
  function isDirty() {
    return editorPane.value !== original;
  }

  return {
    element: container,
    originalPane,
    editorPane,

    /** @returns {string} The current editor value. */
    getValue() {
      return editorPane.value;
    },

    /**
     * Programmatically set the editor value (does not fire the debounced
     * change — callers that want notification can call `flush` afterwards).
     * @param {string} value
     */
    setValue(value) {
      editorPane.value = typeof value === 'string' ? value : '';
    },

    /** @returns {string} The original content (char-for-char). */
    getOriginal() {
      return original;
    },

    isDirty,

    /**
     * Exit guard (R8.8). If not dirty, resolves true immediately (safe to
     * leave). If dirty, invokes `confirmFn()` (which may return a boolean or a
     * Promise<boolean>) and resolves with that result; when the user does NOT
     * confirm, the editor content is left exactly as-is.
     *
     * @param {() => (boolean|Promise<boolean>)} confirmFn
     * @returns {Promise<boolean>} true when it is OK to exit.
     */
    async confirmExitIfDirty(confirmFn) {
      if (!isDirty()) return true;
      if (typeof confirmFn !== 'function') return false;
      const confirmed = await confirmFn();
      // On a decline we keep the current editor content unchanged (R8.8).
      return confirmed === true;
    },

    /**
     * Immediately fire the pending debounced change (if any) with the current
     * value, cancelling the timer. Useful for tests and for flushing before a
     * mode switch.
     */
    flush() {
      if (changeTimer !== null) {
        clearChangeTimer();
      }
      if (onChange) onChange(editorPane.value);
    },

    /** Tear down listeners and empty the container. */
    destroy() {
      clearChangeTimer();
      originalPane.removeEventListener('scroll', onOriginalScroll);
      editorPane.removeEventListener('scroll', onEditorScroll);
      editorPane.removeEventListener('input', onInput);
      while (root.firstChild) root.removeChild(root.firstChild);
    },
  };
}

export default createPromptEditor;
