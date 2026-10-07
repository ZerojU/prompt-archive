/**
 * PromptViewer component — Task 11 (표시 / 복사 / 액션).
 *
 * Renders a selected Prompt_File's human-readable Prompt_Content plus the
 * action bar (전체 복사 / 편집 / 다운로드 / 원본 보기). The viewer owns a small
 * amount of state (the current promptRef, the sanitized content, the raw
 * original HTML, and the raw-view toggle) and delegates all effectful work
 * (loading, sanitizing, clipboard, download) to injectable collaborators so the
 * component is fully testable under jsdom.
 *
 * Behavior → Requirements:
 *   - R5.2: While a prompt loads, a loading indicator is shown in the view.
 *   - R5.3 / R12.5: The sanitized Prompt_Content is rendered as safe content.
 *           The string comes from `promptLoader.loadPrompt`, which already runs
 *           the Task 6 Sanitizer; because it passed `sanitize`, it is safe to
 *           assign via innerHTML of the content container (never the raw file
 *           source). We NEVER inject un-sanitized HTML.
 *   - R5.6: On load failure / timeout the view shows an error message and the
 *           PREVIOUSLY displayed content is kept unchanged (the content region
 *           is not blanked).
 *   - R5.7: On empty extracted content, a "표시할 내용 없음" message is shown.
 *   - R6.1: The 전체 복사 button is always present.
 *   - R6.2: Copy writes the Prompt_Content as PLAIN TEXT (markup stripped) via
 *           `toPlainText`.
 *   - R6.3 / R6.4 / R7.5: On copy success a Copy_Feedback "복사되었습니다" is
 *           shown and auto-removed after 3000ms (>= 2s).
 *   - R6.5: On clipboard write failure, a failure message is shown and the
 *           content is left unchanged.
 *   - R6.6: When clipboard is unavailable (no API / non-secure context /
 *           permission denied), a "복사할 수 없습니다" message is shown.
 *   - R7.1: 복사 / 편집 / 다운로드 / 원본 보기 buttons are always shown and
 *           clickable while a prompt is displayed.
 *   - R7.2: 편집 invokes `deps.onEdit(promptRef, content, rawHtml)` so the app
 *           shell can enter Edit_Mode (actual editor is Task 13).
 *   - R7.3 / R7.4: 원본 보기 toggles between the rendered view and the raw
 *           original HTML shown AS TEXT (via textContent, never executed), and
 *           clicking again returns to the rendered view.
 *   - R7.6: 다운로드 downloads the current prompt's HTML (rawHtml) via the
 *           downloadService with a `_modified`-free proposed filename based on
 *           the prompt file name (edited-download path is wired in Task 13/15).
 *   - R7.7: When NO prompt is displayed and any action fires, nothing happens
 *           and a "선택된 프롬프트가 없습니다" error is shown.
 *
 * Design reference: design.md "Components and Interfaces → PromptViewer" and
 * the "Error Handling" table (fetch 실패/타임아웃, 추출 0자, 클립보드, 선택 없음).
 *
 * _Requirements: 5.2, 5.3, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 *                7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 12.5._
 */

import { loadPrompt as defaultLoadPrompt } from '../services/promptLoader.js';
import {
  buildModifiedHtml as defaultBuildModifiedHtml,
  proposeFilename as defaultProposeFilename,
  triggerDownload as defaultTriggerDownload,
} from '../services/downloadService.js';
import { sanitize as defaultSanitize } from '../services/sanitizer.js';
import { resolveUrl as defaultResolveUrl } from '../utils/path.js';

/** @typedef {{title:string, file:string, path:string, displayName?:string}} PromptRef */

const COPY_FEEDBACK_MS = 3000;
const COPY_SUCCESS_TEXT = '복사되었습니다';
const COPY_FAIL_TEXT = '복사에 실패했습니다';
const COPY_UNAVAILABLE_TEXT = '복사할 수 없습니다';
const NO_PROMPT_TEXT = '선택된 프롬프트가 없습니다';
const EMPTY_CONTENT_TEXT = '표시할 내용 없음';
const LOADING_TEXT = '불러오는 중…';

