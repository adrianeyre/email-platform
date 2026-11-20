import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import {
  applyAppearance,
  installThemes,
  loadAppearance,
} from "./appearance.js";
import "./styles.css";

installThemes();
applyAppearance(loadAppearance());

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
