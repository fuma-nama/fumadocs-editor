/*
 * Shared Tailwind class strings for the Base UI popup surfaces (Select, etc.).
 * These live in one place because the toolbar, the props panel and the callout
 * type picker all portal to <body> and must be fully self-styled.
 */

/**
 * Keyboard focus ring, applied to every interactive control so tabbing through
 * the editor is legible. `focus-visible` (not `focus`) keeps it off mouse
 * clicks; the offset lets it read clearly against toolbars and popovers alike.
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background";

/* No entrance animation: popups are on the writing hot path (slash menu,
 * turn-into) and must feel immediate. */
export const popupCls =
  "z-50 min-w-40 rounded-[10px] border border-fd-border bg-fd-popover p-1 text-[13px] text-fd-popover-foreground shadow-lg [scrollbar-color:var(--color-fd-border)_transparent] [scrollbar-width:thin]";

/* hover/highlight react instantly: a fade would lag menu scrubbing */
export const itemCls =
  "flex cursor-default items-center gap-2 rounded-md py-[5px] pr-2 pl-1.5 select-none text-fd-popover-foreground hover:bg-fd-accent hover:text-fd-accent-foreground data-[highlighted]:bg-fd-accent data-[highlighted]:text-fd-accent-foreground";

export const itemIndicatorCls = "inline-flex w-4 shrink-0 text-fd-foreground";

/** icon toolbar button: pointer chrome, never part of the tab order.
 * Hover and the toggled state are visibly different: hover is the accent
 * wash, a toggled mark is a solid primary tint. */
export const iconButtonCls =
  "inline-flex size-7 items-center justify-center rounded-lg text-fd-muted-foreground outline-none enabled:hover:bg-fd-accent enabled:hover:text-fd-accent-foreground data-[active]:bg-fd-primary/15 data-[active]:text-fd-primary data-[active]:hover:bg-fd-primary/20 disabled:cursor-default disabled:opacity-40";

/** dropdown trigger that looks like plain text until hovered */
export const ghostSelectCls =
  "inline-flex h-7 min-w-[118px] cursor-pointer items-center justify-between gap-1.5 rounded-lg px-2 text-[13px] text-fd-foreground outline-none hover:bg-fd-accent data-[popup-open]:bg-fd-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
