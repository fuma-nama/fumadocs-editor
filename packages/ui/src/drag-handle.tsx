"use client";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, type CSSProperties } from "react";
import type { Editor } from "@tiptap/react";
import type { UiComponentSpec } from "./components/spec";
import { setLifted } from "./components/node-views";
import { startPointerDrag } from "./components/structure";
import { joystick as marker } from "./styles/markers.stylex";
import { consts } from "./styles/consts.stylex";
import { tokens } from "./styles/tokens.stylex";
import { chrome } from "./styles/shared";

/** pointer travel, in px, that tilts the stick all the way */
const REACH = 28;

/* A joystick seen from above: a shaded socket, and a red ball on a stick
 * that leans toward the pointer while it is held, then springs back. The
 * lean is written straight to the DOM on every move, never through React. */
const spring = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const styles = stylex.create({
  /** the ball answers the hover, not the button's wash */
  button: {
    touchAction: "none",
    cursor: { default: "grab", ":active": "grabbing" },
    backgroundColor: "transparent",
  },
  socket: {
    position: "relative",
    display: "block",
    width: "var(--fde-joy)",
    height: "var(--fde-joy)",
    borderRadius: 9999,
    // the theme's own greys: a dimple that reads on both light and dark
    backgroundImage: `radial-gradient(circle at 50% 40%, ${tokens.accent}, ${tokens.muted} 72%)`,
    boxShadow: `inset 0 1px 3px rgb(0 0 0 / 0.3), 0 1px 0 color-mix(in oklab, ${tokens.foreground} 14%, transparent)`,
  },
  stick: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 2,
    height: "calc(var(--fde-joy) * 0.4)",
    marginLeft: -1,
    borderRadius: 1,
    backgroundImage: "linear-gradient(90deg, #6f6f6f, #d6d6d6, #6f6f6f)",
    transformOrigin: "50% 0",
    transform: "scaleY(0)",
    transitionProperty: "transform",
    transitionDuration: {
      default: "260ms",
      [stylex.when.ancestor("[data-dragging]", marker)]: "0ms",
      [consts.reduceMotion]: "0ms",
    },
    transitionTimingFunction: spring,
  },
  ball: {
    position: "absolute",
    top: "25%",
    left: "25%",
    width: "50%",
    height: "50%",
    borderRadius: 9999,
    backgroundImage: "radial-gradient(circle at 35% 30%, #ffa196, #e83a2c 48%, #7d0e08)",
    boxShadow: "inset 0 -1px 2px rgb(0 0 0 / 0.35)",
    filter: "drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.55))",
    scale: {
      default: "1",
      [stylex.when.ancestor(":hover", marker)]: "1.12",
      [stylex.when.ancestor("[data-dragging]", marker)]: "1.12",
    },
    transitionProperty: "transform, scale, filter",
    transitionDuration: {
      default: "260ms",
      [stylex.when.ancestor("[data-dragging]", marker)]: "0ms",
      [consts.reduceMotion]: "0ms",
    },
    transitionTimingFunction: spring,
  },
});

/**
 * Hold to drag: press the joystick and move to lift the block at `pos`,
 * release to drop it at the line. One control for a mouse and a finger.
 */
export function DragHandle({
  editor,
  pos,
  specs,
  look,
  size,
}: {
  editor: Editor;
  pos: number;
  specs: Map<string, UiComponentSpec>;
  /** the surface's button look, composed under the joystick's own */
  look: stylex.StyleXStyles;
  /** socket diameter in px */
  size: number;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const stick = useRef<HTMLSpanElement>(null);
  const ball = useRef<HTMLSpanElement>(null);
  const radius = size * 0.4;

  // The block lights up while the pointer is over the joystick or holds it,
  // so what a drag would move is never a guess. Native listeners: the
  // toolbar is re-attached to the DOM by its plugin, and React's synthesized
  // enter/leave never reaches it there.
  useEffect(() => {
    const el = button.current!;
    const enter = () => setLifted(editor, pos);
    const leave = () => setLifted(editor, null);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      if (!editor.isDestroyed) setLifted(editor, null);
    };
  }, [editor, pos]);

  const tilt = (dx: number, dy: number) => {
    const dist = Math.hypot(dx, dy);
    // held: lit whatever the pointer's boundary events say under capture
    if (dist > 0) setLifted(editor, pos);
    const lean = Math.min(1, dist / REACH);
    const ux = dist && (dx / dist) * lean * radius;
    const uy = dist && (dy / dist) * lean * radius;
    const b = ball.current!;
    b.style.transform = `translate(${ux}px, ${uy}px)`;
    // the ball's shadow falls away from the lean, as if lit from above
    b.style.filter = `drop-shadow(${-ux * 0.5}px ${1 - uy * 0.5}px 1.5px rgb(0 0 0 / 0.55))`;
    stick.current!.style.transform = `rotate(${Math.atan2(-dx, dy)}rad) scaleY(${lean})`;
    button.current!.toggleAttribute("data-dragging", dist > 0);
  };

  return (
    <button
      ref={button}
      type="button"
      aria-label="Hold to drag"
      title="Hold to drag"
      {...stylex.props(chrome.button, look, styles.button, marker)}
      style={{ "--fde-joy": `${size}px` } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // no mousedown follows, so focus stays in the editor
        event.preventDefault();
        startPointerDrag(editor.view, pos, event.nativeEvent, specs, tilt);
      }}
    >
      <span {...stylex.props(styles.socket)} aria-hidden>
        <span ref={stick} {...stylex.props(styles.stick)} />
        <span ref={ball} {...stylex.props(styles.ball)} />
      </span>
    </button>
  );
}
