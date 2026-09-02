"use client";
import { MdxEditor } from "@fumadocs-editor/ui";

const source = `## Try it

Click anywhere and type. Press \`/\` on an empty line to insert a block.

<Callout type="info" title="Everything here is editable">
  Callouts, cards, tabs and other fumadocs-ui components are edited in place.
</Callout>

- Select text for the formatting toolbar
- Drag the handle beside a block to move it
- Switch to the **Source** tab to see the MDX
`;

export function EditorDemo() {
  return (
    <div className="not-prose my-6">
      <MdxEditor defaultValue={source} />
    </div>
  );
}
