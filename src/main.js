// Application shell wiring — Task 15.1 (애플리케이션 셸 와이어링).
//
// This module is the Archive_App's runtime entry point. It implements the
// "애플리케이션 셸 (src/main.js)" of design.md and the "런타임 데이터 흐름"
// sequence: compute Base_URL → load the manifest + category config → build the
// Display_Name-injected CategoryTree → render the Sidebar → wire prompt
// selection to the PromptViewer → wire the viewer's 편집 to Edit_Mode (a
// 1:1 2-pane PromptEditor with a toolbar toggle to a full-screen DiffView
// preview) and the download affordance to the downloadService. Everything
// runs client-side; no data is ever sent to a
// server (_R1.1, R10.7_).
//
// Requirements wired here: 1.1 (static, client-only), 2.2 (read manifest to
// build the tree), 2.8 (manifest-load failure keeps the app running + a
// non-blocking notice), 7.2 (편집 → Edit_Mode), 7.6 (수정본 HTML 다운로드).
//
// ---------------------------------------------------------------------------
// Browser-safety / testability contract (documented):
//
//   - Importing this module MUST NOT touch the DOM or the network. All the
//     bootstrap work lives inside `initApp(options)`. Only `initApp` reads
//     `import.meta.env.BASE_URL` (so the pure utils stay env-free and their
//     unit tests remain pure).
//   - `initApp(options)` accepts injectable collaborators (a document/root
//     resolver, a `loadManifestImpl`, a `promptLoader`, a `downloadService`, a
//     clipboard, a `computeDiffImpl`, timers, a `confirm` fn, …) so the Task
//     15.2 integration test can drive the whole flow with stubs and WITHOUT
//     real network access.
//   - When loaded in a real page, `initApp()` is invoked automatically with
//     browser defaults — on `DOMContentLoaded`, or immediately if the document
//     is already parsed.
// ---------------------------------------------------------------------------

// Task 16.1: import the global stylesheet so Vite processes and bundles it
// (emitting a CSS asset in dist). KEEP THIS — the shell relies on these styles.
import './styles/app.css';

import { computeBaseUrl, resolveUrl as defaultResolveUrl } from './utils/path.js';
import { loadManifest as defaultLoadManifest } from './services/manifestLoader.js';
import { createSidebar } from './components/Sidebar.js';
import { createPromptViewer } from './components/PromptViewer.js';
import { createPromptEditor } from './components/PromptEditor.js';
import { createDiffView } from './components/DiffViewer.js';
import { computeDiff as defaultComputeDiff } from './utils/diff.js';
import * as defaultPromptLoader from './services/promptLoader.js';
import * as defaultDownloadService from './services/downloadService.js';

/** @typedef {{title:string, file:string, path:string, displayName?:string}} PromptRef */

const SIDEBAR_ID = 'sidebar';
const MAIN_ID = 'main';

const MANIFEST_FAIL_TEXT = 'Manifest를 불러오지 못해 메뉴를 표시할 수 없습니다.';
const BOOTSTRAP_FAIL_TEXT = '애플리케이션을 초기화하는 중 오류가 발생했습니다.';
const DOWNLOAD_REGION_FAIL_TEXT =
  '프롬프트 콘텐츠 영역을 찾을 수 없어 다운로드할 수 없습니다.';

/**
 * Render a non-blocking notice inside a container WITHOUT throwing. Used for
 * manifest-load failure (_R2.8_), category-config fallback notices, and the
 * bootstrap guard. The notice is additive: it never clears whatever else is in
 * the container, so the app keeps running around it.
 *
 * @param {Document} doc
 * @param {HTMLElement} container
 * @param {string} message
 * @param {string} [variant] - 'error' | 'warning' (CSS class suffix).
 * @returns {HTMLElement|null} the created notice element.
 */
function renderNotice(doc, container, message, variant = 'error') {
  if (!container || typeof container.appendChild !== 'function') {
    return null;
  }
  const notice = doc.createElement('div');
  notice.className = `app-notice app-notice-${variant}`;
  notice.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  notice.textContent = message;
  container.appendChild(notice);
  return notice;
}

