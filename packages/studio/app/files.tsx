import { useEffect, useRef } from "react";
import * as stylex from "@stylexjs/stylex";
import { FileTree, type FileTreeProps } from "@fumadocs-editor/ui";

const REDUCE = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  panel: {
    position: "fixed",
    top: "3.25rem",
    bottom: "0.75rem",
    left: "0.75rem",
    zIndex: 20,
    display: "block",
    boxSizing: "border-box",
    width: "min(18rem, calc(100vw - 1.5rem))",
    padding: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--fde-border)",
    borderRadius: "0.75rem",
    backgroundColor: "var(--fde-popover)",
    color: "var(--fde-popover-foreground)",
    boxShadow: "0 12px 32px -12px rgb(0 0 0 / 0.3)",
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
    // stays in the tree while hidden, so both directions animate
    visibility: { default: "visible", ":is([hidden])": "hidden" },
    opacity: { default: 1, ":is([hidden])": 0 },
    translate: { default: "0 0", ":is([hidden])": "-0.75rem 0" },
    transitionProperty: "opacity, translate, visibility",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
});

export interface FilePanelProps extends Omit<FileTreeProps, "className" | "ref"> {
  hidden: boolean;
  onClose: () => void;
}

/** the floating file list: opening focuses the open file's row, Escape closes it */
export function FilePanel({ hidden, onClose, ...tree }: FilePanelProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (hidden) return;
    // the panel is still `visibility: hidden` until its transition starts
    const frame = requestAnimationFrame(() => {
      const panel = ref.current!;
      const row = panel.querySelector<HTMLElement>('[aria-current="page"], [data-item]');
      row?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden]);

  return (
    <aside
      {...stylex.props(styles.panel)}
      aria-label="Files"
      hidden={hidden}
      ref={ref}
      data-files=""
      onKeyDown={(event) => {
        // portaled menus and dialogs bubble here through React; their Escape is theirs
        if (event.key === "Escape" && ref.current!.contains(event.target as Node)) onClose();
      }}
    >
      <FileTree {...tree} />
    </aside>
  );
}
