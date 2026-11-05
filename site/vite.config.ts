import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const PROTOTYPE = at('../ui-reference/prototype-src');

// A file under the prototype resolves bare imports from its own node_modules first, when that
// folder exists. Resolving every one of its dependencies from the repo root keeps one React.
const prototypeDependencies = Object.keys(
  z
    .object({ dependencies: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(`${PROTOTYPE}/package.json`, 'utf8'))).dependencies,
);

/**
 * The demo's own Brandfetch client ID, from the repo's `.env`, goes into the bundle: every
 * visitor's browser sends it on each logo URL. The app's ID never does (D165).
 */
export function demoClientId(env: Record<string, string>): string {
  const demo = env.DEMO_BRANDFETCH_CLIENT_ID?.trim() ?? '';
  if (demo.length > 0 && demo === env.BRANDFETCH_CLIENT_ID?.trim()) {
    throw new Error(
      "DEMO_BRANDFETCH_CLIENT_ID is the app's Brandfetch client ID. The demo needs its own (D165).",
    );
  }
  return demo;
}

export default defineConfig(({ mode }) => ({
  root: at('.'),
  appType: 'mpa',
  plugins: [react(), tailwindcss()],
  define: {
    __DEMO_BRANDFETCH_CLIENT_ID__: JSON.stringify(demoClientId(loadEnv(mode, at('..'), ''))),
  },
  resolve: {
    alias: {
      '@': `${PROTOTYPE}/src/kit`,
      'next/link': `${PROTOTYPE}/src/shims/next-link.tsx`,
    },
    dedupe: prototypeDependencies,
  },
  build: {
    outDir: at('dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        demo: at('index.html'),
        about: at('about/index.html'),
        form: at('form/index.html'),
        notFound: at('404.html'),
      },
    },
  },
}));
