"use client";
import * as stylex from "@stylexjs/stylex";
import type { Editor } from "@tiptap/core";
import { renderAsync } from "pele/lazy";
import { use, useDeferredValue, useId, useMemo, useState } from "react";
import { tokens } from "../styles/tokens.stylex";

const styles = stylex.create({
  frame: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    padding: "1rem",
    userSelect: "none",
    opacity: { default: null, ":is([data-error])": 0.6 },
  },
});

export function MermaidDiagram({ code, editor }: { code: string; editor: Editor }) {
  const id = useId();
  // every render suspends: deferred, the last diagram stays up meanwhile
  // instead of the Suspense fallback
  const deferred = useDeferredValue(code);
  const promise = useMemo(() => {
    // the fonts mount() reads: pele's variables when the page sets them, else
    // the editor's own; labels are measured in them so they fit their nodes
    const style = getComputedStyle(editor.view.dom);
    const font = (name: string) => style.getPropertyValue(name).trim() || undefined;
    return renderAsync(deferred, {
      idPrefix: id,
      fontFamily: font("--pele-font") ?? style.fontFamily,
      fontFamilyMono: font("--pele-font-mono"),
    }).then(
      (result) => result.svg,
      () => undefined,
    );
  }, [deferred, id, editor]);
  const svg = use(promise);
  // text that does not parse keeps the last diagram, dimmed
  const [last, setLast] = useState(svg);
  if (svg !== undefined && svg !== last) setLast(svg);

  const shown = svg ?? last;
  if (shown === undefined) return null;
  return (
    <div
      {...stylex.props(styles.frame)}
      contentEditable={false}
      data-error={svg === undefined || undefined}
      dangerouslySetInnerHTML={{ __html: shown }}
    />
  );
}
