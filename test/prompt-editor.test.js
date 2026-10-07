import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPromptEditor } from '../src/components/PromptEditor.js';

/**
 * jsdom unit tests for the PromptEditor component (Task 13.2).
 *
 * Covers:
 *   - Exactly two panes rendered (R8.1); the Original_Pane is read-only (R8.2)
 *     and shows the original text; the Editor_Pane is an editable textarea
 *     (R8.4) seeded with the original (R8.3).
 *   - Debounced change notification (R9.2): `onChangeDebounced` is NOT called
 *     before 300ms, is called exactly once with the latest value after 300ms,
 *     and rapid edits collapse to a single trailing call.
 *   - Scroll sync (R8.7): scrolling one pane mirrors the ratio onto the other
 *     within the same tick; divide-by-zero on non-scrollable panes is guarded.
 *   - Dirty-state exit confirmation (R8.8): unchanged content exits without
 *     confirming; changed content invokes the confirm callback and only
 *     proceeds when confirmed, retaining content on decline.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 9.2._
 */

function makeRoot() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

/**
 * jsdom does not perform layout, so scrollHeight/clientHeight are 0. Fake a
 * scrollable geometry on a pane so ratio-based sync can be exercised
 * deterministically.
 * @param {HTMLElement} el
 * @param {number} scrollHeight
 * @param {number} clientHeight
 */
function fakeScrollable(el, scrollHeight, clientHeight) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
}

let root;
let editor;
afterEach(() => {
  if (editor && typeof editor.destroy === 'function') editor.destroy();
  editor = null;
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  vi.restoreAllMocks();
});

describe('PromptEditor — exactly 2 panes, read-only original (R8.1, R8.2, R8.4)', () => {
  it('renders exactly two panes: a read-only original and an editable textarea', () => {
    root = makeRoot();
    const original = 'line one\nline two';
    editor = createPromptEditor(root, original, () => {});

    const container = root.querySelector('.prompt-editor');
    expect(container).toBeTruthy();

    // EXACTLY two panes (R8.1): each a `.editor-pane` column holding a visible
    // caption label followed by exactly one textarea.
    const panes = container.querySelectorAll('.editor-pane');
    expect(panes.length).toBe(2);
    expect(container.children.length).toBe(2);

    // Exactly two textareas total: the read-only original and the editable input.
    expect(root.querySelectorAll('.prompt-editor textarea').length).toBe(2);

    // Each pane has a label + a single textarea, in that order.
    const [leftPane, rightPane] = panes;
    const leftLabel = leftPane.querySelector('.editor-pane-label');
    const rightLabel = rightPane.querySelector('.editor-pane-label');
    expect(leftLabel).toBeTruthy();
    expect(rightLabel).toBeTruthy();
    expect(leftLabel.textContent).toBe('원본');
    expect(rightLabel.textContent).toBe('수정본');
    expect(leftPane.querySelectorAll('textarea').length).toBe(1);
    expect(rightPane.querySelectorAll('textarea').length).toBe(1);

    const originalPane = root.querySelector('.editor-original');
    const editorPane = root.querySelector('.editor-input');
    expect(originalPane).toBeTruthy();
    expect(editorPane).toBeTruthy();
    // The textareas keep their class names and live inside their panes.
    expect(leftPane.querySelector('textarea')).toBe(originalPane);
    expect(rightPane.querySelector('textarea')).toBe(editorPane);

    // Original_Pane is read-only and shows the original (R8.2).
    expect(originalPane.readOnly).toBe(true);
    expect(originalPane.value).toBe(original);

    // Editor_Pane is an editable <textarea> (R8.4), not read-only, seeded with
    // the original char-for-char (R8.3).
    expect(editorPane.tagName).toBe('TEXTAREA');
    expect(editorPane.readOnly).toBe(false);
    expect(editorPane.value).toBe(original);
  });

  it('preserves every line break and trailing whitespace in the editor seed (R8.3, R8.5)', () => {
    // A <textarea> canonicalizes CRLF/CR to LF on its `value` (HTML spec
    // "textarea line break normalization"), so the component normalizes the
    // original up front. Fidelity means every line break survives as `\n` and
    // all other characters (including trailing whitespace) are preserved.
    root = makeRoot();
    const original = 'a\r\nb\n  c  \n';
    const expected = 'a\nb\n  c  \n';
    editor = createPromptEditor(root, original, () => {});
    expect(editor.getValue()).toBe(expected);
    expect(root.querySelector('.editor-input').value).toBe(expected);
    // No line break is lost: the number of newlines is unchanged.
    expect((editor.getValue().match(/\n/g) || []).length).toBe(
      (original.match(/\r\n|\r|\n/g) || []).length,
    );
  });
});

