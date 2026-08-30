"use client";
import { Combobox } from "@base-ui/react/combobox";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { itemCls, itemIndicatorCls, popupCls } from "./styles";
import { useEditorPortal } from "../utils/portal";

export interface PickerItem {
  value: string;
  label: string;
}

/**
 * Select-like combobox for long lists (block types, code languages): a plain
 * trigger button, and a popup that filters as you type. Base UI matches the
 * item `label` and drives highlight/keyboard on the input, so the list stays
 * a list of dumb rows.
 */
export function Picker<T extends PickerItem>({
  items,
  value,
  onPick,
  open,
  onOpenChange,
  align = "start",
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
  ariaLabel?: string;
  triggerCls: string;
  triggerTabIndex?: number;
  /** overrides the default `[data-fde-root]` portal (the bubble menu portals
   * into the editor wrapper so its blur handling keeps working) */
  container?: HTMLElement;
  /** trigger content */
  children: ReactNode;
  /** leading cell rendered before an item's label (icons) */
  lead?: (item: T) => ReactNode;
  /** pinned below the list; unaffected by filtering */
  footer?: ReactNode;
}) {
  const portal = useEditorPortal();
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
        <Combobox.Positioner sideOffset={6} align={align} className="z-50">
          <Combobox.Popup className={`${popupCls} w-52 overflow-hidden p-0`}>
            <Combobox.Input
              placeholder="Filter…"
              className="h-8 w-full border-b border-fd-border bg-transparent px-2.5 text-[13px] text-fd-foreground outline-none placeholder:text-fd-muted-foreground/60"
            />
            <Combobox.Empty className="px-2.5 py-2 text-[12.5px] text-fd-muted-foreground">
              No matches
            </Combobox.Empty>
            <Combobox.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
              {(item: T) => (
                <Combobox.Item key={item.value} value={item} className={itemCls}>
                  {lead?.(item)}
                  {item.label}
                  <Combobox.ItemIndicator className={itemIndicatorCls}>
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
