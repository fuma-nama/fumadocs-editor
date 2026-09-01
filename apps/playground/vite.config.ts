import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editorSync } from "@fumadocs-editor/sync/vite";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    editorSync({
      root: "docs",
      // toy auth layer for trying the scope enforcement: open the playground
      // with ?token=editor / ?token=viewer / ?token=anything-else (denied).
      // No token keeps the plain full-access dev flow, which is also what
      // asset <img> requests (no header) resolve to. A real consumer verifies
      // a session or JWT here instead.
      authenticate: async ({ payload }) => {
        if (payload === undefined) return { write: true };
        if (payload === "editor")
          return { user: { name: "Editor", color: "#2563eb" }, write: true };
        if (payload === "viewer")
          return { user: { name: "Viewer", color: "#059669" }, write: false };
        return null;
      },
    }),
  ],
  server: {
    port: 5199,
    // the mirrored documents are runtime data owned by the sync server;
    // vite must not react to their changes (tailwind's auto-scan would
    // otherwise invalidate the CSS and reload the page on every save)
    watch: { ignored: [path.resolve(dir, "docs")] },
  },
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
      {
        find: /^@fumadocs-editor\/sync\/merge$/,
        replacement: path.resolve(dir, "../../packages/sync/src/merge.ts"),
      },
      {
        find: /^@fumadocs-editor\/sync\/collab$/,
        replacement: path.resolve(dir, "../../packages/sync/src/collab.ts"),
      },
      {
        find: /^@fumadocs-editor\/sync$/,
        replacement: path.resolve(dir, "../../packages/sync/src/index.ts"),
      },
    ],
  },
});
