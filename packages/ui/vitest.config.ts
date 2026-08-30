import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@fumadocs-editor\/core$/,
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@fumadocs-editor\/core\/(parse|serialize|extensions)$/,
        replacement: fileURLToPath(new URL("../core/src/$1.ts", import.meta.url)),
      },
      {
        find: /^@fumadocs-editor\/sync$/,
        replacement: fileURLToPath(new URL("../sync/src/index.ts", import.meta.url)),
      },
      {
        find: /^@fumadocs-editor\/sync\/merge$/,
        replacement: fileURLToPath(new URL("../sync/src/merge.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
