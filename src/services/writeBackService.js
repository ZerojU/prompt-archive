/**
 * Write-back extension point — Phase 5 scaffolding ONLY (STRUCTURE, no behavior).
 *
 * This module exists so a FUTURE "GitHub에 저장" (write-back) capability can be
 * plugged in without touching any caller. It defines the shape of a write-back
 * provider and ships a safe, no-op DEFAULT provider that represents the CURRENT
 * (Phase 1-3) behavior: the user downloads the modified HTML and manually
 * commits it (_Requirements: 15.1_).
 *
 * IMPORTANT — this is a structural seam (hook), NOT an implementation
 * (_Requirements: 15.2_):
 *   - There is NO GitHub OAuth flow here.
 *   - There is NO token/credential handling here.
 *   - There are NO network calls here.
 * A later phase will register a real provider via {@link setWriteBackProvider}.
 * When that happens, every piece of authentication (OAuth tokens, Personal
 * Access Tokens, installation tokens, etc.) MUST be supplied by the user at
 * RUNTIME (e.g. an interactive OAuth consent or a user-pasted token held only
 * in memory). Tokens and secrets MUST NEVER be hardcoded in source, read from
 * bundled source files, or committed to the repository (_Requirements: 15.3_).
 * This file intentionally contains no credential strings of any kind.
 *
 * @module services/writeBackService
 */

/**
 * Options accepted by a write-back operation. Phase 5 may extend this shape;
 * documented here so the seam is stable for future providers.
 *
 * NOTE: no field here is a token or secret. Authentication is handled by the
 * provider at runtime from user-supplied auth, never passed in from source
 * (_Requirements: 15.3_).
 *
 * @typedef {Object} WriteBackOptions
 * @property {string} [message]  Optional commit message a future provider would
 *   use when writing the file back to the repository.
 * @property {string} [branch]   Optional target branch for a future write.
 * @property {string} [sha]      Optional expected blob/commit SHA for optimistic
 *   concurrency on a future write.
 */

/**
 * Result of a write-back attempt. The `mode` discriminates how the "save"
 * resolved so callers can branch without knowing which provider is active.
 *
 *   - `ok: false, mode: 'manual-download'` → the default seam: no remote write
 *     happened; the user is expected to download and commit manually
 *     (_Requirements: 15.1_).
 *   - A future OAuth/token provider would return `ok: true, mode: 'github'`
 *     (plus provider-specific fields) once a real write succeeds.
 *
 * @typedef {Object} WriteBackResult
 * @property {boolean} ok       Whether a remote write actually succeeded.
 * @property {string}  mode     Discriminator, e.g. `'manual-download'` | `'github'`.
 * @property {string}  [message] Human-readable explanation for the UI.
 */

/**
 * The write-back provider interface (Phase 5 contract, documentation only).
 *
 * A future provider implements {@link WriteBackProvider#saveToGitHub}. The
 * default provider in this module satisfies the interface with a no-op that
 * reports the manual-download workflow instead of contacting GitHub.
 *
 * @typedef {Object} WriteBackProvider
 * @property {SaveToGitHub} saveToGitHub  Persist the edited content. See the
 *   {@link SaveToGitHub} callback for the contract.
 */

/**
 * Save edited prompt content back to GitHub.
 *
 * This is the single extension point a Phase 5 provider implements. It MUST be
 * asynchronous (returns a Promise) because a real implementation would perform
 * an authenticated network request. The default implementation does NOT touch
 * the network and resolves immediately with a `manual-download` result.
 *
 * A future implementation MUST obtain its credentials from user-supplied,
 * runtime auth (interactive OAuth or a user-provided token kept in memory) and
 * MUST NOT read any hardcoded token from source (_Requirements: 15.3_).
 *
 * @callback SaveToGitHub
 * @param {string} path                 Repository-relative path of the file to write.
 * @param {string} content              The full HTML content to persist.
 * @param {WriteBackOptions} [options]  Optional write options (commit message, branch, …).
 * @returns {Promise<WriteBackResult>}  Resolves with the outcome of the attempt.
 */

