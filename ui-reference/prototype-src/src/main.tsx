import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./demo/demo-fonts.css";
import "./kit/fonts/fonts.css";
import "./kit/styles/globals.css";
import { App } from "./demo/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
