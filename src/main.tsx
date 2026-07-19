import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComposerApp } from "./ui/ComposerApp.js";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ComposerApp />
  </StrictMode>,
);
