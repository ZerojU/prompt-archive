import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPromptViewer, toPlainText } from '../src/components/PromptViewer.js';

/**
 * jsdom unit tests for the PromptViewer component (Task 11.4).
 *
 * Covers:
 *   - Action buttons (복사/편집/다운로드/원본 보기) always visible (R7.1, R6.1).
 *   - Loading indicator shown during load then replaced by content (R5.2, R5.3).
 *   - Load failure shows an error AND keeps the previous view (R5.6).
 *   - Empty content shows the "표시할 내용 없음" message (R5.7).
 *   - Copy_Feedback appears on success then auto-removes after 3000ms (R6.3/R6.4),
 *     using fake timers.
 *   - Clipboard unavailable / rejection failure paths (R6.5, R6.6).
 *   - 원본 보기 toggles raw-source-as-text and back (R7.3, R7.4).
 *   - 편집 fires onEdit (R7.2).
 *   - Action guard when no prompt is displayed (R7.7).
 *
 * _Requirements: 5.2, 5.3, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 *                7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7._
 */

/** A promptLoader stub whose `loadPrompt` returns a preconfigured result. */
function makeLoader(result) {
  return {
    loadPrompt: vi.fn(async () => result),
  };
}

function makeRoot() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

const SAMPLE_REF = { title: 'Spring', file: 'prompts/backend/spring.html', path: 'backend' };

let root;
afterEach(() => {
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  vi.restoreAllMocks();
});

describe('toPlainText (Property 8 target, example-based)', () => {
  it('strips tags while preserving readable text', () => {
    expect(toPlainText('<p>hello <b>world</b></p>')).toBe('hello world');
  });

  it('decodes entities and contains no tag markers', () => {
    const out = toPlainText('<span>a &amp; b</span>');
    expect(out).toBe('a & b');
    expect(out.includes('<')).toBe(false);
    expect(out.includes('>')).toBe(false);
  });

  it('returns empty string for empty/non-string input', () => {
    expect(toPlainText('')).toBe('');
    expect(toPlainText(null)).toBe('');
    expect(toPlainText(undefined)).toBe('');
  });
});

describe('PromptViewer — action buttons always visible (R6.1, R7.1)', () => {
  it('renders 복사/편집/다운로드/원본 보기 buttons immediately, before any load', () => {
    root = makeRoot();
    createPromptViewer(root, { promptLoader: makeLoader({ ok: true, content: 'x', rawHtml: '<html></html>' }) });

    expect(root.querySelector('.prompt-action-copy')).toBeTruthy();
    expect(root.querySelector('.prompt-action-edit')).toBeTruthy();
    expect(root.querySelector('.prompt-action-download')).toBeTruthy();
    expect(root.querySelector('.prompt-action-raw')).toBeTruthy();

    for (const b of root.querySelectorAll('.prompt-action')) {
      expect(b.disabled).toBe(false);
    }
  });
});

describe('PromptViewer — loading then content (R5.2, R5.3)', () => {
  it('shows the loading indicator while loading, then renders sanitized content', async () => {
    root = makeRoot();
    let resolveLoad;
    const loader = {
      loadPrompt: vi.fn(
        () =>
          new Promise((res) => {
            resolveLoad = res;
          }),
      ),
    };
    const viewer = createPromptViewer(root, { promptLoader: loader });

    const showPromise = viewer.show(SAMPLE_REF);

    // While in flight, loading indicator is visible.
    const loadingEl = root.querySelector('.prompt-loading');
    expect(loadingEl.hidden).toBe(false);

    resolveLoad({ ok: true, content: '<p>Hello prompt</p>', rawHtml: '<html><body><p>Hello prompt</p></body></html>' });
    await showPromise;

    // Loading hidden, content rendered as HTML (not literal tags).
    expect(loadingEl.hidden).toBe(true);
    const contentEl = root.querySelector('.prompt-content');
    expect(contentEl.querySelector('p')).toBeTruthy();
    expect(contentEl.textContent).toContain('Hello prompt');
  });
});

describe('PromptViewer — load failure keeps previous view (R5.6)', () => {
  it('shows an error and does not blank the previously displayed content', async () => {
    root = makeRoot();
    const loader = {
      loadPrompt: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, content: '<p>first</p>', rawHtml: '<html><body><p>first</p></body></html>' })
        .mockResolvedValueOnce({ ok: false, error: '프롬프트 로드 실패 (HTTP 404)' }),
    };
    const viewer = createPromptViewer(root, { promptLoader: loader });

    await viewer.show(SAMPLE_REF);
    const contentEl = root.querySelector('.prompt-content');
    expect(contentEl.textContent).toContain('first');

    await viewer.show({ title: 'Missing', file: 'prompts/missing.html', path: '' });

    const errorEl = root.querySelector('.prompt-error');
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toContain('404');
    // Previous content preserved (R5.6).
    expect(contentEl.textContent).toContain('first');
  });
});

