/**
 * Prompt loader & content extraction — Task 7.
 *
 * This module turns a Prompt_File (an HTML document fetched from `/prompts`)
 * into the human-readable Prompt_Content the PromptViewer displays. It has two
 * halves:
 *
 *   - {@link extractPromptContent} — a PURE extraction function (Task 7.1): no
 *     network, no side effects. It parses an HTML string and returns the
 *     human-readable prompt region.
 *   - {@link loadPrompt} — an ASYNC loader (Task 7.2): fetch with a 10s timeout
 *     (AbortController), extract, then sanitize via the Task 6 Sanitizer before
 *     returning. All effectful collaborators (`fetchImpl`, `sanitizeImpl`,
 *     `resolveUrl`) are injectable so the module is fully testable offline.
 *
 * Design references: design.md "Components → Services → promptLoader",
 * "Prompt HTML 구조 (권장)", "Error Handling" (prompt fetch 실패/타임아웃/미발견,
 * 추출 콘텐츠 0자), and "Correctness Properties → Property 6".
 *
 * ## Extraction return type (documented decision)
 *
 * `extractPromptContent` returns the **innerHTML string** of the extracted
 * region (the recommended `<section class="prompt-content">`, else `<body>`).
 * Returning parsed inner HTML — rather than an escaped dump of the whole file —
 * is what makes the result human-readable: the PromptViewer sanitizes this
 * string (Task 6) and renders it, so the user sees prompt text, not literal
 * `&lt;section&gt;…` tag source (_R5.3_).
 *
 * ## DOMParser usage & environment guard (documented decision)
 *
 * Extraction uses the global `DOMParser` (available in browsers and under the
 * Vitest jsdom env). Using a real parser here is acceptable — unlike the
 * downloadService, which must preserve bytes — because extraction only needs to
 * read the parsed content, not round-trip it. When no `DOMParser` is available,
 * we fall back to a minimal regex-based extraction of the recommended section
 * or the body; if even that cannot find a region we return an empty string
 * (never the raw tag source). This fallback is best-effort and documented as
 * such.
 */

import { sanitize } from './sanitizer.js';

/**
 * Resolve a usable `DOMParser` constructor for this environment, or `null`.
 *
 * @returns {typeof DOMParser | null}
 */
function getDOMParser() {
  if (typeof DOMParser !== 'undefined') {
    return DOMParser;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.DOMParser !== 'undefined') {
    return globalThis.DOMParser;
  }
  return null;
}

/**
 * Minimal regex-based fallback extraction used only when no `DOMParser` is
 * available. Best-effort: pulls the recommended `<section class="prompt-content">`
 * inner HTML if present, otherwise the `<body>` inner HTML, otherwise `''`.
 *
 * This is intentionally simple and is NOT the primary path. It never returns an
 * escaped dump of the whole document — on no match it returns an empty string.
 *
 * @param {string} htmlString
 * @returns {string}
 */
function extractWithRegexFallback(htmlString) {
  // Prefer the recommended structure: a <section ... class="...prompt-content...">.
  const sectionRe =
    /<section\b[^>]*\bclass\s*=\s*(?:"[^"]*\bprompt-content\b[^"]*"|'[^']*\bprompt-content\b[^']*')[^>]*>([\s\S]*?)<\/section>/i;
  const sectionMatch = sectionRe.exec(htmlString);
  if (sectionMatch) {
    return sectionMatch[1];
  }

  // Fall back to the <body> inner HTML.
  const bodyRe = /<body\b[^>]*>([\s\S]*?)<\/body>/i;
  const bodyMatch = bodyRe.exec(htmlString);
  if (bodyMatch) {
    return bodyMatch[1];
  }

  return '';
}

/**
 * Extract the human-readable Prompt_Content from a Prompt_File HTML string.
 *
 * Resolution order (_R5.4, 5.5_, Property 6):
 *   1. If the recommended structure contains a `<section class="prompt-content">`,
 *      return that region's inner HTML.
 *   2. Otherwise, return the document `<body>`'s inner HTML.
 *
 * The result is parsed inner HTML (human-readable content), NOT an escaped dump
 * of the raw file — so the viewer can sanitize and render it rather than show
 * literal tag source (_R5.3_).
 *
 * PURE: no network, no side effects. May use `DOMParser` (browser + jsdom);
 * guards for environments lacking it with a minimal regex fallback.
 *
 * @param {string} htmlString - Raw HTML source of a Prompt_File.
 * @returns {string} The extracted region's inner HTML (possibly empty).
 */
