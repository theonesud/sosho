import "@ui-sdk/core/web.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/overlays.css";
import "./styles/layout.css";
import "./styles/surfaces.css";
import "./styles/graph.css";
import "./styles/canvas.css";
import "./styles/form.css";
import "./styles/motion.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
