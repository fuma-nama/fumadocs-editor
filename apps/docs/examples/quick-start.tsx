import { MdxEditor, fumadocsUiComponents } from "@fumadocs-editor/ui";

export function EditorPage() {
  return (
    <MdxEditor
      defaultValue={"# Hello world\n"}
      components={fumadocsUiComponents}
      onMarkdownChange={(markdown) => {
        // persist it wherever your content lives
        console.log(markdown);
      }}
    />
  );
}
