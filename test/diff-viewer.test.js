import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderDiff, createDiffView, isNoChange } from '../src/components/DiffViewer.js';
import { computeDiff } from '../src/utils/diff.js';

/**
 * jsdom unit tests for the DiffViewer component (Task 14.2).
 *
 * Covers:
 *   - renderDiff applies the added-highlight class to added segments and the
 *     removed class + strikethrough to removed segments; unchanged segments
 *     carry no highlight class (R9.4, R9.5).
 *   - A change (removed segment immediately followed by added segment) renders
 *     both before(strikethrough) and after(highlight) adjacently (R9.6).
 *   - Segment values are rendered via textContent (markup appears literally).
 *   - No-change case: segments with no added/removed → a "변경 없음" indicator
 *     is present and no .diff-added / .diff-removed elements (R9.3).
 *   - createDiffView.update: renders expected highlights; identical inputs →
 *     변경 없음 indicator; when computeDiffImpl throws, an error indicator is
 *     shown and the previous (last good) rendering is preserved (R9.7).
 *
 * _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7._
 */

function makeRoot() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

let root;
afterEach(() => {
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  vi.restoreAllMocks();
});

describe('isNoChange', () => {
  it('is true for empty / unchanged-only segments', () => {
    expect(isNoChange([])).toBe(true);
    expect(isNoChange([{ value: 'same text' }])).toBe(true);
  });

  it('is false when any segment is added or removed', () => {
    expect(isNoChange([{ value: 'x', added: true }])).toBe(false);
    expect(isNoChange([{ value: 'y', removed: true }])).toBe(false);
    expect(isNoChange([{ value: 'a' }, { value: 'b', added: true }])).toBe(false);
  });
});

describe('renderDiff — highlight classes (R9.4, R9.5)', () => {
  it('wraps added text with the added class and removed text with the removed class', () => {
    root = makeRoot();
    renderDiff(root, [
      { value: 'keep ' },
      { value: 'old', removed: true },
      { value: 'new', added: true },
    ]);

    const added = root.querySelector('.diff-added');
    const removed = root.querySelector('.diff-removed');

    expect(added).toBeTruthy();
    expect(added.textContent).toBe('new');
    expect(removed).toBeTruthy();
    expect(removed.textContent).toBe('old');
  });

  it('uses <ins> for added and <del> for removed so strikethrough applies to removed', () => {
    root = makeRoot();
    renderDiff(root, [
      { value: 'old', removed: true },
      { value: 'new', added: true },
    ]);

    const added = root.querySelector('.diff-added');
    const removed = root.querySelector('.diff-removed');

    // <del> carries the removed-with-strikethrough semantics (R9.5); the
    // element choice (<del>) is what the CSS targets for strikethrough.
    expect(removed.tagName).toBe('DEL');
    expect(added.tagName).toBe('INS');
  });

  it('renders unchanged segments with no highlight class', () => {
    root = makeRoot();
    renderDiff(root, [
      { value: 'unchanged part ' },
      { value: 'added', added: true },
    ]);

    const unchanged = root.querySelector('.diff-unchanged');
    expect(unchanged).toBeTruthy();
    expect(unchanged.textContent).toBe('unchanged part ');
    expect(unchanged.classList.contains('diff-added')).toBe(false);
    expect(unchanged.classList.contains('diff-removed')).toBe(false);
  });
});

describe('renderDiff — change = adjacent removed + added (R9.6)', () => {
  it('renders a removed segment immediately followed by an added segment adjacently', () => {
    root = makeRoot();
    renderDiff(root, [
      { value: 'prefix ' },
      { value: 'before', removed: true },
      { value: 'after', added: true },
      { value: ' suffix' },
    ]);

    const nodes = Array.from(root.querySelectorAll('.diff-segments > *'));
    // Find the removed node and assert the very next sibling is the added node.
    const removedIdx = nodes.findIndex((n) => n.classList.contains('diff-removed'));
    expect(removedIdx).toBeGreaterThanOrEqual(0);

    const next = nodes[removedIdx + 1];
    expect(next).toBeTruthy();
    expect(next.classList.contains('diff-added')).toBe(true);
    expect(nodes[removedIdx].textContent).toBe('before');
    expect(next.textContent).toBe('after');
  });
});

describe('renderDiff — values rendered as textContent (no markup injection)', () => {
  it('renders a value like "<b>x</b>" literally, not as a real <b> element', () => {
    root = makeRoot();
    renderDiff(root, [{ value: '<b>x</b>', added: true }]);

    const added = root.querySelector('.diff-added');
    expect(added.textContent).toBe('<b>x</b>');
    // No real <b> element was created inside the diff output.
    expect(root.querySelector('b')).toBeNull();
  });
});

