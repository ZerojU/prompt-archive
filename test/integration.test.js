import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initApp } from '../src/main.js';

/**
 * Integration test for the application shell wiring — Task 15.2.
 *
 * Drives `initApp` with STUBBED collaborators (no real network) in the Vitest
 * jsdom environment and asserts the end-to-end runtime flow of design.md's
 * "런타임 데이터 흐름":
 *
 *   manifest load → Sidebar renders categories/prompts → selecting a prompt
 *   calls the viewer and shows content → entering Edit_Mode shows the 1:1
 *   two-pane editor (diff NOT shown) → editing then toggling "변경 결과 미리보기"
 *   swaps the editor for a full-screen diff preview reflecting the edit →
 *   toggling back restores the editor with the edited content intact →
 *   triggering download calls downloadService.triggerDownload with the
 *   MODIFIED HTML and uses NO network.
 *
 * It also asserts the manifest-load-failure path renders a non-blocking notice
 * and does not throw (_R2.8_).
 *
 * _Requirements: 1.1 (client-only), 2.8 (manifest-failure resilience),
 *                10.7 (download transmits nothing to a server), 14.6 (the app
 *                actually works end-to-end)._
 */

// --- DOM skeleton (mirrors index.html: #app-header / #sidebar / #main) ------

/**
 * Build the index.html app shell skeleton in the current jsdom document.
 * @returns {{sidebar: HTMLElement, main: HTMLElement}}
 */
function buildShellDom() {
  document.body.innerHTML = `
    <div id="app" class="app-layout">
      <header id="app-header" class="app-header"><h1>GitHub Prompt Archive</h1></header>
      <div class="app-body">
        <aside id="sidebar" class="app-sidebar"></aside>
        <main id="main" class="app-main"></main>
      </div>
    </div>
  `;
  return {
    sidebar: /** @type {HTMLElement} */ (document.getElementById('sidebar')),
    main: /** @type {HTMLElement} */ (document.getElementById('main')),
  };
}

// --- Fixtures ---------------------------------------------------------------

/** A display tree with >= 1 category and >= 1 prompt (buildDisplayTree shape). */
function makeTree() {
  return {
    version: 1,
    categories: [
      {
        name: 'backend',
        path: 'backend',
        displayName: '백엔드',
        prompts: [
          {
            title: 'Spring Boot 설정',
            file: 'prompts/backend/spring.html',
            path: 'backend',
            displayName: '스프링 부트',
          },
        ],
        children: [],
      },
    ],
  };
}

/** Original Prompt_File HTML with an identifiable prompt-content region. */
const RAW_HTML =
  '<!DOCTYPE html><html lang="ko"><head><title>Spring Boot 설정</title></head>' +
  '<body><article class="prompt"><section class="prompt-content">원본 프롬프트 본문</section></article></body></html>';

/** The extracted, human-readable content text the viewer shows. */
const EXTRACTED_CONTENT = '원본 프롬프트 본문';

