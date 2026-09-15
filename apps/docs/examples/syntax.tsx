import {
  MdxEditor,
  admonitionSpec,
  filesFenceSpecs,
  fumadocsUiComponents,
} from "@fumadocs-editor/ui";

const components = [...fumadocsUiComponents, admonitionSpec, ...filesFenceSpecs];

export function DialectEditor({ text }: { text: string }) {
  return <MdxEditor defaultValue={text} components={components} syntax={{ math: true }} />;
}
