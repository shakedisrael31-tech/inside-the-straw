import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',            // relative paths so the build works from any folder, e.g. GitHub Pages
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
