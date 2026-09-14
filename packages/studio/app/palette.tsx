import { useRef, useState, type RefObject } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Check, Search, type LucideIcon } from "lucide-react";
import * as stylex from "@stylexjs/stylex";
import { chrome } from "./chrome";
import { entry } from "./markers.stylex";

const COARSE = "@media (pointer: coarse)";
const REDUCE = "@media (prefers-reduced-motion: reduce)";
const muted = "var(--fde-muted-foreground)";
const border = "var(--fde-border)";
const ending = ":is([data-starting-style], [data-ending-style])";

const styles = stylex.create({
  viewport: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 61,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "min(12vh, 6rem) 1rem 1rem",
    overflow: "hidden",
  },
  palette: {
    display: "flex",
    width: "100%",
    maxWidth: "36rem",
    maxHeight: "min(30rem, 78vh)",
    flexDirection: "column",
    borderRadius: "0.875rem",
    boxShadow: "0 24px 48px -12px rgb(0 0 0 / 0.35)",
    overflow: "hidden",
    opacity: { default: 1, [ending]: 0 },
    translate: { default: "0 0", [ending]: "0 -0.5rem" },
    transitionProperty: "opacity, translate",
    transitionDuration: { default: "120ms", [REDUCE]: "0s" },
    transitionTimingFunction: "ease-out",
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
    padding: "0 1rem",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: border,
    color: muted,
  },
  input: {
    boxSizing: "border-box",
    width: "100%",
    height: "3rem",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "var(--fde-foreground)",
    fontFamily: "inherit",
    fontSize: "max(14px, var(--fde-field-size))",
    outline: "none",
    "::placeholder": { color: muted, opacity: 0.7 },
  },
  crumb: {
    flexShrink: 0,
    padding: "0.125rem 0.5rem",
    borderWidth: 0,
    borderRadius: "0.375rem",
    backgroundColor: "var(--fde-muted)",
    color: "var(--fde-foreground)",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  scroll: {
    position: "relative",
    display: "flex",
    minHeight: 0,
    flex: "0 1 auto",
    overflow: "hidden",
  },
  scrollViewport: {
    minHeight: 0,
    flexGrow: 1,
    overscrollBehavior: "contain",
    scrollPaddingBlock: "0.375rem",
    outline: "none",
  },
  list: { padding: "0.375rem" },
  // rendered even while items match, then without children
  empty: {
    display: { default: "block", ":empty": "none" },
    padding: "1.75rem 1rem",
    color: muted,
    fontSize: 13,
    textAlign: "center",
  },
  group: {
    marginTop: { default: "0.375rem", ":first-child": 0 },
    paddingTop: { default: "0.375rem", ":first-child": 0 },
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: border,
  },
  groupLabel: {
    padding: "0.375rem 0.75rem 0.25rem",
    color: muted,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  item: {
    display: "flex",
    minHeight: "2.25rem",
    alignItems: "center",
    gap: "0.625rem",
    padding: "0 0.75rem",
    borderRadius: "0.5rem",
    backgroundColor: { default: "transparent", ":is([data-highlighted])": "var(--fde-accent)" },
    color: { default: null, ":is([data-highlighted])": "var(--fde-accent-foreground)" },
    fontSize: 13.5,
    cursor: "default",
    userSelect: "none",
    scrollMarginBlock: "0.375rem",
  },
  itemIcon: {
    flexShrink: 0,
    color: { default: muted, [stylex.when.ancestor("[data-highlighted]", entry)]: "inherit" },
  },
  itemLabel: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemDetail: {
    maxWidth: "40%",
    flexShrink: 0,
    overflow: "hidden",
    color: muted,
    fontSize: 12,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  scrollbar: {
    display: "flex",
    width: "0.625rem",
    justifyContent: "center",
    paddingBlock: "0.375rem",
    opacity: { default: 0, ":is([data-hovering], [data-scrolling])": 1 },
    pointerEvents: { default: "none", ":is([data-hovering], [data-scrolling])": "auto" },
    transitionProperty: "opacity",
    transitionDuration: { default: "150ms", ":is([data-scrolling])": "0ms" },
  },
  thumb: {
    width: "0.25rem",
    borderRadius: 9999,
    backgroundColor: "color-mix(in oklab, var(--fde-foreground) 25%, transparent)",
  },
  footer: {
    display: { default: "flex", [COARSE]: "none" },
    gap: "1rem",
    padding: "0.5rem 0.875rem",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: border,
    color: muted,
    fontSize: 11.5,
  },
});

export interface PaletteItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** secondary text at the end of the row, searched too, e.g. a file path */
  detail?: string;
  /** the option in force, e.g. the current theme */
  checked?: boolean;
  /** a second level to choose from instead of running */
  items?: PaletteItem[];
  run?: () => void;
}

export interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
  /** portal target inside the themed root, so the tokens resolve */
  container: RefObject<HTMLElement | null>;
}