describe('renderDiff — no change (R9.3)', () => {
  it('shows a "변경 없음" indicator and no add/del highlights for unchanged-only segments', () => {
    root = makeRoot();
    renderDiff(root, [{ value: 'identical content' }]);

    const note = root.querySelector('.diff-nochange');
    expect(note).toBeTruthy();
    expect(note.textContent).toBe('변경 없음');
    expect(root.querySelector('.diff-added')).toBeNull();
    expect(root.querySelector('.diff-removed')).toBeNull();
  });

  it('shows the "변경 없음" indicator for an empty segment array', () => {
    root = makeRoot();
    renderDiff(root, []);
    expect(root.querySelector('.diff-nochange')).toBeTruthy();
  });

  it('clears previous rendering when re-rendered as no-change', () => {
    root = makeRoot();
    renderDiff(root, [{ value: 'x', added: true }]);
    expect(root.querySelector('.diff-added')).toBeTruthy();

    renderDiff(root, [{ value: 'x' }]);
    expect(root.querySelector('.diff-added')).toBeNull();
    expect(root.querySelector('.diff-nochange')).toBeTruthy();
  });
});

describe('createDiffView.update — integration with computeDiff', () => {
  it('renders added/removed highlights for a real diff (R9.4/R9.5)', () => {
    root = makeRoot();
    const view = createDiffView(root);

    const ok = view.update('the quick fox', 'the slow fox');
    expect(ok).toBe(true);

    expect(root.querySelector('.diff-added')).toBeTruthy();
    expect(root.querySelector('.diff-removed')).toBeTruthy();
    expect(root.querySelector('.diff-nochange')).toBeNull();
  });

  it('shows the 변경 없음 indicator when inputs are identical (R9.3)', () => {
    root = makeRoot();
    const view = createDiffView(root);

    const ok = view.update('same string', 'same string');
    expect(ok).toBe(true);

    expect(root.querySelector('.diff-nochange')).toBeTruthy();
    expect(root.querySelector('.diff-nochange').textContent).toBe('변경 없음');
    expect(root.querySelector('.diff-added')).toBeNull();
    expect(root.querySelector('.diff-removed')).toBeNull();
  });

  it('uses the real computeDiff by default (no change for computeDiff(x, x))', () => {
    root = makeRoot();
    const view = createDiffView(root);
    // Sanity: the default impl is the real one and agrees on no-change.
    expect(isNoChange(computeDiff('abc def', 'abc def'))).toBe(true);
    view.update('abc def', 'abc def');
    expect(root.querySelector('.diff-nochange')).toBeTruthy();
  });

  it('shows an error indicator and PRESERVES the previous rendering when computeDiff throws (R9.7)', () => {
    root = makeRoot();
    let shouldThrow = false;
    const computeDiffImpl = vi.fn((a, b) => {
      if (shouldThrow) {
        throw new Error('boom');
      }
      return computeDiff(a, b);
    });

    const view = createDiffView(root, { computeDiffImpl });

    // First, a good render that produces highlights.
    const firstOk = view.update('hello world', 'hello brave world');
    expect(firstOk).toBe(true);
    const addedBefore = root.querySelector('.diff-added');
    expect(addedBefore).toBeTruthy();
    const addedTextBefore = addedBefore.textContent;
    expect(root.querySelector('.diff-error').hidden).toBe(true);

    // Now force a failure on the next update.
    shouldThrow = true;
    const secondOk = view.update('hello world', 'totally different');
    expect(secondOk).toBe(false);

    // R9.7: error indicator is shown...
    const errorEl = root.querySelector('.diff-error');
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent.length).toBeGreaterThan(0);

    // ...and the previous (last good) rendering is preserved unchanged.
    const addedAfter = root.querySelector('.diff-added');
    expect(addedAfter).toBeTruthy();
    expect(addedAfter.textContent).toBe(addedTextBefore);
  });

  it('clears the error indicator on a subsequent successful update', () => {
    root = makeRoot();
    let shouldThrow = true;
    const computeDiffImpl = vi.fn((a, b) => {
      if (shouldThrow) throw new Error('boom');
      return computeDiff(a, b);
    });
    const view = createDiffView(root, { computeDiffImpl });

    view.update('a', 'b'); // throws → error shown
    expect(root.querySelector('.diff-error').hidden).toBe(false);

    shouldThrow = false;
    view.update('a', 'b'); // succeeds → error cleared
    expect(root.querySelector('.diff-error').hidden).toBe(true);
  });

  it('starts in the 변경 없음 state and clear() resets to it', () => {
    root = makeRoot();
    const view = createDiffView(root);
    expect(root.querySelector('.diff-nochange')).toBeTruthy();

    view.update('x', 'y z');
    expect(root.querySelector('.diff-nochange')).toBeNull();

    view.clear();
    expect(root.querySelector('.diff-nochange')).toBeTruthy();
  });
});
