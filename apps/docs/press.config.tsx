import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { docs } from "./.source/server";

export default defineConfig({
  content: docs.toFumadocsSource(),
  site: {
    name: "Fumadocs Editor",
  },
}).adapters(fumadocsMdx());
