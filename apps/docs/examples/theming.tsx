import { EditorThemeProvider, MdxEditor, fumadocsUiComponents } from "@fumadocs-editor/ui";

export function StandaloneEditor() {
  return (
    <EditorThemeProvider>
      <MdxEditor defaultValue={"# Hello\n"} components={fumadocsUiComponents} />
    </EditorThemeProvider>
  );
}
