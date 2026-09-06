import { defineConfig } from "@fumadocs-editor/studio";
import { admonitionSpec, fumadocsUiComponents } from "@fumadocs-editor/ui";

export default defineConfig({
  root: "content/docs",
  port: 5180,
  components: [...fumadocsUiComponents, admonitionSpec],
  syntax: { math: true },
  theme: "system",
  // stylesheets for your own renderers, relative to this file
  styles: ["./studio.css"],
  // node-only options live in their own module
  server: "./studio.server.ts",
});