describe('PromptViewer — empty content (R5.7)', () => {
  it('shows the "표시할 내용 없음" message', async () => {
    root = makeRoot();
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '', empty: true, rawHtml: '<html></html>' }),
    });
    await viewer.show(SAMPLE_REF);

    const emptyEl = root.querySelector('.prompt-empty');
    expect(emptyEl).toBeTruthy();
    expect(emptyEl.textContent).toContain('표시할 내용 없음');
  });
});

describe('PromptViewer — Copy_Feedback auto-remove after 3000ms (R6.3, R6.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "복사되었습니다" then removes it after 3000ms', async () => {
    root = makeRoot();
    const writeText = vi.fn(async () => {});
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '<p>copy me</p>', rawHtml: '<html></html>' }),
      clipboard: { writeText },
    });

    await viewer.show(SAMPLE_REF);
    const ok = await viewer.copyAll();
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe('copy me'); // plain text (R6.2)

    const feedback = root.querySelector('.prompt-feedback');
    expect(feedback.textContent).toBe('복사되었습니다');

    // Still present just under the window (>= 2s per R7.5).
    vi.advanceTimersByTime(2999);
    expect(feedback.textContent).toBe('복사되었습니다');

    // Auto-removed at 3000ms.
    vi.advanceTimersByTime(1);
    expect(feedback.textContent).toBe('');
  });
});

describe('PromptViewer — clipboard failure paths (R6.5, R6.6)', () => {
  it('shows unavailable message when clipboard API is missing (R6.6)', async () => {
    root = makeRoot();
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '<p>x</p>', rawHtml: '<html></html>' }),
      clipboard: null, // explicitly unavailable
    });
    await viewer.show(SAMPLE_REF);
    const ok = await viewer.copyAll();
    expect(ok).toBe(false);
    expect(root.querySelector('.prompt-feedback').textContent).toContain('복사할 수 없습니다');
  });

  it('shows failure message and keeps content when writeText rejects (R6.5)', async () => {
    root = makeRoot();
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '<p>keep me</p>', rawHtml: '<html></html>' }),
      clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) },
    });
    await viewer.show(SAMPLE_REF);
    const ok = await viewer.copyAll();
    expect(ok).toBe(false);
    expect(root.querySelector('.prompt-feedback').textContent).toContain('실패');
    // content unchanged (R6.5)
    expect(viewer.getState().content).toBe('<p>keep me</p>');
    expect(root.querySelector('.prompt-content').textContent).toContain('keep me');
  });
});

describe('PromptViewer — 원본 보기 toggle (R7.3, R7.4)', () => {
  it('toggles raw source as literal text and back to rendered', async () => {
    root = makeRoot();
    const raw = '<html><body><section class="prompt-content"><p>hi</p></section></body></html>';
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '<p>hi</p>', rawHtml: raw }),
    });
    await viewer.show(SAMPLE_REF);

    const contentEl = root.querySelector('.prompt-content');
    // Rendered view: a real <p> element exists.
    expect(contentEl.querySelector('p')).toBeTruthy();

    // Toggle to raw: source shown as text, so the raw string appears literally
    // and there is NO parsed <section> element from the raw string.
    viewer.toggleRawView();
    const pre = contentEl.querySelector('pre.prompt-raw');
    expect(pre).toBeTruthy();
    expect(pre.textContent).toBe(raw);
    expect(pre.textContent).toContain('<section');
    // The raw <p> is literal text inside <pre>, not a separate rendered node
    // beyond the pre itself.
    expect(contentEl.querySelector('section')).toBeNull();

    // Toggle back to rendered view (R7.4).
    viewer.toggleRawView();
    expect(contentEl.querySelector('pre.prompt-raw')).toBeNull();
    expect(contentEl.querySelector('p')).toBeTruthy();
  });
});

