import { defineConfig } from "vite";
import { editorSync } from "@fumadocs-editor/sync/vite";

export default defineConfig({
  plugins: [editorSync({ root: "content/docs" })],
});
