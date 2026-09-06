import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@fumadocs-editor/ui/styles.css";
import "./styles.css";
import "virtual:fumadocs-studio-styles";
import config from "virtual:fumadocs-studio-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorThemeProvider } from "@fumadocs-editor/ui";
import { Studio } from "./app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EditorThemeProvider defaultTheme={config.theme} className="studio-root">
      <Studio />
    </EditorThemeProvider>
  </StrictMode>,
);
