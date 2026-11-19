import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command, mode }) => {
  // Real logos in `npm run dev` only: read the demo Brandfetch client ID from the repo .env and
  // inline it as __DEMO_BF_ID__. The production build never reads it, so the committed prototype
  // ships no ID and makes zero Brandfetch requests (D165). `?bf=<id>` is the manual override.
  const demoBrandfetchId =
    command === "serve"
      ? (loadEnv(mode, r("../../"), "DEMO_BRANDFETCH_").DEMO_BRANDFETCH_CLIENT_ID ?? "")
      : "";
  return {
    plugins: [react(), tailwindcss(), viteSingleFile()],
    resolve: {
      alias: {
        "@": r("./src/kit"),
        "next/link": r("./src/shims/next-link.tsx"),
      },
    },
    define: {
      __DEMO_BF_ID__: JSON.stringify(demoBrandfetchId),
    },
    build: {
      target: "es2022",
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 5000,
    },
  };
});
