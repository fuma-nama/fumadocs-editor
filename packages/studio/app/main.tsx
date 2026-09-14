import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@fumadocs-editor/ui/styles.css";
import "virtual:fumadocs-studio-styles";
import config from "virtual:fumadocs-studio-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { EditorThemeProvider } from "@fumadocs-editor/ui";
import { Studio } from "./app";

const styles = stylex.create({
  root: {
    minHeight: "100dvh",
    backgroundColor: "var(--fde-background)",
    color: "var(--fde-foreground)",
    WebkitFontSmoothing: "antialiased",
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EditorThemeProvider
      defaultTheme={config.theme}
      className={stylex.props(styles.root).className}
    >
      <Studio />
    </EditorThemeProvider>
  </StrictMode>,
);
