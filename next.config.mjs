/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pnpm shoot` builds into its own directory so it never rewrites the `.next` that a running
  // `pnpm dev` in the same checkout is serving from (STATUS: dev + build sharing .next breaks dev).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // better-sqlite3 is a native module; keep it out of the server bundle so the
  // Next.js server components can require it at runtime.
  serverExternalPackages: ['better-sqlite3', 'playwright-core'],
  webpack: (config) => {
    // core/ uses TS-ESM-style `.js` import specifiers (required for tsx/NodeNext).
    // Teach webpack to resolve `.js` to the real `.ts`/`.tsx` sources first.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
