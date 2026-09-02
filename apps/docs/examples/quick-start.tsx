import { MdxEditor } from "@fumadocs-editor/ui";

export function EditorPage({ source }: { source: string }) {
  return (
    <MdxEditor
      defaultValue={source}
      onChange={(markdown) => {
        // persist it wherever your content lives
        console.log(markdown);
      }}
    />
  );
}