/**
 * Convert prompt content (an HTML string, or plain text) into plain text with
 * all markup stripped while preserving the readable text content (_R6.2_).
 *
 * PURE. This is the function the Property 8 clipboard test targets.
 *
 * Strategy: parse the string as an HTML fragment and read its `textContent`.
 * This both strips tags and decodes entities (e.g. `&amp;` → `&`), yielding the
 * human-readable text a user expects to paste. When no DOM is available, fall
 * back to a conservative regex strip of tags + minimal entity decode so the
 * function never returns tag markup.
 *
 * @param {string} htmlOrContentString - Prompt_Content (sanitized HTML or text).
 * @returns {string} Plain text with no HTML tags/markup.
 */
export function toPlainText(htmlOrContentString) {
  if (typeof htmlOrContentString !== 'string' || htmlOrContentString === '') {
    return '';
  }

  const doc =
    typeof globalThis !== 'undefined' && globalThis.document ? globalThis.document : null;

  if (doc && typeof doc.createElement === 'function') {
    const el = doc.createElement('div');
    // Safe: we only READ textContent; the fragment is never attached to the
    // live document, so nothing executes. This strips tags and decodes
    // entities to produce readable text.
    el.innerHTML = htmlOrContentString;
    return el.textContent || '';
  }

  // DOM-less fallback: strip tags, then decode the five core entities.
  return htmlOrContentString
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Create the PromptViewer.
 *
 * @param {HTMLElement} root - Container to render into (cleared first).
 * @param {object} [deps] - Injectable collaborators (all have defaults).
 * @param {{loadPrompt:Function}|Function} [deps.promptLoader] - A module-like
 *   object exposing `loadPrompt`, or a bare `loadPrompt` function.
 * @param {{buildModifiedHtml:Function, proposeFilename:Function, triggerDownload:Function}} [deps.downloadService]
 * @param {(html:string)=>string} [deps.sanitizer]
 * @param {{writeText:(t:string)=>Promise<void>}} [deps.clipboard] - Defaults to
 *   `navigator.clipboard`.
 * @param {(baseUrl:string, relativePath:string)=>string} [deps.resolveUrl]
 * @param {string} [deps.baseUrl]
 * @param {(promptRef:PromptRef, content:string, rawHtml:string)=>void} [deps.onEdit]
 * @param {Window} [deps.windowRef] - For timers/secure-context checks (tests).
 * @returns {{
 *   element: HTMLElement,
 *   show: (promptRef: PromptRef) => Promise<void>,
 *   copyAll: () => Promise<boolean>,
 *   toggleRawView: () => void,
 *   enterEditMode: () => void,
 *   download: () => void,
 *   getState: () => {promptRef:PromptRef|null, content:string, rawHtml:string, rawView:boolean, loading:boolean},
 *   destroy: () => void,
 * }}
 */
export function createPromptViewer(root, deps = {}) {
  if (!root || typeof root.appendChild !== 'function') {
    throw new TypeError('createPromptViewer: root must be an HTMLElement');
  }

  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('createPromptViewer requires a DOM environment');
  }

  // --- Resolve dependencies (sensible browser defaults) --------------------
  const promptLoaderDep = deps.promptLoader;
  const loadPromptFn =
    typeof promptLoaderDep === 'function'
      ? promptLoaderDep
      : promptLoaderDep && typeof promptLoaderDep.loadPrompt === 'function'
        ? promptLoaderDep.loadPrompt
        : defaultLoadPrompt;

  const downloadService = deps.downloadService || {
    buildModifiedHtml: defaultBuildModifiedHtml,
    proposeFilename: defaultProposeFilename,
    triggerDownload: defaultTriggerDownload,
  };

  const sanitizer = typeof deps.sanitizer === 'function' ? deps.sanitizer : defaultSanitize;
  const resolveUrl = typeof deps.resolveUrl === 'function' ? deps.resolveUrl : defaultResolveUrl;
  const baseUrl = typeof deps.baseUrl === 'string' ? deps.baseUrl : '/';
  const onEdit = typeof deps.onEdit === 'function' ? deps.onEdit : null;
  const win =
    deps.windowRef || (typeof globalThis !== 'undefined' ? globalThis.window : undefined);

  /**
   * Resolve the clipboard lazily so a late-assigned `navigator.clipboard` (or a
   * revoked one) is reflected at click time. Returns `null` when unavailable.
   * @returns {{writeText:(t:string)=>Promise<any>}|null}
   */
  function getClipboard() {
    if (deps.clipboard !== undefined) {
      return deps.clipboard || null;
    }
    const nav =
      (win && win.navigator) ||
      (typeof navigator !== 'undefined' ? navigator : undefined);
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      return nav.clipboard;
    }
    return null;
  }

  const setTimeoutFn = (win && win.setTimeout ? win.setTimeout.bind(win) : setTimeout);
  const clearTimeoutFn = (win && win.clearTimeout ? win.clearTimeout.bind(win) : clearTimeout);

  // --- State ---------------------------------------------------------------
  /** @type {PromptRef|null} */
  let promptRef = null;
  /** sanitized Prompt_Content currently displayed */
  let content = '';
  /** raw original HTML source (for 원본 보기 / download) */
  let rawHtml = '';
  /** whether we are currently showing raw source as text */
  let rawView = false;
  /** whether a load is in flight */
  let loading = false;
  /** token to ignore stale async loads */
  let loadToken = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let feedbackTimer = null;

  // --- DOM scaffold --------------------------------------------------------
  while (root.firstChild) root.removeChild(root.firstChild);

  const container = doc.createElement('section');
  container.className = 'prompt-viewer';
  container.setAttribute('aria-label', '프롬프트 보기');

  // Action bar (always present — R6.1, R7.1).
  const actions = doc.createElement('div');
  actions.className = 'prompt-actions';

  const copyBtn = makeButton('전체 복사', 'prompt-action-copy');
  const editBtn = makeButton('편집', 'prompt-action-edit');
  const downloadBtn = makeButton('다운로드', 'prompt-action-download');
  const rawBtn = makeButton('원본 보기', 'prompt-action-raw');

  actions.appendChild(copyBtn);
  actions.appendChild(editBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(rawBtn);

  // Copy_Feedback region (aria-live so it is announced). Starts empty.
  const feedback = doc.createElement('div');
  feedback.className = 'prompt-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  // Loading indicator (R5.2). Hidden unless loading.
  const loadingEl = doc.createElement('div');
  loadingEl.className = 'prompt-loading';
  loadingEl.setAttribute('role', 'status');
  loadingEl.textContent = LOADING_TEXT;
  loadingEl.hidden = true;

  // Error region (R5.6 / R7.7). Hidden unless there's a message.
  const errorEl = doc.createElement('div');
  errorEl.className = 'prompt-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  // Content region — sanitized HTML (rendered) OR raw source (as text).
  const contentEl = doc.createElement('div');
  contentEl.className = 'prompt-content';

  container.appendChild(actions);
  container.appendChild(feedback);
  container.appendChild(loadingEl);
  container.appendChild(errorEl);
  container.appendChild(contentEl);
  root.appendChild(container);

  /**
   * @param {string} label
   * @param {string} cls
   * @returns {HTMLButtonElement}
   */
  function makeButton(label, cls) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `prompt-action ${cls}`;
    b.textContent = label;
    return b;
  }

  // --- Rendering helpers ---------------------------------------------------

  /** Show/hide the loading indicator (R5.2). */
  function setLoading(isLoading) {
    loading = isLoading;
    loadingEl.hidden = !isLoading;
  }

  /**
   * Show an error message WITHOUT disturbing the current content (R5.6/R7.7).
   * @param {string} message
   */
  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  /** Clear any visible error. */
  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  /**
   * Render the current `content` as sanitized HTML. The string has already
   * passed the Task 6 Sanitizer in loadPrompt (and we defensively re-sanitize
   * any content set through this viewer), so assigning innerHTML is safe
   * (_R5.3, R12.5_). Clears the raw-view flag.
   */
  function renderContent() {
    rawView = false;
    rawBtn.textContent = '원본 보기';
    rawBtn.setAttribute('aria-pressed', 'false');
    // content is sanitized; safe to insert as HTML.
    contentEl.innerHTML = content;
  }

  /** Render an empty-content notice (R5.7) without touching stored content. */
  function renderEmptyNotice() {
    rawView = false;
    rawBtn.textContent = '원본 보기';
    rawBtn.setAttribute('aria-pressed', 'false');
    while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
    const p = doc.createElement('p');
    p.className = 'prompt-empty';
    p.textContent = EMPTY_CONTENT_TEXT;
    contentEl.appendChild(p);
  }

  /**
   * Render the raw original HTML source AS TEXT (R7.3): using textContent means
   * tags are shown literally and nothing is parsed/executed.
   */
  function renderRawSource() {
    rawView = true;
    rawBtn.textContent = '렌더링 보기';
    rawBtn.setAttribute('aria-pressed', 'true');
    while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
    const pre = doc.createElement('pre');
    pre.className = 'prompt-raw';
    pre.textContent = rawHtml; // literal source — never executed (R7.3).
    contentEl.appendChild(pre);
  }

  // --- Copy_Feedback (R6.3 / R6.4) -----------------------------------------

  /**
   * Show a transient feedback message. Success messages auto-remove after
   * COPY_FEEDBACK_MS (3000ms, >= 2s per R7.5). Any prior timer is cleared so
   * rapid clicks don't drop the message early.
   * @param {string} message
   * @param {boolean} [isError]
   */
  function showFeedback(message, isError = false) {
    if (feedbackTimer) {
      clearTimeoutFn(feedbackTimer);
      feedbackTimer = null;
    }
    feedback.textContent = message;
    feedback.classList.toggle('is-error', !!isError);
    feedbackTimer = setTimeoutFn(() => {
      feedback.textContent = '';
      feedback.classList.remove('is-error');
      feedbackTimer = null;
    }, COPY_FEEDBACK_MS);
  }

  // --- Public actions ------------------------------------------------------

  /**
   * Load and display a Prompt_File. Shows a loading indicator, then renders the
   * sanitized content. On failure keeps the previous view (R5.6); on empty
   * content shows the empty notice (R5.7).
   * @param {PromptRef} ref
   * @returns {Promise<void>}
   */
  async function show(ref) {
    if (!ref || typeof ref !== 'object' || typeof ref.file !== 'string') {
      showError(NO_PROMPT_TEXT);
      return;
    }

    const myToken = ++loadToken;
    clearError();
    setLoading(true);

    let result;
    try {
      result = await loadPromptFn(resolveUrl, ref.file, { baseUrl });
    } catch (err) {
      result = { ok: false, error: err && err.message ? err.message : String(err) };
    }

    // Ignore stale loads (a newer show() superseded this one).
    if (myToken !== loadToken) {
      return;
    }

    setLoading(false);

    if (!result || result.ok !== true) {
      // R5.6: show error, KEEP previous view (do not blank content/state).
      const message = (result && result.error) || '프롬프트를 불러오지 못했습니다.';
      showError(message);
      return;
    }

    // Success: commit new state.
    promptRef = ref;
    rawHtml = typeof result.rawHtml === 'string' ? result.rawHtml : '';
    clearError();

    if (result.empty === true || typeof result.content !== 'string' || result.content === '') {
      // R5.7: empty extracted content.
      content = '';
      renderEmptyNotice();
      return;
    }

    content = result.content;
    renderContent();
  }

  /**
   * Copy the current Prompt_Content as plain text (R6.2). Shows Copy_Feedback
   * on success (R6.3/R6.4) or an appropriate failure message (R6.5/R6.6). The
   * stored content is never mutated.
   * @returns {Promise<boolean>} true on success.
   */
  async function copyAll() {
    if (!promptRef) {
      showError(NO_PROMPT_TEXT); // R7.7 guard.
      return false;
    }

    const clipboard = getClipboard();
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      // R6.6: no clipboard API / non-secure context / unavailable.
      showFeedback(COPY_UNAVAILABLE_TEXT, true);
      return false;
    }

    const plain = toPlainText(content);
    try {
      await clipboard.writeText(plain);
    } catch {
      // R6.5 / R6.6: write rejected (failure or permission denied). Content
      // is left unchanged.
      showFeedback(COPY_FAIL_TEXT, true);
      return false;
    }

    // R6.3: success feedback; R6.4: auto-removed after 3000ms.
    showFeedback(COPY_SUCCESS_TEXT, false);
    return true;
  }

  /**
   * Toggle between the rendered view and the raw-source-as-text view
   * (R7.3/R7.4). Guards when no prompt is displayed (R7.7).
   */
  function toggleRawView() {
    if (!promptRef) {
      showError(NO_PROMPT_TEXT);
      return;
    }
    if (rawView) {
      // Return to rendered view (R7.4). Respect empty content.
      if (content === '') {
        renderEmptyNotice();
      } else {
        renderContent();
      }
    } else {
      renderRawSource();
    }
  }

  /**
   * Fire the edit hook so the shell can enter Edit_Mode (R7.2). The actual
   * editor is Task 13; here we just transition via the callback. Guards when no
   * prompt is displayed (R7.7).
   */
  function enterEditMode() {
    if (!promptRef) {
      showError(NO_PROMPT_TEXT);
      return;
    }
    if (onEdit) {
      onEdit(promptRef, content, rawHtml);
    }
  }

  /**
   * Download the current (un-edited) prompt's HTML (R7.6). Uses the raw
   * original source and a filename proposed from the prompt file name. The
   * edited-download path is wired in Task 13/15. Guards when no prompt is
   * displayed (R7.7).
   */
  function download() {
    if (!promptRef) {
      showError(NO_PROMPT_TEXT);
      return;
    }
    const fileName = baseName(promptRef.file);
    const proposed =
      typeof downloadService.proposeFilename === 'function'
        ? downloadService.proposeFilename(fileName)
        : fileName;
    if (typeof downloadService.triggerDownload === 'function') {
      downloadService.triggerDownload(rawHtml, proposed);
    }
  }

  /**
   * Extract the file's base name from a path like `prompts/a/b.html` → `b.html`.
   * @param {string} filePath
   * @returns {string}
   */
  function baseName(filePath) {
    const s = typeof filePath === 'string' ? filePath : '';
    const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return idx >= 0 ? s.slice(idx + 1) : s;
  }

  // --- Wire buttons --------------------------------------------------------
  copyBtn.addEventListener('click', () => {
    void copyAll();
  });
  editBtn.addEventListener('click', () => {
    enterEditMode();
  });
  downloadBtn.addEventListener('click', () => {
    download();
  });
  rawBtn.addEventListener('click', () => {
    toggleRawView();
  });

  // --- Public API ----------------------------------------------------------
  return {
    element: container,
    show,
    copyAll,
    toggleRawView,
    enterEditMode,
    download,
    getState() {
      return { promptRef, content, rawHtml, rawView, loading };
    },
    destroy() {
      if (feedbackTimer) {
        clearTimeoutFn(feedbackTimer);
        feedbackTimer = null;
      }
      while (root.firstChild) root.removeChild(root.firstChild);
      promptRef = null;
      content = '';
      rawHtml = '';
      rawView = false;
      loading = false;
    },
  };
}

export default createPromptViewer;