/**
 * Initialize the Archive_App.
 *
 * @param {object} [options]
 * @param {Document} [options.document] - Document to render into (defaults to
 *   the global `document`).
 * @param {HTMLElement} [options.sidebarRoot] - Explicit sidebar container
 *   (defaults to `#sidebar`).
 * @param {HTMLElement} [options.mainRoot] - Explicit main container (defaults
 *   to `#main`).
 * @param {string} [options.baseUrl] - Precomputed Base_URL. Defaults to
 *   `computeBaseUrl(import.meta.env.BASE_URL)`.
 * @param {(baseUrl:string, relativePath:string)=>string} [options.resolveUrl]
 *   Base_URL-aware path joiner (defaults to utils/path.resolveUrl).
 * @param {typeof fetch} [options.fetchImpl] - Injectable fetch (passed through
 *   to the loaders). Defaults to `globalThis.fetch`.
 * @param {(resolveUrl:Function, opts:object)=>Promise<object>} [options.loadManifestImpl]
 *   Manifest loader (defaults to services/manifestLoader.loadManifest).
 * @param {{loadPrompt:Function}} [options.promptLoader] - Prompt loader module
 *   (defaults to services/promptLoader).
 * @param {{buildModifiedHtml:Function, proposeFilename:Function, triggerDownload:Function}} [options.downloadService]
 *   Download service module (defaults to services/downloadService).
 * @param {(html:string)=>string} [options.sanitizer] - Sanitizer (passed to the
 *   viewer).
 * @param {{writeText:(t:string)=>Promise<void>}} [options.clipboard] - Clipboard
 *   (defaults to `navigator.clipboard`).
 * @param {(original:string, modified:string)=>object[]} [options.computeDiffImpl]
 *   Diff function for the DiffView (defaults to utils/diff.computeDiff).
 * @param {(message?:string)=>boolean} [options.confirm] - Confirm dialog for the
 *   dirty-exit guard (defaults to `window.confirm`).
 * @param {object} [options.editorOptions] - Passed through to createPromptEditor
 *   (e.g. `{ debounceMs, setTimeoutFn, clearTimeoutFn }` for deterministic tests).
 * @returns {Promise<{
 *   baseUrl: string,
 *   sidebar: object|null,
 *   viewer: object,
 *   showPrompt: (ref: PromptRef) => Promise<void>,
 *   enterEditMode: (ref: PromptRef, content: string, rawHtml: string) => void,
 *   exitEditMode: () => Promise<boolean>,
 *   getState: () => {mode:string},
 *   destroy: () => void,
 * }>}
 */
