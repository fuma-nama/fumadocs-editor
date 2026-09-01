import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/collab.ts", "./src/merge.ts", "./src/node.ts", "./src/vite.ts"],
  format: "esm",
  target: "es2023",
  platform: "neutral",
  dts: true,
});
