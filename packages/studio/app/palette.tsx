import { useRef, useState, type RefObject } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Check, Search, type LucideIcon } from "lucide-react";

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

/** every whitespace-separated word of the query appears in the label or detail */
function matches(item: PaletteItem, query: string): boolean {
  const text = `${item.label} ${item.detail ?? ""}`.toLowerCase();
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (word && !text.includes(word)) return false;
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
        <Dialog.Backdrop className="palette-backdrop" />
        <Dialog.Viewport className="palette-viewport">
          <Dialog.Popup className="palette" aria-label="Search files and actions">
            <Autocomplete.Root
              open
              inline
              items={page ? [{ label: page.label, items: page.items ?? [] }] : groups}
              value={query}
              onValueChange={setQuery}
              autoHighlight="always"
              keepHighlight
              filter={matches}
              itemToStringValue={(item: PaletteItem) => item.label}
            >
              <Autocomplete.InputGroup className="palette-search">
                <Search size={16} aria-hidden />
                {page && (
                  <button type="button" className="palette-crumb" title="Back" onClick={back}>
                    {page.label}
                  </button>
                )}
                <Autocomplete.Input
                  ref={inputRef}
                  className="palette-input"
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
              <Dialog.Close className="sr-only">Close</Dialog.Close>
              <ScrollArea.Root className="palette-scroll">
                <ScrollArea.Viewport className="palette-scroll-viewport">
                  <ScrollArea.Content>
                    <Autocomplete.Empty className="palette-empty">No results</Autocomplete.Empty>
                    <Autocomplete.List className="palette-list">
                      {(group: PaletteGroup) => (
                        <Autocomplete.Group
                          key={group.label}
                          items={group.items}
                          className="palette-group"
                        >
                          <Autocomplete.GroupLabel className="palette-group-label">
                            {group.label}
                          </Autocomplete.GroupLabel>
                          <Autocomplete.Collection>
                            {(item: PaletteItem) => (
                              <Autocomplete.Item
                                key={item.id}
                                value={item}
                                className="palette-item"
                                onClick={() => {
                                  if (item.items) return enter(item);
                                  onOpenChange(false);
                                  item.run?.();
                                }}
                              >
                                <item.icon size={16} aria-hidden className="palette-item-icon" />
                                <span className="palette-item-label">{item.label}</span>
                                {item.detail && (
                                  <span className="palette-item-detail">{item.detail}</span>
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
                <ScrollArea.Scrollbar className="palette-scrollbar">
                  <ScrollArea.Thumb className="palette-thumb" />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
              <div className="palette-footer" aria-hidden>
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> Navigate
                </span>
                <span>
                  <kbd>↵</kbd> {page ? "Choose" : "Open"}
                </span>
                {page ? (
                  <span>
                    <kbd>⌫</kbd> Back
                  </span>
                ) : (
                  <span>
                    <kbd>Esc</kbd> Close
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
