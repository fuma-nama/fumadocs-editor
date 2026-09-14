"use client";
import { useRef, type RefObject } from "react";

/**
 * Popups must portal INSIDE the editor root (`[data-fde-root]`), not to
 * `<body>`: the root carries the resolved theme scope, so a body-level popup
 * on a `theme="light"` editor under a dark OS would resolve the dark tokens.
 * Attach `anchorRef` to any element inside the editor (usually the trigger)
 * and pass `container` to the Base UI Portal.
 *
 * A control nested in another popup (`[data-fde-popup]`) portals into THAT
 * popup instead: portalled to the root it would sit outside the parent's
 * DOM, and picking an option would register as an outside press and dismiss
 * the parent panel.
 *
 * `container` is a ref object: Base UI reads it when the portal mounts, which
 * is on open, long after the anchor attached. Resolving it into state would
 * cost every control a second render on mount.
 *
 * Every positioner uses `positionMethod="fixed"`. Base UI keeps a popup
 * `position: fixed` until its first placement is computed, and Floating UI
 * measures that pass against the viewport; the `absolute` method then
 * applies those coordinates inside the container's positioned ancestor (the
 * bubble's wrapper) and lands the popup off by that ancestor's offset until
 * a scroll recomputes it.
 */
export function useEditorPortal(): {
  anchorRef: (node: HTMLElement | null) => void;
  container: RefObject<HTMLElement | null>;
} {
  const container = useRef<HTMLElement | null>(null);
  const anchorRef = useRef((node: HTMLElement | null) => {
    if (node) container.current = node.closest("[data-fde-popup], [data-fde-root]");
  });
  return { anchorRef: anchorRef.current, container };
}
