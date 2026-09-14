import * as stylex from "@stylexjs/stylex";

const REDUCE = "@media (prefers-reduced-motion: reduce)";
const border = "var(--fde-border)";

/** what every floating surface and control of the shell shares */
export const chrome = stylex.create({
  surface: {
    boxSizing: "border-box",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: "var(--fde-popover)",
    color: "var(--fde-popover-foreground)",
    outline: "none",
  },
  backdrop: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 60,
    backgroundColor: "rgb(0 0 0 / 0.3)",
    opacity: { default: 1, ":is([data-starting-style], [data-ending-style])": 0 },
    transitionProperty: "opacity",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  key: {
    display: "inline-flex",
    minWidth: "1.125rem",
    height: "1.125rem",
    alignItems: "center",
    justifyContent: "center",
    marginInlineEnd: "0.25rem",
    padding: "0 0.25rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    borderRadius: "0.25rem",
    backgroundColor: "var(--fde-muted)",
    fontFamily: "inherit",
    fontSize: 10.5,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
