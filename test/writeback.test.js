import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  downloadWriteBackProvider,
  createDownloadWriteBackProvider,
  getWriteBackProvider,
  setWriteBackProvider,
  resetWriteBackProvider,
} from '../src/services/writeBackService.js';

/**
 * Tests for the Phase 5 write-back extension point (writeBackService.js).
 *
 * This is STRUCTURE-ONLY scaffolding: the default provider must represent the
 * manual-download workflow (no GitHub, no network, no throw), and the
 * register/get seam must swap the active provider without touching callers.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3**
 */
describe('writeBackService (Phase 5 hook, structure only)', () => {
  afterEach(() => {
    // Keep the seam symmetric and tests isolated.
    resetWriteBackProvider();
    vi.restoreAllMocks();
  });

  it('defaults to the manual-download provider (15.1, 15.2)', () => {
    expect(getWriteBackProvider()).toBe(downloadWriteBackProvider);
    expect(createDownloadWriteBackProvider()).toBe(downloadWriteBackProvider);
  });

  it('saveToGitHub returns the manual-download result without throwing or network (15.1)', async () => {
    // Guard against any accidental network call via fetch.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => {
        throw new Error('fetch must not be called by the default provider');
      });

    const result = await downloadWriteBackProvider.saveToGitHub(
      'prompts/backend/spring.html',
      '<html>edited</html>',
      { message: 'should be ignored' },
    );

    expect(result).toEqual({
      ok: false,
      mode: 'manual-download',
      message: '현재 버전은 다운로드 후 수동 커밋 방식입니다.',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('setWriteBackProvider / getWriteBackProvider swap the active provider (15.2)', () => {
    const futureProvider = {
      async saveToGitHub() {
        return { ok: true, mode: 'github', message: 'saved' };
      },
    };

    setWriteBackProvider(futureProvider);
    expect(getWriteBackProvider()).toBe(futureProvider);

    resetWriteBackProvider();
    expect(getWriteBackProvider()).toBe(downloadWriteBackProvider);
  });

  it('setWriteBackProvider rejects an invalid provider (keeps the seam well-formed)', () => {
    expect(() => setWriteBackProvider({})).toThrow(TypeError);
    expect(() => setWriteBackProvider(null)).toThrow(TypeError);
    // Active provider is unchanged after a rejected registration.
    expect(getWriteBackProvider()).toBe(downloadWriteBackProvider);
  });
});
