import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComposerApp } from "./ui/ComposerApp.js";
import { registerPwa } from "./pwa.js";
import { installQaHooks } from "./qa.js";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ComposerApp />
  </StrictMode>,
);

installQaHooks();
window.setTimeout(() => void registerPwa(), 0);