/** Synchronous timer hooks so the editor's debounced change fires immediately. */
const syncTimers = {
  setTimeoutFn: (cb) => {
    cb();
    return 0;
  },
  clearTimeoutFn: () => {},
  debounceMs: 0,
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('initApp — end-to-end flow (Task 15.2)', () => {
  it('loads manifest → renders sidebar → selects prompt → shows content → edits → toggles diff preview → downloads modified HTML with no network', async () => {
    const { sidebar, main } = buildShellDom();

    // A fetch spy we assert is NEVER used during the download step (R1.1/R10.7).
    const fetchImpl = vi.fn();

    // Stub manifest loader: returns a known display tree, no network.
    const loadManifestImpl = vi.fn(async () => ({ ok: true, tree: makeTree() }));

    // Stub prompt loader: returns extracted content + raw HTML, no network.
    const loadPrompt = vi.fn(async () => ({
      ok: true,
      content: EXTRACTED_CONTENT,
      rawHtml: RAW_HTML,
    }));

    // Spy download service — triggerDownload must receive the MODIFIED HTML.
    const triggerDownload = vi.fn();
    const buildModifiedHtml = vi.fn((originalHtml, editedText) => ({
      ok: true,
      html: originalHtml.replace('원본 프롬프트 본문', editedText),
    }));
    const proposeFilename = vi.fn((name) => `${name.replace(/\.html$/, '')}_modified.html`);

    const app = await initApp({
      document,
      sidebarRoot: sidebar,
      mainRoot: main,
      baseUrl: '/',
      fetchImpl,
      loadManifestImpl,
      promptLoader: { loadPrompt },
      downloadService: { buildModifiedHtml, proposeFilename, triggerDownload },
      // Keep sanitizer identity so EXTRACTED_CONTENT renders verbatim.
      sanitizer: (s) => s,
      clipboard: { writeText: vi.fn(async () => {}) },
      // Real computeDiff (default) is fine; editing produces add/del segments.
      confirm: () => true,
      editorOptions: syncTimers,
    });

    // 1) Manifest was loaded (R2.2).
    expect(loadManifestImpl).toHaveBeenCalledTimes(1);

    // 2) Sidebar rendered the category + its prompt (R4).
    const categoryBtn = sidebar.querySelector('.sidebar-category-btn');
    expect(categoryBtn).toBeTruthy();
    expect(categoryBtn.textContent).toBe('백엔드');

    // Click the category to reveal its prompt list.
    categoryBtn.click();
    const promptBtn = sidebar.querySelector('.sidebar-prompt-btn');
    expect(promptBtn).toBeTruthy();
    expect(promptBtn.textContent).toBe('스프링 부트');

    // 3) Selecting the prompt calls the loader and shows the content.
    promptBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadPrompt).toHaveBeenCalledTimes(1);
    const contentEl = main.querySelector('.prompt-content');
    expect(contentEl).toBeTruthy();
    expect(contentEl.textContent).toContain(EXTRACTED_CONTENT);

    // 4) Enter Edit_Mode via the viewer's 편집 button (R7.2).
    const editBtn = main.querySelector('.prompt-action-edit');
    expect(editBtn).toBeTruthy();
    editBtn.click();

    expect(app.getState().mode).toBe('edit');

    // The default Edit_Mode screen is the 1:1 two-pane editor ONLY.
    const editorPanes = main.querySelectorAll('.prompt-editor textarea');
    expect(editorPanes.length).toBe(2); // Original_Pane + Editor_Pane (R8.1).
    expect(main.querySelector('.editor-original')).toBeTruthy();
    expect(main.querySelector('.editor-input')).toBeTruthy();

    // The editor host is visible; the diff preview host is present but hidden,
    // and no diff visualization is on screen yet.
    const editorHost = main.querySelector('.edit-editor-host');
    const previewHost = main.querySelector('.edit-preview-host');
    expect(editorHost).toBeTruthy();
    expect(previewHost).toBeTruthy();
    expect(editorHost.hidden).toBe(false);
    expect(previewHost.hidden).toBe(true);
    expect(main.querySelector('.diff-added, .diff-removed')).toBeFalsy();

    // 5) Edit the content in the editable pane.
    const editorTextarea = main.querySelector('.editor-input');
    expect(editorTextarea).toBeTruthy();
    editorTextarea.value = '수정된 프롬프트 본문';
    editorTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));

    // Toggle "변경 결과 미리보기" → the editor is replaced by a full-screen diff
    // preview reflecting the edit (R9.4/R9.5).
    const previewBtn = main.querySelector('.edit-action-preview');
    expect(previewBtn).toBeTruthy();
    expect(previewBtn.textContent).toBe('변경 결과 미리보기');
    previewBtn.click();

    expect(editorHost.hidden).toBe(true);
    expect(previewHost.hidden).toBe(false);
    expect(previewBtn.textContent).toBe('편집으로 돌아가기');

    const diffView = main.querySelector('.diff-view');
    expect(diffView).toBeTruthy();
    expect(main.querySelector('.diff-nochange')).toBeFalsy();
    expect(main.querySelector('.diff-added, .diff-removed')).toBeTruthy();
    // The preview reflects the edited text (added segment carries the new text).
    const added = main.querySelector('.diff-added');
    expect(added).toBeTruthy();
    expect(added.textContent).toContain('수정된');

    // Toggle back → editor is shown again and STILL holds the typed value.
    previewBtn.click();
    expect(editorHost.hidden).toBe(false);
    expect(previewHost.hidden).toBe(true);
    expect(previewBtn.textContent).toBe('변경 결과 미리보기');
    expect(main.querySelector('.editor-input').value).toBe('수정된 프롬프트 본문');

    // 6) Trigger the download from the editor view → MODIFIED HTML + proposed
    //    filename, NO network.
    fetchImpl.mockClear();
    const downloadBtn = main.querySelector('.edit-action-download');
    expect(downloadBtn).toBeTruthy();
    downloadBtn.click();

    expect(buildModifiedHtml).toHaveBeenCalledTimes(1);
    // The build received the ORIGINAL raw HTML and the EDITED text.
    expect(buildModifiedHtml).toHaveBeenCalledWith(RAW_HTML, '수정된 프롬프트 본문');

    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [downloadedHtml, downloadedName] = triggerDownload.mock.calls[0];
    // The downloaded HTML is the modified document (contains the edited text).
    expect(downloadedHtml).toContain('수정된 프롬프트 본문');
    expect(downloadedHtml).not.toContain('원본 프롬프트 본문');
    expect(downloadedName).toBe('spring_modified.html');

    // R1.1 / R10.7: the download path used NO network at all.
    expect(fetchImpl).not.toHaveBeenCalled();

    app.destroy();
  });

  it('download region-identification failure shows an error and does not download (R10.6)', async () => {
    const { sidebar, main } = buildShellDom();

    const triggerDownload = vi.fn();
    const app = await initApp({
      document,
      sidebarRoot: sidebar,
      mainRoot: main,
      baseUrl: '/',
      fetchImpl: vi.fn(),
      loadManifestImpl: async () => ({ ok: true, tree: makeTree() }),
      promptLoader: {
        loadPrompt: async () => ({ ok: true, content: EXTRACTED_CONTENT, rawHtml: RAW_HTML }),
      },
      downloadService: {
        buildModifiedHtml: () => ({ ok: false, reason: 'no-open-tag' }),
        proposeFilename: (n) => n,
        triggerDownload,
      },
      sanitizer: (s) => s,
      confirm: () => true,
      editorOptions: syncTimers,
    });

    await app.showPrompt({ title: 'x', file: 'prompts/backend/spring.html', path: 'backend' });
    main.querySelector('.prompt-action-edit').click();

    const downloadBtn = main.querySelector('.edit-action-download');
    downloadBtn.click();

    const err = main.querySelector('.edit-error');
    expect(err).toBeTruthy();
    expect(err.hidden).toBe(false);
    expect(err.textContent.length).toBeGreaterThan(0);
    // R10.6: no download occurred because the region could not be identified.
    expect(triggerDownload).not.toHaveBeenCalled();

    app.destroy();
  });
});

