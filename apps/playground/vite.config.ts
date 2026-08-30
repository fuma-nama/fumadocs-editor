import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5199 },
  resolve: {
    // workspace sources are aliased in from outside the app root, which can make
    // vite hand them a second React instance (breaking hooks in node-view
    // renderers like Accordion). Force a single copy.
    dedupe: ["react", "react-dom"],
    // consume workspace package sources directly so `pnpm dev` needs no build step
    alias: [
      {
        find: "@fumadocs-editor/ui/css/preset.css",
        replacement: path.resolve(dir, "../../packages/ui/css/preset.css"),
      },
      {
        find: "@fumadocs-editor/ui",
        replacement: path.resolve(dir, "../../packages/ui/src/index.ts"),
      },
      {
        find: "@fumadocs-editor/core",
        replacement: path.resolve(dir, "../../packages/core/src/index.ts"),
      },
    ],
  },
});
