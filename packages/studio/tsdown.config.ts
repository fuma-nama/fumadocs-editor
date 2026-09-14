import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";
import stylex from "@stylexjs/rollup-plugin";

export default defineConfig([
  {
    entry: ["./src/index.ts", "./src/node.ts", "./src/cli.ts"],
    format: "esm",
    target: "es2023",
    platform: "node",
    fixedExtension: false,
    dts: true,
  },
  // the browser app, compiled ahead of time so the dev server only serves it:
  // StyleX runs here, never inside a Vite transform
  {
    entry: { main: "./app/main.tsx" },
    outDir: "dist/app",
    format: "esm",
    target: "es2023",
    platform: "browser",
    hash: false,
    deps: { neverBundle: [/^virtual:/] },
    copy: ["./app/index.html"],
    plugins: [
      stylex({
        dev: false,
        fileName: "stylex.css",
        classNamePrefix: "fds",
        propertyValidationMode: "throw",
        unstable_moduleResolution: { type: "commonJS", rootDir: import.meta.dirname },
        lightningcssOptions: {
          targets: { chrome: 120 << 16, firefox: 120 << 16, safari: 17 << 16 },
        },
      }),
      {
        name: "studio-css",
        generateBundle(_options, bundle) {
          const compiled = bundle["stylex.css"];
          delete bundle["stylex.css"];
          this.emitFile({
            type: "asset",
            fileName: "main.css",
            source:
              readFileSync(new URL("./app/styles.css", import.meta.url), "utf8") +
              (compiled?.type === "asset" ? `\n${compiled.source}` : ""),
          });
        },
      },
    ],
  },
]);
