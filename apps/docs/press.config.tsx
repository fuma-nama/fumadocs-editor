import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { pageSchema, metaSchema } from "fumapress/adapters/mdx/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { FumadocsIcon } from "./src/logo";
import { EditorDemo } from "./src/demo";

const docs = defineDocs({
  dir: "content",
  docs: {
    async: true,
    lastModified: true,
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  content: docs.toFumadocsSource(),
  site: {
    name: "Fumadocs Editor",
    baseUrl: "https://editor.fumadocs.dev",
    git: { user: "fuma-nama", repo: "fumadocs-editor", branch: "dev", rootDir: "../.." },
  },
  loaderOptions: {
    plugins: [lucideIconsPlugin()],
  },
  defaultLayoutProps: {
    nav: {
      title: (
        <>
          <FumadocsIcon className="size-5" />
          Fumadocs Editor
        </>
      ),
    },
  },
  meta: {
    root() {
      return (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link
            href="https://fonts.googleapis.com/css2?family=Geist:ital,wght@0,100..900;1,100..900&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap"
            rel="stylesheet"
          />
          <link rel="icon" href="/icon.png" type="image/png" />
        </>
      );
    },
  },
}).adapters(
  fumadocsMdx({
    async getMdxComponents(page) {
      return {
        ...defaultMdxComponents,
        Tab,
        Tabs,
        Step,
        Steps,
        Accordion,
        Accordions,
        TypeTable,
        EditorDemo,
        a: createRelativeLink(await this.getLoader(), page),
      };
    },
  }),
);
