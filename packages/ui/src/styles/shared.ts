import * as stylex from "@stylexjs/stylex";
import { consts } from "./consts.stylex";
import { tokens } from "./tokens.stylex";

/*
 * Chrome primitives shared by the toolbar, panels and pickers. Every
 * floating surface portals into the editor root (`useEditorPortal`) and is
 * fully self-styled. Compose with `stylex.props(chrome.popup, local.x)`:
 * later arguments win per property, so overrides never depend on
 * stylesheet order.
 *
 * Nothing here relies on a host reset: form controls compose `button` /
 * `input` first, sized boxes carry their own `boxSizing`.
 *
 * Hot-path chrome reacts instantly: no colour transitions on items or
 * buttons, no popup entrance animation.
 */

export const chrome = stylex.create({
  /** UA button reset */
  button: {
    boxSizing: "border-box",
    appearance: "none",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    font: "inherit",
    letterSpacing: "inherit",
    color: "inherit",
    textAlign: "start",
  },
  /** UA input / textarea / select reset */
  input: {
    boxSizing: "border-box",
    appearance: "none",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    font: "inherit",
    letterSpacing: "inherit",
    color: "inherit",
  },
  /** keyboard focus ring; `focus-visible` keeps it off mouse clicks */
  focusRing: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": consts.focusRing },
  },
  /** non-editable chrome inside the document: never part of a text
   * selection or drag; its own paint layer so a drag ghost is rasterized
   * from it rather than the whole page */
  static: { position: "relative", isolation: "isolate", userSelect: "none" },
  /** stacking for positioners and fixed surfaces */
  layer: { zIndex: 50 },
  /* Padding scale: menus/lists keep p-1 (items px-2); form popovers
   * override to p-2, the picker to p-0 and pads each section itself. */
  popup: {
    boxSizing: "border-box",
    zIndex: 50,
    minWidth: "10rem",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.popover,
    padding: "0.25rem",
    fontSize: 13,
    lineHeight: 1.5,
    color: tokens.popoverForeground,
    boxShadow: consts.shadowLg,
    scrollbarColor: `${tokens.border} transparent`,
    scrollbarWidth: "thin",
  },
  item: {
    boxSizing: "border-box",
    display: "flex",
    cursor: "default",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "0.375rem",
    paddingInline: "0.5rem",
    paddingBlock: "0.375rem",
    userSelect: "none",
    color: {
      default: tokens.popoverForeground,
      ":hover": tokens.accentForeground,
      ":is([data-highlighted])": tokens.accentForeground,
    },
    // an explicit default: a conditional object replaces the whole
    // property, so `null` here would drop `button`'s transparent background
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.accent,
      ":is([data-highlighted])": tokens.accent,
    },
  },
  /** leading glyph cell of a menu item */
  itemIcon: {
    display: "inline-flex",
    width: "1rem",
    flexShrink: 0,
    justifyContent: "center",
    color: tokens.mutedForeground,
  },
  /* the check sits at the item's end: a leading check would indent only
   * the selected label and break the list's left alignment */
  itemIndicator: {
    marginInlineStart: "auto",
    display: "inline-flex",
    flexShrink: 0,
    paddingInlineStart: "0.5rem",
    color: tokens.foreground,
  },
  /** icon toolbar button: pointer chrome, never in the tab order. Hover is
   * the accent wash; a toggled mark is a solid primary tint. */
  iconButton: {
    boxSizing: "border-box",
    display: "inline-flex",
    width: "1.75rem",
    height: "1.75rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.5rem",
    outline: "none",
    color: {
      default: tokens.mutedForeground,
      ":is(:enabled:hover:not([data-active]))": tokens.accentForeground,
      ":is([data-active])": tokens.primary,
    },
    backgroundColor: {
      default: "transparent",
      ":is(:enabled:hover:not([data-active]))": tokens.accent,
      ":is([data-active])": `color-mix(in oklab, ${tokens.primary} 15%, transparent)`,
      ":is([data-active]:hover)": `color-mix(in oklab, ${tokens.primary} 20%, transparent)`,
    },
    opacity: { default: null, ":disabled": 0.4 },
  },
  /** small text input used across the popover panels */
  field: {
    boxSizing: "border-box",
    height: "1.75rem",
    width: "100%",
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.border, ":focus-visible": tokens.ring },
    backgroundColor: tokens.background,
    paddingInline: "0.5rem",
    fontSize: 13,
    color: tokens.foreground,
    outline: "none",
    "::placeholder": {
      opacity: 1,
      color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    },
  },
  /** Base UI Switch skin; size overrides compose after it */
  switchRoot: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    height: "1.25rem",
    width: "2rem",
    flexShrink: 0,
    cursor: "pointer",
    borderRadius: 9999,
    padding: "0.125rem",
    backgroundColor: {
      default: tokens.border,
      ":is([data-checked])": tokens.primary,
    },
    transition: {
      default: `background-color 150ms ${consts.ease}`,
      [consts.reduceMotion]: "none",
    },
    outline: "none",
    boxShadow: { default: null, ":focus-visible": consts.focusRing },
  },
  switchThumb: {
    aspectRatio: "1",
    height: "100%",
    borderRadius: 9999,
    backgroundColor: tokens.background,
    boxShadow: consts.shadowSm,
    transition: { default: `translate 150ms ${consts.ease}`, [consts.reduceMotion]: "none" },
    translate: { default: null, ":is([data-checked])": "0.75rem" },
  },
  /** dropdown trigger that looks like plain text until hovered */
  ghostSelect: {
    boxSizing: "border-box",
    display: "inline-flex",
    height: "1.75rem",
    minWidth: 118,
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.375rem",
    borderRadius: "0.5rem",
    paddingInline: "0.5rem",
    fontSize: 13,
    color: tokens.foreground,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.accent,
      ":is([data-popup-open])": tokens.accent,
    },
    pointerEvents: { default: null, ":is([data-disabled])": "none" },
    opacity: { default: null, ":is([data-disabled])": 0.4 },
  },
  /** thin vertical rule between toolbar groups */
  divider: {
    marginInline: "0.125rem",
    height: "1rem",
    width: 1,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
});
