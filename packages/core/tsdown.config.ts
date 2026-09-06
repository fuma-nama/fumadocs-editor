import { defineConfig } from "tsdown";

/**
 * y-tiptap is bundled (it imports prosemirror-transform without declaring it),
 * so its ProseMirror imports are routed to the editor's own @tiptap/pm copies
 */
const pmThroughTiptap = {
  name: "pm-through-tiptap",
  resolveId: (id: string) =>
    id.startsWith("prosemirror-") ? { id: `@tiptap/pm/${id.slice(12)}`, external: true } : null,
};

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/parse.ts",
    "./src/serialize.ts",
    "./src/extensions.ts",
    "./src/sync.ts",
    "./src/collab.ts",
    "./src/node.ts",
    "./src/vite.ts",
  ],
  format: "esm",
  target: "es2023",
  platform: "neutral",
  dts: true,
  plugins: [pmThroughTiptap],
});
