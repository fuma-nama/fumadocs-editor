"use client";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { MdxEditorRoot, useEditorMode, type MdxEditorRootProps } from "./root";
import { ModeTabs, SourceSurface, SyncStatus, VisualSurface } from "./surfaces";
import { consts } from "./styles/consts.stylex";
import { tokens } from "./styles/tokens.stylex";

export interface MdxEditorProps extends MdxEditorRootProps {
  /**
   * First paint without parsing. Markup should match the document so the
   * swap on hydrate does not shift.
   */
  staticFallback?: ReactNode;
  /**
   * `card` (default): a bordered box among other page content. `page`: the
   * editor is the page: the header stays at the top while the document
   * scrolls in a centered column (`--fde-page-width`, default 52rem) that
   * keeps clear of `--fde-page-inset`, for a panel floating at the start.
   */
  variant?: "card" | "page";
  /** extra controls in the header: `start` before the sync status, `end` after the mode tabs */
  header?: { start?: ReactNode; end?: ReactNode };
  className?: string;
}

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    WebkitTapHighlightColor: "transparent",
    display: "flex",
    flexDirection: "column",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: tokens.border,
      ":focus-within": `color-mix(in oklab, ${tokens.ring} 60%, transparent)`,
    },
    backgroundColor: tokens.background,
    color: tokens.foreground,
    fontSize: tokens.fontSize,
    lineHeight: 1.625,
    boxShadow: consts.shadowSm,
  },
  page: {
    minHeight: "100dvh",
    borderWidth: 0,
    borderRadius: 0,
    boxShadow: "none",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    borderStartStartRadius: "inherit",
    borderStartEndRadius: "inherit",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.card} 40%, transparent)`,
    paddingInline: "0.5rem",
    paddingBlock: "0.25rem",
  },
  barPage: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    backgroundColor: `color-mix(in oklab, ${tokens.background} 85%, transparent)`,
    backdropFilter: "blur(12px)",
    paddingInline: "0.75rem",
    paddingBlock: "0.375rem",
  },
  grow: { flex: 1, minWidth: 0 },
  // centered in the viewport when there is room, else right of the inset
  pageColumn: {
    flex: 1,
    maxWidth: "var(--fde-page-width, 52rem)",
    marginInlineStart:
      "max(calc((100% - var(--fde-page-width, 52rem)) / 2), var(--fde-page-inset, 0px))",
    transition: {
      default: `margin-inline-start 150ms ${consts.ease}`,
      [consts.reduceMotion]: "none",
    },
  },
});

function Frame({
  staticFallback,
  variant = "card",
  header,
  className,
}: Omit<MdxEditorProps, keyof MdxEditorRootProps>) {
  const { mode } = useEditorMode();
  const page = variant === "page";
  let rootClass = stylex.props(styles.root, page && styles.page).className!;
  if (className) rootClass += ` ${className}`;
  const column = page ? stylex.props(styles.pageColumn).className : undefined;

  return (
    <div className={rootClass}>
      <div {...stylex.props(styles.bar, page && styles.barPage)}>
        {header?.start}
        <div {...stylex.props(styles.grow)}>
          <SyncStatus />
        </div>
        <ModeTabs />
        {header?.end}
      </div>
      {mode === "visual" ? (
        <VisualSurface staticFallback={staticFallback} className={column} />
      ) : (
        <SourceSurface fixed={page} className={column} />
      )}
    </div>
  );
}

/**
 * The ready-made editor: sync status, Visual / MDX tabs, one surface at a
 * time. Compose your own layout from the parts when this does not fit.
 */
export function MdxEditor({ staticFallback, variant, header, className, ...root }: MdxEditorProps) {
  return (
    <MdxEditorRoot {...root}>
      <Frame
        staticFallback={staticFallback}
        variant={variant}
        header={header}
        className={className}
      />
    </MdxEditorRoot>
  );
}

MdxEditor.Root = MdxEditorRoot;
MdxEditor.Visual = VisualSurface;
MdxEditor.Source = SourceSurface;
MdxEditor.Status = SyncStatus;
MdxEditor.Tabs = ModeTabs;