describe('PromptEditor — debounced change notification (R9.2)', () => {
  it('does not call before 300ms and calls once with the latest value after 300ms', () => {
    vi.useFakeTimers();
    try {
      root = makeRoot();
      const onChange = vi.fn();
      editor = createPromptEditor(root, 'seed', onChange);

      const editorPane = root.querySelector('.editor-input');
      editorPane.value = 'seed edited';
      editorPane.dispatchEvent(new window.Event('input'));

      // Not called before the debounce window elapses.
      vi.advanceTimersByTime(299);
      expect(onChange).not.toHaveBeenCalled();

      // Fires once at 300ms with the current value.
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('seed edited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses rapid edits into a single trailing call with the final value', () => {
    vi.useFakeTimers();
    try {
      root = makeRoot();
      const onChange = vi.fn();
      editor = createPromptEditor(root, '', onChange);

      const editorPane = root.querySelector('.editor-input');

      // Three quick edits within the debounce window; the timer keeps resetting.
      editorPane.value = 'a';
      editorPane.dispatchEvent(new window.Event('input'));
      vi.advanceTimersByTime(100);
      editorPane.value = 'ab';
      editorPane.dispatchEvent(new window.Event('input'));
      vi.advanceTimersByTime(100);
      editorPane.value = 'abc';
      editorPane.dispatchEvent(new window.Event('input'));

      // Still nothing — only 100ms since the last edit.
      vi.advanceTimersByTime(299);
      expect(onChange).not.toHaveBeenCalled();

      // One call, with the final value.
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('abc');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PromptEditor — scroll sync by ratio (R8.7)', () => {
  it('mirrors the editor scroll ratio onto the original pane', () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'x', () => {});
    const originalPane = root.querySelector('.editor-original');
    const editorPane = root.querySelector('.editor-input');

    // Both panes scrollable: editor range 800px, original range 300px.
    fakeScrollable(editorPane, 1000, 200); // range 800
    fakeScrollable(originalPane, 500, 200); // range 300

    // Scroll the editor to 50% (400 / 800).
    editorPane.scrollTop = 400;
    editorPane.dispatchEvent(new window.Event('scroll'));

    // Original pane should sit at 50% of its own range: 0.5 * 300 = 150.
    expect(originalPane.scrollTop).toBe(150);
  });

  it('mirrors the original scroll ratio onto the editor pane (both directions)', () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'x', () => {});
    const originalPane = root.querySelector('.editor-original');
    const editorPane = root.querySelector('.editor-input');

    fakeScrollable(originalPane, 1000, 200); // range 800
    fakeScrollable(editorPane, 500, 200); // range 300

    // Scroll the original to 25% (200 / 800).
    originalPane.scrollTop = 200;
    originalPane.dispatchEvent(new window.Event('scroll'));

    // Editor pane at 25% of its own range: 0.25 * 300 = 75.
    expect(editorPane.scrollTop).toBe(75);
  });

  it('does not infinitely echo (the sync of one pane does not re-trigger a sync back)', () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'x', () => {});
    const originalPane = root.querySelector('.editor-original');
    const editorPane = root.querySelector('.editor-input');

    fakeScrollable(editorPane, 1000, 200); // range 800
    fakeScrollable(originalPane, 1000, 200); // range 800 (equal ranges)

    editorPane.scrollTop = 800; // 100%
    editorPane.dispatchEvent(new window.Event('scroll'));

    // Original mirrored to 100% without feedback shifting the editor off 800.
    expect(originalPane.scrollTop).toBe(800);
    expect(editorPane.scrollTop).toBe(800);
  });

  it('guards divide-by-zero for a non-scrollable target pane', () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'x', () => {});
    const originalPane = root.querySelector('.editor-original');
    const editorPane = root.querySelector('.editor-input');

    fakeScrollable(editorPane, 1000, 200); // scrollable, range 800
    fakeScrollable(originalPane, 200, 200); // NOT scrollable (range 0)

    editorPane.scrollTop = 400;
    editorPane.dispatchEvent(new window.Event('scroll'));

    // No NaN / no throw; non-scrollable pane stays at 0.
    expect(originalPane.scrollTop).toBe(0);
  });
});

describe('PromptEditor — dirty-state exit confirmation (R8.8)', () => {
  it('is not dirty when unchanged and exits without confirming', async () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'same', () => {});

    expect(editor.isDirty()).toBe(false);

    const confirmFn = vi.fn(() => false);
    const canExit = await editor.confirmExitIfDirty(confirmFn);

    expect(canExit).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('is dirty when changed; invokes confirm and proceeds only when confirmed', async () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'original', () => {});

    const editorPane = root.querySelector('.editor-input');
    editorPane.value = 'original + edits';
    expect(editor.isDirty()).toBe(true);

    // Decline: exit is blocked and content is retained unchanged.
    const declineFn = vi.fn(() => false);
    const blocked = await editor.confirmExitIfDirty(declineFn);
    expect(declineFn).toHaveBeenCalledTimes(1);
    expect(blocked).toBe(false);
    expect(editor.getValue()).toBe('original + edits');
    expect(editor.isDirty()).toBe(true);

    // Confirm: exit proceeds.
    const confirmFn = vi.fn(() => true);
    const allowed = await editor.confirmExitIfDirty(confirmFn);
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(true);
  });

  it('supports an async confirm callback (Promise<boolean>)', async () => {
    root = makeRoot();
    editor = createPromptEditor(root, 'o', () => {});
    root.querySelector('.editor-input').value = 'o changed';

    const asyncConfirm = vi.fn(async () => true);
    const allowed = await editor.confirmExitIfDirty(asyncConfirm);
    expect(allowed).toBe(true);
    expect(asyncConfirm).toHaveBeenCalledTimes(1);
  });
});
