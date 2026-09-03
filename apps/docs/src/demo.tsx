"use client";
import { MdxEditor } from "@fumadocs-editor/ui";

const source = `## Try it

Click anywhere and type. Press \`/\` on an empty line to insert a block.

<Callout type="info" title="Everything here is editable">
  Callouts, cards, tabs and other fumadocs-ui components are edited in place.
</Callout>

- Select text for the toolbar; hold its joystick to drag the block
- Press ⌘B, type in bold, then → at the line's end to stop
- Switch to the **MDX** tab to see the source
`;

export function EditorDemo() {
  return (
    <div className="not-prose my-6">
      <MdxEditor defaultValue={source} />
    </div>
  );
}