describe('PromptViewer — line breaks preserved in rendered + raw views (Bug 2)', () => {
  // Prompt bodies are stored as plain text with LITERAL newlines inside
  // <section class="prompt-content">. The viewer (and CSS white-space:pre-wrap)
  // must preserve those line breaks in both views. jsdom cannot measure CSS
  // whitespace rendering, so we assert the structural + content contract: the
  // DOM keeps the \n characters. The CSS (white-space:pre-wrap on
  // .prompt-content and .prompt-raw) is verified via the build.
  const MULTILINE = '첫 번째 줄\n두 번째 줄\n[입력]\n- 항목';
  const RAW =
    '<!DOCTYPE html><html><body><section class="prompt-content">' +
    MULTILINE +
    '</section></body></html>';

  it('raw view keeps newline characters and renders a <pre class="prompt-raw">', async () => {
    root = makeRoot();
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: MULTILINE, rawHtml: RAW }),
    });
    await viewer.show(SAMPLE_REF);

    viewer.toggleRawView();

    const pre = root.querySelector('pre.prompt-raw');
    expect(pre).toBeTruthy();
    // Structural contract: a PRE element carrying the prompt-raw class.
    expect(pre.tagName).toBe('PRE');
    expect(pre.classList.contains('prompt-raw')).toBe(true);
    // Content contract: the raw source still contains the literal newlines.
    expect(pre.textContent).toBe(RAW);
    expect(pre.textContent.includes('\n')).toBe(true);
    // Specifically, the multi-line body newlines survive.
    expect(pre.textContent).toContain('첫 번째 줄\n두 번째 줄');
  });

  it('rendered view keeps the newlines in .prompt-content text', async () => {
    root = makeRoot();
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: MULTILINE, rawHtml: RAW }),
    });
    await viewer.show(SAMPLE_REF);

    const contentEl = root.querySelector('.prompt-content');
    // The DOM retains the newline characters; white-space:pre-wrap (asserted via
    // build) is what makes them visible rather than collapsed.
    expect(contentEl.textContent.includes('\n')).toBe(true);
    expect(contentEl.textContent).toContain('첫 번째 줄\n두 번째 줄');
  });
});

describe('PromptViewer — 편집 fires onEdit (R7.2)', () => {
  it('invokes onEdit with promptRef, content, rawHtml', async () => {
    root = makeRoot();
    const onEdit = vi.fn();
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '<p>edit</p>', rawHtml: '<html>raw</html>' }),
      onEdit,
    });
    await viewer.show(SAMPLE_REF);
    root.querySelector('.prompt-action-edit').click();

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toEqual(SAMPLE_REF);
    expect(onEdit.mock.calls[0][1]).toBe('<p>edit</p>');
    expect(onEdit.mock.calls[0][2]).toBe('<html>raw</html>');
  });
});

describe('PromptViewer — 다운로드 wires downloadService (R7.6)', () => {
  it('calls triggerDownload with rawHtml and a proposed filename', async () => {
    root = makeRoot();
    const downloadService = {
      buildModifiedHtml: vi.fn(),
      proposeFilename: vi.fn((n) => `${n}.out`),
      triggerDownload: vi.fn(),
    };
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: '<p>d</p>', rawHtml: '<html>doc</html>' }),
      downloadService,
    });
    await viewer.show(SAMPLE_REF);
    root.querySelector('.prompt-action-download').click();

    expect(downloadService.proposeFilename).toHaveBeenCalledWith('spring.html');
    expect(downloadService.triggerDownload).toHaveBeenCalledTimes(1);
    expect(downloadService.triggerDownload.mock.calls[0][0]).toBe('<html>doc</html>');
    expect(downloadService.triggerDownload.mock.calls[0][1]).toBe('spring.html.out');
  });
});

describe('PromptViewer — action guard with no prompt (R7.7)', () => {
  it('does nothing and shows "선택된 프롬프트가 없습니다" for each action', async () => {
    root = makeRoot();
    const onEdit = vi.fn();
    const downloadService = { buildModifiedHtml: vi.fn(), proposeFilename: vi.fn(), triggerDownload: vi.fn() };
    const writeText = vi.fn(async () => {});
    const viewer = createPromptViewer(root, {
      promptLoader: makeLoader({ ok: true, content: 'x', rawHtml: 'x' }),
      onEdit,
      downloadService,
      clipboard: { writeText },
    });

    const errorEl = root.querySelector('.prompt-error');

    root.querySelector('.prompt-action-edit').click();
    expect(onEdit).not.toHaveBeenCalled();
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toContain('선택된 프롬프트가 없습니다');

    root.querySelector('.prompt-action-download').click();
    expect(downloadService.triggerDownload).not.toHaveBeenCalled();

    const copied = await viewer.copyAll();
    expect(copied).toBe(false);
    expect(writeText).not.toHaveBeenCalled();

    // Raw toggle guard: no pre rendered.
    viewer.toggleRawView();
    expect(root.querySelector('pre.prompt-raw')).toBeNull();
  });
});