export async function initApp(options = {}) {
  const doc =
    options.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('initApp requires a DOM environment (document).');
  }

  // --- Resolve collaborators (browser defaults) ----------------------------
  const sidebarRoot = options.sidebarRoot || doc.getElementById(SIDEBAR_ID);
  const mainRoot = options.mainRoot || doc.getElementById(MAIN_ID);
  if (!mainRoot) {
    throw new Error(`initApp: #${MAIN_ID} container not found`);
  }

  const baseUrl =
    typeof options.baseUrl === 'string'
      ? options.baseUrl
      : computeBaseUrl(readViteBaseUrl());
  const resolveUrl =
    typeof options.resolveUrl === 'function' ? options.resolveUrl : defaultResolveUrl;
  const fetchImpl =
    options.fetchImpl ||
    (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  const loadManifestImpl =
    typeof options.loadManifestImpl === 'function'
      ? options.loadManifestImpl
      : defaultLoadManifest;
  const promptLoader = options.promptLoader || defaultPromptLoader;
  const downloadService = options.downloadService || defaultDownloadService;
  const sanitizer = options.sanitizer;
  const clipboard = options.clipboard;
  const computeDiffImpl =
    typeof options.computeDiffImpl === 'function'
      ? options.computeDiffImpl
      : defaultComputeDiff;
  const confirmFn =
    typeof options.confirm === 'function'
      ? options.confirm
      : (msg) =>
          typeof globalThis !== 'undefined' &&
          globalThis.window &&
          typeof globalThis.window.confirm === 'function'
            ? globalThis.window.confirm(msg)
            : true;
  const editorOptions = options.editorOptions || {};

  // --- Shell state ---------------------------------------------------------
  /** @type {'viewer'|'edit'} */
  let mode = 'viewer';
  /** @type {ReturnType<typeof createPromptEditor>|null} */
  let editor = null;
  /** @type {ReturnType<typeof createDiffView>|null} */
  let diffView = null;
  /** The viewer DOM is detached while in Edit_Mode and restored on exit. */
  let viewerDetached = false;

  // Wrap bootstrap so a thrown error shows a visible notice instead of a silent
  // crash (per the task's "guard the whole bootstrap" requirement).
  try {
    // --- 1) Load manifest + category config (_R2.2_) -----------------------
    let manifestResult;
    try {
      manifestResult = await loadManifestImpl(resolveUrl, { baseUrl, fetchImpl });
    } catch (err) {
      manifestResult = {
        ok: false,
        error: err && err.message ? err.message : String(err),
      };
    }

    // --- 2) PromptViewer (always created so the app is usable) -------------
    const viewer = createPromptViewer(mainRoot, {
      promptLoader,
      downloadService,
      sanitizer,
      clipboard,
      resolveUrl,
      baseUrl,
      // 편집 버튼 → Edit_Mode (_R7.2_).
      onEdit: (ref, content, rawHtml) => enterEditMode(ref, content, rawHtml),
    });

    /**
     * Show a prompt in the viewer. Also returns the viewer to view-mode if it
     * was in Edit_Mode (selecting another prompt leaves the editor).
     * @param {PromptRef} ref
     */
    async function showPrompt(ref) {
      if (mode === 'edit') {
        // Leaving Edit_Mode by selecting a new prompt — honor the dirty guard.
        const ok = await exitEditMode();
        if (!ok) return;
      }
      await viewer.show(ref);
    }

    // --- 3) Sidebar (only when the manifest tree is available, _R2.8_) -----
    /** @type {ReturnType<typeof createSidebar>|null} */
    let sidebar = null;
    if (manifestResult && manifestResult.ok === true && manifestResult.tree) {
      if (sidebarRoot) {
        sidebar = createSidebar(sidebarRoot, manifestResult.tree, (ref) => {
          void showPrompt(ref);
        });
      }
      // A missing/malformed category.json is non-fatal: surface a small notice
      // but still render the (English-fallback) tree the loader produced.
      if (manifestResult.configError && sidebarRoot) {
        renderNotice(doc, sidebarRoot, manifestResult.configError, 'warning');
      }
    } else {
      // _R2.8_: manifest load failed. Keep the app running (the viewer still
      // works for any directly-shown prompt) and show a NON-BLOCKING notice.
      const message =
        (manifestResult && manifestResult.error) || MANIFEST_FAIL_TEXT;
      if (sidebarRoot) {
        renderNotice(doc, sidebarRoot, MANIFEST_FAIL_TEXT, 'error');
      }
      renderNotice(doc, mainRoot, message, 'error');
    }

    // --- Edit_Mode wiring --------------------------------------------------

    /**
     * Enter Edit_Mode (_R7.2_): detach the viewer DOM and render the 1:1
     * two-pane PromptEditor (left = original read-only, right = editable seed).
     * The diff is NOT shown alongside the editor anymore — a toolbar toggle
     * ("변경 결과 미리보기") swaps the whole editor area for a full-screen diff
     * preview and back ("편집으로 돌아가기"), preserving the edited content.
     *
     * The editor stays MOUNTED (merely hidden) while previewing so its value is
     * never lost; on entering preview the DiffView is refreshed with the latest
     * `editor.getValue()`. A 다운로드 affordance builds the modified HTML from the
     * ORIGINAL rawHtml using the current editor value and triggers a
     * client-side download (_R7.6, R10.x_); a 뷰어로 affordance exits via the
     * editor's dirty guard (_R8.8_).
     *
     * DOM: `.edit-mode > .edit-toolbar(.edit-action-close + .edit-action-download
     *       + .edit-action-preview) + .edit-error +
     *       .edit-body(.edit-editor-host + .edit-preview-host[hidden])`.
     *
     * @param {PromptRef} ref
     * @param {string} content - Extracted (sanitized) Prompt_Content TEXT seed.
     * @param {string} rawHtml - Original Prompt_File HTML (download source).
     */
    function enterEditMode(ref, content, rawHtml) {
      if (mode === 'edit') return;
      mode = 'edit';

      // Detach the viewer element so Edit_Mode owns the main area, but DO NOT
      // destroy the viewer — we restore it on exit.
      if (viewer.element && viewer.element.parentNode === mainRoot) {
        mainRoot.removeChild(viewer.element);
        viewerDetached = true;
      }

      const editRoot = doc.createElement('section');
      editRoot.className = 'edit-mode';
      editRoot.setAttribute('aria-label', '편집 모드');

      // Edit_Mode toolbar: 미리보기 토글 + 다운로드 + 닫기(뷰어로).
      const toolbar = doc.createElement('div');
      toolbar.className = 'edit-toolbar';

      // Preview toggle — analogous to the viewer's 원본/렌더링 toggle. It swaps
      // the editor for a full-screen diff preview and back.
      const previewBtn = doc.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'edit-action edit-action-preview';
      previewBtn.textContent = '변경 결과 미리보기';
      previewBtn.setAttribute('aria-pressed', 'false');

      const downloadBtn = doc.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'edit-action edit-action-download';
      downloadBtn.textContent = '다운로드';

      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'edit-action edit-action-close';
      closeBtn.textContent = '뷰어로';

      // Edit_Mode error region (download-region failure, etc.).
      const editError = doc.createElement('div');
      editError.className = 'edit-error';
      editError.setAttribute('role', 'alert');
      editError.hidden = true;

      // On-screen order: 뷰어로 (close) → 다운로드 (download) → 변경 결과 미리보기
      // (preview). Button identities/behavior are unchanged; only the append
      // order differs.
      toolbar.appendChild(closeBtn);
      toolbar.appendChild(downloadBtn);
      toolbar.appendChild(previewBtn);

      // Body: a single area that shows EITHER the editor OR the diff preview.
      // Both hosts are mounted; only one is visible at a time (via `hidden`),
      // so the editor keeps its value while the preview is on screen.
      const body = doc.createElement('div');
      body.className = 'edit-body';

      const editorHost = doc.createElement('div');
      editorHost.className = 'edit-editor-host';
      const previewHost = doc.createElement('div');
      previewHost.className = 'edit-preview-host';
      previewHost.hidden = true; // editor view is the default.

      body.appendChild(editorHost);
      body.appendChild(previewHost);

      editRoot.appendChild(toolbar);
      editRoot.appendChild(editError);
      editRoot.appendChild(body);
      mainRoot.appendChild(editRoot);

      const originalContent = typeof content === 'string' ? content : '';

      // Diff view lives in its own host, only shown on demand. The editor's
      // debounced change does NOT need to touch it (diff is lazy, refreshed
      // when entering preview), so onChange is a harmless no-op here.
      diffView = createDiffView(previewHost, { computeDiffImpl });

      // 1:1 two-pane editor seeded with the original (its own CSS does the 1:1
      // split at >= 768px). Kept mounted even while previewing.
      editor = createPromptEditor(editorHost, originalContent, () => {}, editorOptions);

      /** Whether the full-screen diff preview is currently shown. */
      let previewing = false;

      /** @param {string} message */
      function showEditError(message) {
        editError.textContent = message;
        editError.hidden = false;
      }
      function clearEditError() {
        editError.textContent = '';
        editError.hidden = true;
      }

      // 변경 결과 미리보기 ↔ 편집으로 돌아가기 toggle. Entering preview refreshes the
      // diff with the LATEST editor value (original vs. current edit) and hides
      // the editor (its value is preserved). Returning just unhides the editor.
      function enterPreview() {
        if (diffView && editor) {
          diffView.update(editor.getOriginal(), editor.getValue());
        }
        editorHost.hidden = true;
        previewHost.hidden = false;
        previewing = true;
        previewBtn.textContent = '편집으로 돌아가기';
        previewBtn.setAttribute('aria-pressed', 'true');
      }
      function exitPreview() {
        previewHost.hidden = true;
        editorHost.hidden = false;
        previewing = false;
        previewBtn.textContent = '변경 결과 미리보기';
        previewBtn.setAttribute('aria-pressed', 'false');
      }
      previewBtn.addEventListener('click', () => {
        if (previewing) exitPreview();
        else enterPreview();
      });

      // 다운로드 (_R7.6_): build modified HTML from the ORIGINAL rawHtml using
      // the current editor value, then trigger a client-side download. On a
      // region-identification failure, show an error and do nothing else
      // (_R10.6_). Works regardless of which view is on screen.
      downloadBtn.addEventListener('click', () => {
        clearEditError();
        const editedText = editor ? editor.getValue() : originalContent;
        const built =
          typeof downloadService.buildModifiedHtml === 'function'
            ? downloadService.buildModifiedHtml(rawHtml, editedText)
            : { ok: false, reason: 'no-builder' };
        if (!built || built.ok !== true) {
          showEditError(DOWNLOAD_REGION_FAIL_TEXT);
          return;
        }
        const srcName = baseName(ref && ref.file);
        const filename =
          typeof downloadService.proposeFilename === 'function'
            ? downloadService.proposeFilename(srcName)
            : srcName;
        if (typeof downloadService.triggerDownload === 'function') {
          downloadService.triggerDownload(built.html, filename);
        }
      });

      // 닫기(뷰어로) (_R8.8_): exit via the editor's dirty guard; window.confirm
      // when dirty.
      closeBtn.addEventListener('click', () => {
        void exitEditMode();
      });
    }

    /**
     * Exit Edit_Mode back to the viewer, honoring the dirty-exit confirmation
     * (_R8.8_). Returns true when the exit happened, false when the user
     * declined the confirmation (the editor content is then kept).
     * @returns {Promise<boolean>}
     */
    async function exitEditMode() {
      if (mode !== 'edit') return true;
      if (editor) {
        const ok = await editor.confirmExitIfDirty(() =>
          confirmFn('저장되지 않은 변경이 있습니다. 편집을 종료할까요?'),
        );
        if (!ok) return false; // keep the editor content (_R8.8_).
      }

      // Tear down editor + diff view and remove the Edit_Mode DOM.
      if (editor) {
        editor.destroy();
        editor = null;
      }
      if (diffView) {
        diffView.destroy();
        diffView = null;
      }
      const editRoot = mainRoot.querySelector('.edit-mode');
      if (editRoot && editRoot.parentNode === mainRoot) {
        mainRoot.removeChild(editRoot);
      }

      // Reattach the viewer DOM.
      if (viewerDetached && viewer.element) {
        mainRoot.appendChild(viewer.element);
        viewerDetached = false;
      }
      mode = 'viewer';
      return true;
    }

    // --- Public shell handle ----------------------------------------------
    return {
      baseUrl,
      sidebar,
      viewer,
      showPrompt,
      enterEditMode,
      exitEditMode,
      getState() {
        return { mode };
      },
      destroy() {
        if (editor) {
          editor.destroy();
          editor = null;
        }
        if (diffView) {
          diffView.destroy();
          diffView = null;
        }
        if (sidebar) sidebar.destroy();
        viewer.destroy();
      },
    };
  } catch (err) {
    // Bootstrap guard: never crash silently — show a visible notice.
    const message =
      err && err.message ? `${BOOTSTRAP_FAIL_TEXT} (${err.message})` : BOOTSTRAP_FAIL_TEXT;
    renderNotice(doc, mainRoot, message, 'error');
    throw err;
  }
}

