import * as stylex from "@stylexjs/stylex";

/*
 * Compile-time constants shared across modules. StyleX inlines them into
 * `stylex.create` calls in any file (a plain exported string cannot cross
 * module boundaries there).
 */
export const consts = stylex.defineConsts({
  focusRing:
    "0 0 0 2px var(--fde-background), 0 0 0 4px color-mix(in oklab, var(--fde-ring) 70%, transparent)",
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
  shadowSm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  shadowMd: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  shadowLg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  mono: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
  reduceMotion: "@media (prefers-reduced-motion: reduce)",
});
