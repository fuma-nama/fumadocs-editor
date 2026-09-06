import { defineConfig } from "vite";
import { editorSync } from "@fumadocs-editor/core/vite";

export default defineConfig({
  plugins: [editorSync({ root: "content/docs" })],
});