const Key = ({ children }: { children: string }) => (
  <kbd {...stylex.props(chrome.key)}>{children}</kbd>
);

/** every word of the query appears in the label or detail */
function matches(item: PaletteItem, words: string[]): boolean {
  const text = `${item.label} ${item.detail ?? ""}`.toLowerCase();
  for (const word of words) {
    if (!text.includes(word)) return false;
  }
  return true;
}

/**
 * ⌘K: files and actions in one list, Enter runs the highlighted row. An
 * item with `items` opens a second level; Backspace on an empty query,
 * Escape or the crumb go back.
 */
export function Palette({ open, onOpenChange, groups, container }: PaletteProps) {
  const [page, setPage] = useState<PaletteItem | null>(null);
  const [query, setQuery] = useState("");
  const words: string[] = [];
  for (const word of query.toLowerCase().split(/\s+/)) if (word) words.push(word);
  const inputRef = useRef<HTMLInputElement>(null);

  const enter = (item: PaletteItem) => {
    setPage(item);
    setQuery("");
  };
  const back = () => {
    setPage(null);
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && page && details.reason === "escape-key") {
          details.cancel();
          back();
          return;
        }
        onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => {
        // the level fades out with the dialog and only then resets
        if (!next) back();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Backdrop {...stylex.props(chrome.backdrop)} />
        <Dialog.Viewport {...stylex.props(styles.viewport)}>
          <Dialog.Popup
            {...stylex.props(chrome.surface, styles.palette)}
            aria-label="Search files and actions"
          >
            <Autocomplete.Root
              open
              inline
              items={page ? [{ label: page.label, items: page.items ?? [] }] : groups}
              value={query}
              onValueChange={setQuery}
              autoHighlight="always"
              keepHighlight
              filter={(item) => matches(item, words)}
              itemToStringValue={(item: PaletteItem) => item.label}
            >
              <Autocomplete.InputGroup {...stylex.props(styles.search)}>
                <Search size={16} aria-hidden />
                {page && (
                  <button type="button" {...stylex.props(styles.crumb)} title="Back" onClick={back}>
                    {page.label}
                  </button>
                )}
                <Autocomplete.Input
                  ref={inputRef}
                  {...stylex.props(styles.input)}
                  placeholder={page ? "Choose…" : "Search files and actions…"}
                  aria-label="Search files and actions"
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && page && query === "") {
                      event.preventDefault();
                      back();
                    }
                  }}
                />
              </Autocomplete.InputGroup>
              <Dialog.Close {...stylex.props(chrome.srOnly)}>Close</Dialog.Close>
              <ScrollArea.Root {...stylex.props(styles.scroll)}>
                <ScrollArea.Viewport {...stylex.props(styles.scrollViewport)}>
                  <ScrollArea.Content>
                    <Autocomplete.Empty {...stylex.props(styles.empty)}>
                      No results
                    </Autocomplete.Empty>
                    <Autocomplete.List {...stylex.props(styles.list)}>
                      {(group: PaletteGroup) => (
                        <Autocomplete.Group
                          key={group.label}
                          items={group.items}
                          {...stylex.props(styles.group)}
                        >
                          <Autocomplete.GroupLabel {...stylex.props(styles.groupLabel)}>
                            {group.label}
                          </Autocomplete.GroupLabel>
                          <Autocomplete.Collection>
                            {(item: PaletteItem) => (
                              <Autocomplete.Item
                                key={item.id}
                                value={item}
                                {...stylex.props(styles.item, entry)}
                                onClick={() => {
                                  if (item.items) return enter(item);
                                  onOpenChange(false);
                                  item.run?.();
                                }}
                              >
                                <item.icon
                                  size={16}
                                  aria-hidden
                                  {...stylex.props(styles.itemIcon)}
                                />
                                <span {...stylex.props(styles.itemLabel)}>{item.label}</span>
                                {item.detail && (
                                  <span {...stylex.props(styles.itemDetail)}>{item.detail}</span>
                                )}
                                {item.checked && <Check size={14} aria-hidden />}
                              </Autocomplete.Item>
                            )}
                          </Autocomplete.Collection>
                        </Autocomplete.Group>
                      )}
                    </Autocomplete.List>
                  </ScrollArea.Content>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar {...stylex.props(styles.scrollbar)}>
                  <ScrollArea.Thumb {...stylex.props(styles.thumb)} />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
              <div {...stylex.props(styles.footer)} aria-hidden>
                <span>
                  <Key>↑</Key>
                  <Key>↓</Key> Navigate
                </span>
                <span>
                  <Key>↵</Key> {page ? "Choose" : "Open"}
                </span>
                {page ? (
                  <span>
                    <Key>⌫</Key> Back
                  </span>
                ) : (
                  <span>
                    <Key>Esc</Key> Close
                  </span>
                )}
              </div>
            </Autocomplete.Root>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
