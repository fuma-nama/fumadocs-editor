import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/parse.ts", "./src/serialize.ts", "./src/extensions.ts"],
  format: "esm",
  target: "es2023",
  platform: "browser",
  dts: true,
});
