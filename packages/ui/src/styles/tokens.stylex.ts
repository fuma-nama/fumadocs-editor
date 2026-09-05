import * as stylex from "@stylexjs/stylex";

/* The values live in base.css (`:root`, `.light`, `.dark`). */
export const tokens = stylex.defineConsts({
  background: "var(--fde-background)",
  foreground: "var(--fde-foreground)",
  muted: "var(--fde-muted)",
  mutedForeground: "var(--fde-muted-foreground)",
  popover: "var(--fde-popover)",
  popoverForeground: "var(--fde-popover-foreground)",
  card: "var(--fde-card)",
  cardForeground: "var(--fde-card-foreground)",
  border: "var(--fde-border)",
  primary: "var(--fde-primary)",
  primaryForeground: "var(--fde-primary-foreground)",
  secondary: "var(--fde-secondary)",
  secondaryForeground: "var(--fde-secondary-foreground)",
  accent: "var(--fde-accent)",
  accentForeground: "var(--fde-accent-foreground)",
  ring: "var(--fde-ring)",
  info: "var(--fde-info)",
  warning: "var(--fde-warning)",
  error: "var(--fde-error)",
  success: "var(--fde-success)",
  idea: "var(--fde-idea)",
  fontSize: "var(--fde-font-size)",
  fieldSize: "var(--fde-field-size)",
});
