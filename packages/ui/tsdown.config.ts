import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";
import stylex from "@stylexjs/rollup-plugin";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: "esm",
  target: "es2023",
  platform: "browser",
  dts: true,
  plugins: [
    stylex({
      dev: false,
      fileName: "stylex.css",
      classNamePrefix: "fde",
      // unsupported properties (shorthands like `border`) fail the build
      // instead of silently dropping the declaration
      propertyValidationMode: "throw",
      unstable_moduleResolution: { type: "commonJS", rootDir: import.meta.dirname },
      // no lowering: the palette is oklch / color-mix already
      lightningcssOptions: {
        targets: { chrome: 120 << 16, firefox: 120 << 16, safari: 17 << 16 },
      },
    }),
    {
      // one stylesheet: base.css (tokens, reset, non-authored DOM) + StyleX
      name: "fde-css",
      generateBundle(_options, bundle) {
        const compiled = bundle["stylex.css"];
        delete bundle["stylex.css"];
        this.emitFile({
          type: "asset",
          fileName: "index.css",
          source:
            readFileSync(new URL("./src/styles/base.css", import.meta.url), "utf8") +
            (compiled?.type === "asset" ? `\n${compiled.source}` : ""),
        });
      },
    },
  ],
});