/**
 * Read `import.meta.env.BASE_URL` defensively. Reading it ONLY here keeps the
 * pure utils (and their tests) free of any Vite/env coupling. Falls back to the
 * relative base when the env is unavailable (e.g. non-Vite contexts/tests that
 * don't inject a baseUrl).
 * @returns {string}
 */
function readViteBaseUrl() {
  try {
    // `import.meta.env` is injected by Vite at build/dev time.
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) {
      return import.meta.env.BASE_URL;
    }
  } catch {
    // Ignore — fall through to the relative default.
  }
  return './';
}

/**
 * Return the last path segment of a '/'- or '\\'-separated path.
 * @param {string|undefined|null} filePath
 * @returns {string}
 */
function baseName(filePath) {
  const s = typeof filePath === 'string' ? filePath : '';
  const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return idx >= 0 ? s.slice(idx + 1) : s;
}

/**
 * Auto-bootstrap in a real browser/page context ONLY. We detect a real page by
 * the presence of a global `document`. The import itself never bootstraps — the
 * work is deferred to `DOMContentLoaded` (or runs immediately if the document is
 * already parsed), so importing this module in a non-DOM/test context is inert
 * and the integration test can drive `initApp` with its own stubs.
 */
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const boot = () => {
    // Only bootstrap when the real page shell is present. This keeps a bare
    // module import (e.g. the integration test importing `initApp`) inert: the
    // test provides its own DOM + stubs and calls `initApp` explicitly.
    if (!document.getElementById(MAIN_ID)) return;
    // Swallow the rejection here; initApp already rendered a visible notice.
    void initApp().catch(() => {});
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

export default initApp;
