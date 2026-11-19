import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./demo/demo-fonts.css";
import "./kit/fonts/fonts.css";
import "./kit/styles/globals.css";
import { App } from "./demo/App";
import { brandfetchLogos } from "./demo/brandfetch";
import { demoHooks } from "./demo/demo-hooks";

/** Injected by vite.config.ts: the demo client ID in `npm run dev`, an empty string in the build. */
declare const __DEMO_BF_ID__: string;

declare global {
  interface Window {
    /** A host page can set a demo Brandfetch client ID before the bundle runs. */
    __DEMO_BRANDFETCH_CLIENT_ID__?: string;
  }
}

/**
 * Real company logos (D165): when a demo Brandfetch client ID is present at runtime, point
 * `demoHooks.logos` at the Logo CDN and the browser loads the real marks. The ID comes from
 * `?bf=<id>`, a `window` global a host sets, or `.env` in dev. With no ID — the committed build —
 * no hook is set, so the prototype makes zero Brandfetch requests and shows the stand-in marks.
 */
const brandfetchId =
  new URLSearchParams(location.search).get("bf") ??
  window.__DEMO_BRANDFETCH_CLIENT_ID__ ??
  __DEMO_BF_ID__;
if (brandfetchId.length > 0) {
  const logos = brandfetchLogos(brandfetchId);
  if (logos) demoHooks.logos = logos;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
