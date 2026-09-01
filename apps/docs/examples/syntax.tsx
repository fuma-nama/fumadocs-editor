import {
  MdxEditor,
  admonitionSpec,
  filesFenceSpecs,
  fumadocsUiComponents,
} from "@fumadocs-editor/ui";

// registering the admonition spec is what turns the ::: dialect on
const components = [...fumadocsUiComponents, admonitionSpec, ...filesFenceSpecs];

export function DialectEditor({ text }: { text: string }) {
  return <MdxEditor defaultValue={text} components={components} syntax={{ math: true }} />;
}
