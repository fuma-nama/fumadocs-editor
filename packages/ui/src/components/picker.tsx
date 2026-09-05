"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import { Combobox } from "@base-ui/react/combobox";
import { Check } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { chrome } from "../styles/shared";
import { useEditorPortal } from "../utils/portal";

export interface PickerItem {
  value: string;
  label: string;
}

const styles = stylex.create({
  popup: { width: "13rem", overflow: "hidden", padding: 0 },
  input: {
    height: "2rem",
    width: "100%",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    backgroundColor: "transparent",
    paddingInline: "0.75rem",
    fontSize: tokens.fieldSize,
    color: tokens.foreground,
    outline: "none",
    "::placeholder": {
      color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    },
  },
  /* Empty stays mounted while there are matches, so it must collapse or it
   * reads as padding */
  empty: {
    display: { default: "block", ":empty": "none" },
    paddingInline: "0.75rem",
    paddingBlock: "0.5rem",
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  list: {
    boxSizing: "border-box",
    maxHeight: "20rem",
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "0.25rem",
  },
});

export function Picker<T extends PickerItem>({
  items,
  value,
  onPick,
  open,
  onOpenChange,
  align = "start",
  side,
  ariaLabel,
  triggerCls,
  triggerTabIndex,
  container,
  children,
  lead,
  footer,
}: {
  items: readonly T[];
  value: T | undefined;
  onPick: (item: T) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "end";
  side?: "top" | "bottom";
  ariaLabel?: string;
  triggerCls: string;
  triggerTabIndex?: number;
  container?: HTMLElement;
  children: ReactNode;
  lead?: (item: T) => ReactNode;
  footer?: ReactNode;
}) {
  const portal = useEditorPortal();
  const touch = useRef(false);
  return (
    <Combobox.Root
      items={items as T[]}
      value={value ?? null}
      onValueChange={(item) => {
        if (item) onPick(item);
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Combobox.Trigger
        ref={portal.anchorRef}
        aria-label={ariaLabel}
        tabIndex={triggerTabIndex}
        className={triggerCls}
      >
        {children}
      </Combobox.Trigger>
      <Combobox.Portal container={container ?? portal.container}>
        <Combobox.Positioner
          positionMethod="fixed"
          side={side}
          sideOffset={6}
          align={align}
          {...stylex.props(chrome.layer)}
        >
          <Combobox.Popup {...stylex.props(chrome.popup, styles.popup)}>
            <Combobox.Input placeholder="Filter…" {...stylex.props(chrome.input, styles.input)} />
            <Combobox.Empty {...stylex.props(styles.empty)}>No matches</Combobox.Empty>
            <Combobox.List {...stylex.props(styles.list)}>
              {(item: T) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  {...stylex.props(chrome.item)}
                  // Base UI cancels every pointerdown to keep the input
                  // focused; WebKit then never synthesizes the click a touch
                  // tap commits with, and no item can be picked on iOS. A tap
                  // closes the popup anyway, so let touch pointers through,
                  // and keep the click as the one commit: without its
                  // pointerdown bookkeeping Base UI would also commit on the
                  // compatibility mouseup.
                  onPointerDownCapture={(event) => {
                    touch.current = event.pointerType === "touch";
                    if (touch.current) event.preventBaseUIHandler();
                  }}
                  onMouseUp={(event) => {
                    if (touch.current) event.preventBaseUIHandler();
                  }}
                >
                  {lead?.(item)}
                  {item.label}
                  <Combobox.ItemIndicator {...stylex.props(chrome.itemIndicator)}>
                    <Check size={14} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
            {footer}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
