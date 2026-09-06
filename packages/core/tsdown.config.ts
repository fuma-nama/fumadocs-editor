import { defineConfig } from "tsdown";

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
});