export function extractPromptContent(htmlString) {
  if (typeof htmlString !== 'string' || htmlString === '') {
    return '';
  }

  const Parser = getDOMParser();
  if (!Parser) {
    // No DOM available: best-effort regex extraction, never a raw dump.
    return extractWithRegexFallback(htmlString);
  }

  let doc;
  try {
    doc = new Parser().parseFromString(htmlString, 'text/html');
  } catch {
    return extractWithRegexFallback(htmlString);
  }

  if (!doc) {
    return extractWithRegexFallback(htmlString);
  }

  // 1) Recommended structure: section.prompt-content (R5.4).
  const section = doc.querySelector('section.prompt-content');
  if (section) {
    return section.innerHTML;
  }

  // 2) Fallback: document body content (R5.5).
  if (doc.body) {
    return doc.body.innerHTML;
  }

  // Degenerate parse (no body): best-effort regex, else empty.
  return extractWithRegexFallback(htmlString);
}

/**
 * Load a Prompt_File by path, extract its Prompt_Content, and sanitize it.
 *
 * Behavior:
 *   - Builds the fetch URL via `resolveUrl(baseUrl, promptPath)` so paths stay
 *     consistent with the runtime-computed Base_URL (_R5.1_).
 *   - Fetches with a 10s timeout enforced by `AbortController` (_R5.1_).
 *   - On success: extracts via {@link extractPromptContent}, then SANITIZES the
 *     extracted HTML via the Task 6 Sanitizer before returning (_R12.5_).
 *   - On fetch failure / non-OK (e.g. 404) / timeout: returns `{ ok:false,
 *     error }` and never throws, so the caller can keep the previous view
 *     unchanged (_R5.6_).
 *   - If the sanitized content is empty (length 0): returns `{ ok:true,
 *     content:'', empty:true, rawHtml }` so the viewer can show a
 *     "표시할 내용 없음" message (_R5.7_).
 *
 * ## Return shape (documented)
 *   - Success (non-empty): `{ ok:true, content, rawHtml }`
 *       - `content`  — sanitized Prompt_Content (safe HTML string)
 *       - `rawHtml`  — the original fetched HTML source (kept so the viewer's
 *                      "원본 보기" and the download service can use it)
 *   - Success (empty):     `{ ok:true, content:'', empty:true, rawHtml }`
 *   - Failure:             `{ ok:false, error }`
 *
 * @param {(baseUrl:string, relativePath:string)=>string} resolveUrl
 *        Base_URL-aware path joiner (from `utils/path.js`). Injectable.
 * @param {string} promptPath - Internal relative prompt path, e.g.
 *                              `prompts/backend/spring.html`.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=10000] - Fetch timeout in ms (_R5.1_).
 * @param {typeof fetch} [options.fetchImpl] - Fetch implementation (defaults to
 *        `globalThis.fetch`). Injectable for tests.
 * @param {string} [options.baseUrl='/'] - Base_URL passed to `resolveUrl`.
 * @param {(html:string)=>string} [options.sanitizeImpl] - Sanitizer (defaults
 *        to the Task 6 `sanitize`). Injectable for tests.
 * @returns {Promise<{ok:true, content:string, rawHtml:string, empty?:boolean} | {ok:false, error:string}>}
 */
export async function loadPrompt(resolveUrl, promptPath, options = {}) {
  const {
    timeoutMs = 10000,
    fetchImpl = typeof globalThis !== 'undefined' ? globalThis.fetch : undefined,
    baseUrl = '/',
    sanitizeImpl = sanitize,
  } = options;

  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch 사용 불가: 프롬프트를 로드할 수 없습니다.' };
  }

  const url =
    typeof resolveUrl === 'function' ? resolveUrl(baseUrl, promptPath) : String(promptPath ?? '');

  // 10s timeout via AbortController (R5.1).
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  let timer = null;
  if (controller && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  let rawHtml;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);

    if (!response || !response.ok) {
      const status = response ? response.status : '네트워크 오류';
      return { ok: false, error: `프롬프트 로드 실패 (HTTP ${status})` };
    }

    rawHtml = await response.text();
  } catch (err) {
    // R5.6: fetch failure OR timeout (abort) → {ok:false}, never throws.
    if (timedOut) {
      return { ok: false, error: `프롬프트 로드 시간 초과 (${timeoutMs}ms)` };
    }
    const message = err && err.message ? err.message : String(err);
    return { ok: false, error: `프롬프트 로드 실패: ${message}` };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  // Extract (pure) then sanitize (R12.5) before returning any content.
  const extracted = extractPromptContent(rawHtml);
  const sanitizer = typeof sanitizeImpl === 'function' ? sanitizeImpl : sanitize;
  const content = sanitizer(extracted);

  // R5.7: empty content → flag so the viewer shows "표시할 내용 없음".
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: true, content: '', empty: true, rawHtml };
  }

  return { ok: true, content, rawHtml };
}

export default loadPrompt;