describe('initApp — manifest-load failure path (R2.8)', () => {
  it('renders a non-blocking notice and does not throw when the manifest fails to load', async () => {
    const { sidebar, main } = buildShellDom();

    let app;
    await expect(
      (async () => {
        app = await initApp({
          document,
          sidebarRoot: sidebar,
          mainRoot: main,
          baseUrl: '/',
          fetchImpl: vi.fn(),
          loadManifestImpl: async () => ({ ok: false, error: 'Manifest 로드 실패 (HTTP 404)' }),
          promptLoader: { loadPrompt: vi.fn() },
          downloadService: {
            buildModifiedHtml: vi.fn(),
            proposeFilename: vi.fn(),
            triggerDownload: vi.fn(),
          },
          sanitizer: (s) => s,
        });
      })(),
    ).resolves.toBeUndefined();

    // A non-blocking notice is shown (app did not crash) (R2.8).
    expect(main.querySelector('.app-notice-error')).toBeTruthy();
    // The viewer is still created so the app remains usable.
    expect(app.viewer).toBeTruthy();
    // No sidebar was built (no tree), but the app is intact.
    expect(app.sidebar).toBeNull();

    app.destroy();
  });

  it('does not throw and keeps running when the loader itself rejects', async () => {
    const { sidebar, main } = buildShellDom();

    const app = await initApp({
      document,
      sidebarRoot: sidebar,
      mainRoot: main,
      baseUrl: '/',
      fetchImpl: vi.fn(),
      loadManifestImpl: async () => {
        throw new Error('network down');
      },
      promptLoader: { loadPrompt: vi.fn() },
      downloadService: {
        buildModifiedHtml: vi.fn(),
        proposeFilename: vi.fn(),
        triggerDownload: vi.fn(),
      },
      sanitizer: (s) => s,
    });

    expect(main.querySelector('.app-notice-error')).toBeTruthy();
    expect(app.viewer).toBeTruthy();
    app.destroy();
  });
});
