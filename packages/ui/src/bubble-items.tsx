"use client";
import * as stylex from "@stylexjs/stylex";
import type { Editor } from "@tiptap/core";
import type { ReactNode } from "react";
import { chrome } from "./styles/shared";

/** a host button in the format bubble, after the built-in ones */
export interface BubbleItem {
  /** the button's accessible name and tooltip */
  label: string;
  icon: ReactNode;
  /** shown in the tooltip, in TipTap's notation (`Mod-j`); bind it in an extension */
  shortcut?: string;
  /** drawn pressed, like Bold over bold text */
  isActive?: (editor: Editor) => boolean;
  /** default: enabled */
  isEnabled?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

export interface BubbleItemState {
  active: boolean;
  enabled: boolean;
}

/** read in the bubble's editor-state selector, so the buttons follow the selection */
export function bubbleItemStates(items: BubbleItem[], editor: Editor): BubbleItemState[] {
  return items.map((item) => ({
    active: item.isActive?.(editor) ?? false,
    enabled: item.isEnabled?.(editor) ?? true,
  }));
}

const mac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** `Mod-Shift-j` → `⌘⇧J` on Apple platforms, `Ctrl+Shift+J` elsewhere */
export function formatShortcut(shortcut: string): string {
  const apple = mac();
  const names: Record<string, [string, string]> = {
    mod: ["⌘", "Ctrl"],
    meta: ["⌘", "Meta"],
    ctrl: ["⌃", "Ctrl"],
    control: ["⌃", "Ctrl"],
    alt: ["⌥", "Alt"],
    shift: ["⇧", "Shift"],
  };
  const parts = shortcut.split(/-(?!$)/).map((part) => {
    const name = names[part.toLowerCase()];
    if (name) return apple ? name[0] : name[1];
    return part.length === 1 ? part.toUpperCase() : part;
  });
  return parts.join(apple ? "" : "+");
}

export function BubbleItems({
  editor,
  items,
  states,
}: {
  editor: Editor;
  items: BubbleItem[];
  states: BubbleItemState[];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <span {...stylex.props(chrome.divider)} />
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          data-fde-bubble-item=""
          aria-label={item.label}
          title={item.shortcut ? `${item.label} (${formatShortcut(item.shortcut)})` : item.label}
          {...stylex.props(chrome.button, chrome.iconButton)}
          data-active={states[i]?.active || undefined}
          disabled={states[i]?.enabled === false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => item.run(editor)}
        >
          {item.icon}
        </button>
      ))}
    </>
  );
}