/**
 * The message shown for the current manual-download workflow (_Requirements: 15.1_).
 * @type {string}
 */
const MANUAL_DOWNLOAD_MESSAGE =
  '현재 버전은 다운로드 후 수동 커밋 방식입니다.';

/**
 * The DEFAULT write-back provider representing Phase 1-3 behavior.
 *
 * Its {@link SaveToGitHub} is a deliberate no-op: it performs NO GitHub request
 * and NO authentication, and simply resolves to a result indicating that the
 * manual download-then-commit workflow is in effect (_Requirements: 15.1_).
 * This provider is the structural seam a future OAuth/token provider replaces
 * (_Requirements: 15.2_).
 *
 * @type {WriteBackProvider}
 */
export const downloadWriteBackProvider = Object.freeze({
  /**
   * No-op save: does NOT contact GitHub and does NOT throw. Always resolves to
   * the manual-download result (_Requirements: 15.1_).
   *
   * @type {SaveToGitHub}
   */
  async saveToGitHub(path, content, options) {
    // Intentionally no network, no auth, no token. Phase 5 will swap in a real
    // provider via setWriteBackProvider; see module docs (_Requirements: 15.2, 15.3_).
    void path;
    void content;
    void options;
    return {
      ok: false,
      mode: 'manual-download',
      message: MANUAL_DOWNLOAD_MESSAGE,
    };
  },
});

/**
 * Factory for the default manual-download provider.
 *
 * Returns the shared frozen {@link downloadWriteBackProvider}. Provided as a
 * convenience/alternate entry point so callers that prefer a factory style can
 * obtain the default seam without importing the singleton directly.
 *
 * @returns {WriteBackProvider} The manual-download (no-op) provider.
 */
export function createDownloadWriteBackProvider() {
  return downloadWriteBackProvider;
}

/**
 * The currently active provider. Starts as the manual-download no-op provider
 * and can be replaced at runtime by a future phase via
 * {@link setWriteBackProvider} — this indirection is the structural seam that
 * lets callers stay unchanged when write-back arrives (_Requirements: 15.2_).
 *
 * @type {WriteBackProvider}
 */
let activeProvider = downloadWriteBackProvider;

/**
 * Register the active write-back provider (Phase 5 registration hook).
 *
 * A future OAuth/token-based provider is plugged in here without changing any
 * caller (_Requirements: 15.2_). The provider must implement
 * {@link WriteBackProvider}. Passing a provider WITHOUT a `saveToGitHub`
 * function is rejected so the seam stays well-formed.
 *
 * Any future provider registered here MUST source its credentials from
 * user-supplied runtime auth — never from hardcoded source secrets
 * (_Requirements: 15.3_).
 *
 * @param {WriteBackProvider} provider  The provider to activate.
 * @returns {void}
 * @throws {TypeError} If `provider` does not implement `saveToGitHub`.
 */
export function setWriteBackProvider(provider) {
  if (!provider || typeof provider.saveToGitHub !== 'function') {
    throw new TypeError(
      'setWriteBackProvider requires a WriteBackProvider with a saveToGitHub() method.',
    );
  }
  activeProvider = provider;
}

/**
 * Get the active write-back provider.
 *
 * Callers use this to perform a "save" without knowing which provider is wired
 * in; it returns the manual-download no-op by default (_Requirements: 15.2_).
 *
 * @returns {WriteBackProvider} The active provider.
 */
export function getWriteBackProvider() {
  return activeProvider;
}

/**
 * Reset the active provider back to the default manual-download provider.
 *
 * Primarily useful for tests and for a future phase that wants to "sign out"
 * and fall back to the manual workflow. Keeps the seam symmetric with
 * {@link setWriteBackProvider}.
 *
 * @returns {void}
 */
export function resetWriteBackProvider() {
  activeProvider = downloadWriteBackProvider;
}
