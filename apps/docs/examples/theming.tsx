import { EditorThemeProvider, MdxEditor } from "@fumadocs-editor/ui";

export function StandaloneEditor({ source }: { source: string }) {
  return (
    <EditorThemeProvider>
      <MdxEditor defaultValue={source} />
    </EditorThemeProvider>
  );
}
