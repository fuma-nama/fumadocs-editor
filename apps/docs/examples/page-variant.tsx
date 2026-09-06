import { useState, type CSSProperties } from "react";
import { MdxEditor } from "@fumadocs-editor/ui";

export function Page({ path }: { path: string }) {
  const [panel, setPanel] = useState(false);
  return (
    // the open panel takes a column of its own instead of covering the text
    <div style={{ "--fde-page-inset": panel ? "18rem" : "0px" } as CSSProperties}>
      <MdxEditor
        variant="page"
        header={{
          start: (
            <button type="button" onClick={() => setPanel(!panel)}>
              Files
            </button>
          ),
        }}
        sync={{ path }}
      />
      {panel && (
        <aside style={{ position: "fixed", top: "3.25rem", left: "0.75rem", width: "17rem" }} />
      )}
    </div>
  );
}
