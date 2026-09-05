import type { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

export function registerLanguages(lowlight: ReturnType<typeof createLowlight>): void {
  lowlight.register({
    bash,
    css,
    go,
    javascript,
    json,
    markdown,
    python,
    rust,
    sql,
    typescript,
    xml,
    yaml,
  });
  lowlight.registerAlias({
    javascript: ["jsx", "mjs", "cjs"],
    typescript: ["tsx"],
    xml: ["html"],
    markdown: ["mdx"],
  });
}
