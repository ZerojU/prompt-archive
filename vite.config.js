import { defineConfig } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Copy runtime-fetched static data directories into the build output.
 *
 * The Archive_App fetches, at runtime and relative to Base_URL:
 *   - `manifest.json`          (emitted by Vite from `public/manifest.json`)
 *   - `config/category.json`   (NOT under public/ — copied here)
 *   - `prompts/**\/*.html`      (NOT under public/ — copied here)
 *
 * Vite only copies `public/` to the dist root, so without this plugin a
 * built/deployed site could not fetch `config/` or `prompts/`. Rather than
 * duplicating those directories into `public/` (which would create stale
 * copies in the repo), this plugin copies them into `dist/` on `closeBundle`
 * at the SAME relative paths the app requests. The directory layout in
 * design.md ("빌드 결과 dist/에 … config/category.json, prompts/** 가 포함된다")
 * is preserved.
 *
 * During `vite dev`, these directories are served directly from the project
 * root, so no copy is needed there; this plugin only augments the build.
 *
 * @returns {import('vite').Plugin}
 */
function copyStaticDataPlugin() {
  const dirsToCopy = ['config', 'prompts'];
  let outDir = 'dist';
  return {
    name: 'copy-static-data',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
    async closeBundle() {
      const absOutDir = resolve(projectRoot, outDir);
      for (const dir of dirsToCopy) {
        const src = resolve(projectRoot, dir);
        if (!existsSync(src)) continue;
        const dest = resolve(absOutDir, dir);
        await mkdir(dirname(dest), { recursive: true });
        // Recursively copy the whole directory tree, preserving relative paths.
        await cp(src, dest, { recursive: true });
      }
    },
  };
}

/**
 * Vite configuration for GitHub Prompt Archive.
 *
 * `base` is resolved from a CI-provided environment variable (`VITE_BASE`) so the
 * GitHub Pages project-page sub-path (e.g. `/repo/`) can be injected during the
 * deploy workflow. It falls back to a relative base (`./`) which works for the
 * user page root (`username.github.io/`) and local development (`localhost`).
 * No domain or host is hardcoded (Requirements 1.5, 1.6, 1.7).
 *
 * The Vitest block configures a jsdom environment with globals enabled so DOM
 * component tests can run, and only picks up test files under the test folder.
 */
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [copyStaticDataPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.js'],
  },
});
