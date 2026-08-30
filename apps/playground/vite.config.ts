import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5199 },
  build: {
    rolldownOptions: {
      output: {
        // react in its own chunk: a fumadocs host already ships it, so the
        // size budget (scripts/check-size.mjs) tracks the editor's own
        // eager cost separately
        advancedChunks: {
          groups: [{ name: "react", test: /node_modules\/.+\/(react|react-dom|scheduler)@/ }],
        },
      },
    },
  },
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
        find: /^@fumadocs-editor\/ui$/,
        replacement: path.resolve(dir, "../../packages/ui/src/index.ts"),
      },
      {
        find: /^@fumadocs-editor\/core$/,
        replacement: path.resolve(dir, "../../packages/core/src/index.ts"),
      },
      {
        find: /^@fumadocs-editor\/core\/(parse|serialize|extensions)$/,
        replacement: path.resolve(dir, "../../packages/core/src/$1.ts"),
      },
    ],
  },
});
