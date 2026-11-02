import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'ui-reference/**'],
    environment: 'node',
    globals: false,
  },
});
