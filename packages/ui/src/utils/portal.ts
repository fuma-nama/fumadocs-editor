"use client";
import { useCallback, useState } from "react";

/**
 * Popups must portal INSIDE the editor root (`[data-fde-root]`), not to
 * `<body>`: the root carries the resolved theme scope, so a body-level popup
 * on a `theme="light"` editor under a dark OS would resolve the dark tokens.
 * Attach `anchorRef` to any element inside the editor (usually the trigger)
 * and pass `container` to the Base UI Portal.
 */
export function useEditorPortal() {
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
  const anchorRef = useCallback((node: HTMLElement | null) => {
    if (node) setContainer((node.closest("[data-fde-root]") as HTMLElement | null) ?? undefined);
  }, []);
  return { anchorRef, container };
}
