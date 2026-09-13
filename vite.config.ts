import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { createManifest, type BrowserTarget } from './manifest.config.ts';

function targetForMode(mode: string): BrowserTarget {
  if (mode === 'chrome' || mode === 'firefox') return mode;
  return 'edge';
}

export default defineConfig(({ mode }) => {
  const target = targetForMode(mode);
  const targetedBuild = mode === 'edge' || mode === 'chrome' || mode === 'firefox';
  return {
    plugins: [crx({ manifest: createManifest(target) })],
    build: {
      // `npm run build` preserves the existing dist/ workflow. Explicit browser builds are kept
      // side-by-side so all three can be packaged in one run without overwriting each other.
      outDir: targetedBuild ? `dist/${target}` : 'dist',
      emptyOutDir: true,
    },
  };
});
