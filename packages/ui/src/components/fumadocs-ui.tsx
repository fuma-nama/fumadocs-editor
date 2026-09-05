"use client";
import {
  Check,
  ChevronRight,
  CircleCheck,
  CircleX,
  File as FileIcon,
  FileInput,
  Folder as FolderIcon,
  FolderTree,
  GitBranch,
  Info,
  Lightbulb,
  LayoutGrid,
  Link as LinkIcon,
  ListOrdered,
  PanelTop,
  Plus,
  Rows3,
  SquareStack,
  Table2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Select } from "@base-ui/react/select";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import { consts } from "../styles/consts.stylex";
import type { CSSProperties, ReactNode } from "react";
import { chrome } from "../styles/shared";
import {
  accordion as accordionMarker,
  folder as folderMarker,
  row,
} from "../styles/markers.stylex";
import { useEditorPortal } from "../utils/portal";
import type { ComponentRenderProps, UiComponentSpec } from "./spec";

/*
 * The editor never renders through fumadocs-ui: those components own state
 * and interactivity (tabs, collapse, navigation) that conflict with
 * always-editable regions. These are mirrors, deliberately.
 */

const muted = tokens.mutedForeground;
const border = tokens.border;
const card = tokens.card;
const barTint = "color-mix(in oklab, var(--callout-color) 50%, transparent)";
const COARSE = "@media (pointer: coarse)";
const calloutWash = "color-mix(in oklab, var(--callout-color) 15%, transparent)";

const styles = stylex.create({
  callout: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: card,
    padding: "0.75rem",
    paddingInlineStart: "0.25rem",
    fontSize: "0.925em",
    color: tokens.cardForeground,
    boxShadow: consts.shadowMd,
  },
  calloutBar: {
    width: "0.125rem",
    alignSelf: "stretch",
    borderRadius: "0.25rem",
    backgroundColor: barTint,
  },
  contents: { display: "contents" },
  calloutTrigger: {
    marginInline: "-0.125rem",
    marginTop: 1,
    display: "inline-flex",
    flexShrink: 0,
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    padding: "0.125rem",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": calloutWash,
      ":is([data-popup-open])": calloutWash,
    },
  },
  calloutTriggerIdea: { color: "var(--callout-color)" },
  calloutTriggerPlain: { color: card },
  calloutIcon: { fill: "var(--callout-color)" },
  calloutTitle: { fontWeight: 500, lineHeight: 1.4 },
  calloutBody: { marginTop: 6, color: muted },
  body: { minWidth: 0, flex: 1 },

  slot: {
    position: "absolute",
    display: { default: "none", [COARSE]: "block" },
    width: 28,
    height: 28,
    pointerEvents: "none",
  },
  slotCorner: { top: "0.5rem", insetInlineEnd: "0.5rem" },
  slotRow: { top: 1, insetInlineEnd: 2 },
  slotStep: { top: 0, insetInlineEnd: 0 },
  slotTab: { top: 4, insetInlineEnd: 6 },
  clearSlot: { paddingInlineEnd: { default: null, [COARSE]: "3.75rem" } },

  card: {
    position: "relative",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: card,
    padding: "1rem",
    color: tokens.cardForeground,
    transition: {
      default: `color 150ms ${consts.ease}, background-color 150ms ${consts.ease}`,
      [consts.reduceMotion]: "none",
    },
  },
  cardLink: {
    backgroundColor: {
      default: card,
      ":hover": `color-mix(in oklab, ${tokens.accent} 80%, transparent)`,
    },
  },
  cardTitle: {
    fontSize: "0.95em",
    fontWeight: 500,
    paddingInlineEnd: { default: null, [COARSE]: "3.75rem" },
  },
  cardBody: { marginTop: 6, fontSize: "0.9em", color: muted },
  cards: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 560px)": "repeat(1, minmax(0, 1fr))",
    },
    gap: "0.75rem",
    "--fde-gap": "0px",
  },

  steps: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
    counterReset: "step",
    marginInlineStart: { default: "0.5rem", "@media (min-width: 640px)": "1rem" },
    "--fde-steps-gutter": { default: "1.5rem", "@media (min-width: 640px)": "1.75rem" },
    paddingInlineStart: "var(--fde-steps-gutter)",
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: border,
    "--fde-gap": "0px",
  },
  step: {
    position: "relative",
    "::before": {
      content: "counter(step)",
      counterIncrement: "step",
      position: "absolute",
      top: 0,
      insetInlineStart: "calc(-1 * (var(--fde-steps-gutter) + 1px + 1rem))",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "2rem",
      height: "2rem",
      borderRadius: 9999,
      backgroundColor: tokens.secondary,
      color: tokens.secondaryForeground,
      fontSize: "0.875rem",
      lineHeight: "1.25rem",
    },
  },

  accordions: {
    overflow: "hidden",
    borderRadius: "0.5rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: card,
    "--fde-gap": "0px",
  },
  accordion: {
    position: "relative",
    paddingInlineStart: "2.25rem",
    boxShadow: `0 -1px 0 0 ${border}`,
  },
  accordionChevron: {
    position: "absolute",
    insetInlineStart: "0.75rem",
    top: "0.6rem",
    display: "inline-flex",
    cursor: "pointer",
    borderRadius: "0.25rem",
    color: muted,
    outline: "none",
    transform: {
      default: "rotate(0deg)",
      [stylex.when.ancestor("[data-open]", accordionMarker)]: "rotate(90deg)",
    },
    transition: { default: "transform 200ms", [consts.reduceMotion]: "none" },
  },
  accordionAnchor: {
    position: "absolute",
    insetInlineEnd: "0.75rem",
    top: "0.75rem",
    display: { default: "inline-flex", [COARSE]: "none" },
    color: muted,
  },
  accordionTitle: {
    fontWeight: 500,
    paddingBlock: "0.625rem",
    paddingInlineStart: 0,
    paddingInlineEnd: { default: "2.5rem", [COARSE]: "4.25rem" },
    "--fde-ph-y": "0.625rem",
  },
  accordionBody: {
    display: {
      default: null,
      [stylex.when.ancestor(":not([data-open])", accordionMarker)]: "none",
    },
    padding: "0 1rem 0.75rem 0",
    fontSize: "0.9375rem",
    color: muted,
  },

  files: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: card,
    padding: "0.5rem",
    fontSize: "0.9em",
    color: tokens.cardForeground,
    "--fde-gap": "0px",
  },
  entry: { position: "relative" },
  folder: { display: "flex", flexDirection: "column", gap: 2, "--fde-gap": "0px" },
  entryIcon: {
    position: "absolute",
    insetInlineStart: "0.5rem",
    top: "0.5rem",
    zIndex: 1,
    display: "inline-flex",
    color: muted,
  },
  entryName: {
    paddingBlock: "0.3rem",
    paddingInlineStart: "1.875rem",
    paddingInlineEnd: { default: "0.5rem", [COARSE]: "4rem" },
    borderRadius: "0.375rem",
    "--fde-ph-x": "1.875rem",
    "--fde-ph-y": "0.3rem",
  },

  tabs: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: tokens.secondary,
    padding: "0 6px 6px",
    "--fde-gap": "0px",
  },
  tab: { position: "relative" },
  tabLabel: {
    boxSizing: "border-box",
    // a block, not inline: no line box beside it for a caret to rest in
    display: "block",
    width: "fit-content",
    marginTop: 8,
    marginBottom: 0,
    marginInlineStart: 10,
    marginInlineEnd: { default: 10, [COARSE]: "4rem" },
    // room for a caret while the label is still empty
    minWidth: { default: null, ":is([data-empty])": "4ch" },
    paddingBottom: 5,
    fontSize: "0.875em",
    fontWeight: 500,
    color: tokens.primary,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.primary,
  },
  tabBody: {
    backgroundColor: tokens.background,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    padding: "12px 16px",
    "--fde-ph-x": "16px",
    "--fde-ph-y": "12px",
  },

  include: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: border,
    backgroundColor: card,
    paddingInline: "0.75rem",
    paddingBlock: "0.5rem",
    fontSize: "0.9em",
  },
  includeLead: { display: "flex", flexShrink: 0, alignItems: "center", gap: "0.5rem" },
  includeTag: {
    fontFamily: consts.mono,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.025em",
    color: muted,
  },
  includeLang: {
    flexShrink: 0,
    borderRadius: "0.375rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: tokens.muted,
    paddingInline: "0.375rem",
    paddingBlock: "0.125rem",
    fontFamily: consts.mono,
    fontSize: 11,
    color: muted,
  },
  includePath: { fontFamily: consts.mono, fontSize: "0.875em" },

  infoCard: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: card,
    padding: "0.75rem",
    fontSize: 14,
    lineHeight: "1.25rem",
  },
  shrink: { flexShrink: 0 },
  infoIcon: { flexShrink: 0, color: muted },
  infoTitle: { margin: 0, fontWeight: 500 },
  infoNote: { margin: 0, fontSize: 12, color: muted },
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  minWidth0: { minWidth: 0 },

  typeTable: {
    overflowX: "auto",
    borderRadius: "0.75rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: border,
    backgroundColor: card,
    fontSize: tokens.fieldSize,
  },
  table: { margin: 0, width: "100%", borderCollapse: "collapse" },
  head: {
    boxSizing: "border-box",
    paddingInline: "0.75rem",
    paddingBlock: "0.5rem",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 500,
    color: muted,
  },
  narrow: { width: 0 },
  cell: {
    boxSizing: "border-box",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: border,
    paddingInline: "0.75rem",
    paddingBlock: "0.375rem",
    backgroundColor: {
      default: null,
      ":has(:focus)": `color-mix(in oklab, ${tokens.accent} 40%, transparent)`,
    },
  },
  cellInput: { paddingInline: 0, paddingBlock: 0 },
  cellName: { width: "18%", minWidth: "7rem" },
  cellType: { width: "22%", minWidth: "8rem" },
  cellDefault: { width: "15%", minWidth: "5rem" },
  cellRemove: { paddingRight: "0.5rem", paddingLeft: 0 },
  input: {
    boxSizing: "border-box",
    width: "100%",
    paddingInline: "0.75rem",
    paddingBlock: { default: "0.375rem", [COARSE]: "0.625rem" },
    outline: "none",
    "::placeholder": {
      color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    },
  },
  monoSmall: { fontFamily: consts.mono },
  checkbox: {
    marginInline: "auto",
    display: "flex",
    width: "1rem",
    height: "1rem",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.25rem",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: border, ":is([data-checked])": tokens.primary },
    backgroundColor: {
      default: tokens.background,
      ":is([data-checked])": tokens.primary,
    },
    color: tokens.primaryForeground,
  },
  flex: { display: "flex" },
  removeButton: {
    display: "inline-flex",
    width: "1.25rem",
    height: "1.25rem",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.25rem",
    visibility: { default: "hidden", [stylex.when.ancestor(":hover", row)]: "visible" },
    color: { default: muted, ":hover": tokens.error },
    backgroundColor: { default: "transparent", ":hover": tokens.accent },
  },
  addButton: {
    display: "flex",
    width: "100%",
    cursor: "pointer",
    alignItems: "center",
    gap: "0.375rem",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: border,
    paddingInline: "0.75rem",
    paddingBlock: "0.375rem",
    fontSize: 12,
    color: { default: muted, ":hover": tokens.foreground },
    backgroundColor: { default: "transparent", ":hover": tokens.accent },
  },
});

const regionClass = (style: stylex.StyleXStyles) => stylex.props(style).className!;

const CALLOUT_ICONS: Record<string, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  error: CircleX,
  success: CircleCheck,
  idea: Lightbulb,
};

export interface CalloutTypeItem {
  value: string;
  label: string;
  visual: string;
}

const CALLOUT_TYPES: CalloutTypeItem[] = [
  { value: "info", label: "Info", visual: "info" },
  { value: "warn", label: "Warning", visual: "warning" },
  { value: "error", label: "Error", visual: "error" },
  { value: "success", label: "Success", visual: "success" },
  { value: "idea", label: "Idea", visual: "idea" },
];

const colorKey = (type: string) => (type === "warn" ? "warning" : type);

function CalloutTypeSelect({
  value,
  visual,
  items,
  onChange,
}: {
  value: string;
  visual: string;
  items: CalloutTypeItem[];
  onChange: (value: string) => void;
}) {
  const Current = CALLOUT_ICONS[visual] ?? Info;
  const isIdea = visual === "idea";
  const { anchorRef, container } = useEditorPortal();
  return (
    <Select.Root items={items} value={value} onValueChange={(next) => onChange(next as string)}>
      <Select.Trigger
        ref={anchorRef}
        aria-label="Callout type"
        tabIndex={-1}
        {...stylex.props(
          chrome.button,
          styles.calloutTrigger,
          isIdea ? styles.calloutTriggerIdea : styles.calloutTriggerPlain,
        )}
      >
        <Current size={20} strokeWidth={2} {...stylex.props(styles.calloutIcon)} />
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Positioner
          positionMethod="fixed"
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
        >
          <Select.Popup {...stylex.props(chrome.popup)}>
            {items.map((item) => {
              const Icon = CALLOUT_ICONS[item.visual] ?? Info;
              return (
                <Select.Item key={item.value} value={item.value} {...stylex.props(chrome.item)}>
                  <Icon
                    size={15}
                    {...stylex.props(styles.shrink)}
                    style={{ color: `var(--fde-${item.visual})` }}
                  />
                  <Select.ItemText>{item.label}</Select.ItemText>
                  <Select.ItemIndicator {...stylex.props(chrome.itemIndicator)}>
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function CalloutBox({
  value,
  visual,
  items,
  onChange,
  children,
}: {
  value: string;
  visual: string;
  items: CalloutTypeItem[];
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div
      {...stylex.props(styles.callout)}
      style={{ "--callout-color": `var(--fde-${visual})` } as CSSProperties}
      data-type={value}
    >
      <div
        role="none"
        {...stylex.props(chrome.static, styles.calloutBar)}
        contentEditable={false}
      />
      <span {...stylex.props(styles.contents)} contentEditable={false}>
        <CalloutTypeSelect value={value} visual={visual} items={items} onChange={onChange} />
      </span>
      <div {...stylex.props(styles.body)}>{children}</div>
    </div>
  );
}

function Callout({ props, children, setProp }: ComponentRenderProps) {
  const type = props.type ?? "info";
  return (
    <CalloutBox
      value={type}
      visual={colorKey(type)}
      items={CALLOUT_TYPES}
      onChange={(value) => setProp("type", value)}
    >
      {children}
    </CalloutBox>
  );
}

function ControlsSlot({ at }: { at: stylex.StyleXStyles }) {
  return (
    <span
      {...stylex.props(styles.slot, at)}
      data-fde-controls=""
      contentEditable={false}
      aria-hidden
    />
  );
}

function Card({ props, children }: ComponentRenderProps) {
  return (
    <div
      {...stylex.props(styles.card, Boolean(props.href) && styles.cardLink)}
      data-has-href={props.href ? "" : undefined}
    >
      <ControlsSlot at={styles.slotCorner} />
      {children}
    </div>
  );
}

function Cards({ children }: ComponentRenderProps) {
  return <div {...stylex.props(styles.cards)}>{children}</div>;
}

function Steps({ children }: ComponentRenderProps) {
  return <div {...stylex.props(styles.steps)}>{children}</div>;
}

function Step({ children }: ComponentRenderProps) {
  return (
    <div {...stylex.props(styles.step)}>
      <ControlsSlot at={styles.slotStep} />
      {children}
    </div>
  );
}

function Accordions({ children }: ComponentRenderProps) {
  return <div {...stylex.props(styles.accordions)}>{children}</div>;
}

function Files({ children }: ComponentRenderProps) {
  return <div {...stylex.props(styles.files)}>{children}</div>;
}

/**
 * File and Folder rows share one geometry; the icon is the row's chrome (a
 * double-click on it selects the row). `zIndex: 1` lifts it above the name
 * region (`position: relative`, later in DOM order), which would otherwise
 * swallow every pointer event aimed at it.
 */
function File({ children }: ComponentRenderProps) {
  return (
    <div {...stylex.props(styles.entry)}>
      <span {...stylex.props(chrome.static, styles.entryIcon)} contentEditable={false}>
        <FileIcon size={15} />
      </span>
      <ControlsSlot at={styles.slotRow} />
      {children}
    </div>
  );
}

function Folder({ children }: ComponentRenderProps) {
  return (
    <div {...stylex.props(styles.entry, styles.folder, folderMarker)} data-folder="">
      <span {...stylex.props(chrome.static, styles.entryIcon)} contentEditable={false}>
        <FolderIcon size={15} />
      </span>
      <ControlsSlot at={styles.slotRow} />
      {children}
    </div>
  );
}

function Accordion({ props, children }: ComponentRenderProps) {
  // Every item starts open so its body stays editable. The chevron is the
  // collapse toggle (not the whole header), so clicking the title still
  // places the caret. Open state is a DOM attribute toggled imperatively:
  // node-view renderers can't hold React hook state reliably.
  const anchor = props.id;
  return (
    <div {...stylex.props(styles.accordion, accordionMarker)} data-accordion="" data-open="">
      <button
        type="button"
        aria-label="Toggle"
        tabIndex={-1}
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const item = event.currentTarget.closest("[data-accordion]");
          if (item?.hasAttribute("data-open")) item.removeAttribute("data-open");
          else item?.setAttribute("data-open", "");
        }}
        {...stylex.props(chrome.button, chrome.static, styles.accordionChevron)}
      >
        <ChevronRight size={16} />
      </button>
      {anchor ? (
        <span
          {...stylex.props(chrome.static, styles.accordionAnchor)}
          contentEditable={false}
          title={`#${anchor}`}
          aria-hidden
        >
          <LinkIcon size={13} />
        </span>
      ) : null}
      <ControlsSlot at={styles.slotCorner} />
      {children}
    </div>
  );
}

function Tabs({ children }: ComponentRenderProps) {
  return <div {...stylex.props(styles.tabs)}>{children}</div>;
}

function Tab({ children }: ComponentRenderProps) {
  return (
    <div {...stylex.props(styles.tab)}>
      <ControlsSlot at={styles.slotTab} />
      {children}
    </div>
  );
}

function Include({ props, children }: ComponentRenderProps) {
  return (
    <div {...stylex.props(styles.include)}>
      <span {...stylex.props(chrome.static, styles.includeLead)} contentEditable={false}>
        <FileInput size={15} {...stylex.props(styles.infoIcon)} />
        <span {...stylex.props(styles.includeTag)}>include</span>
      </span>
      <span {...stylex.props(styles.body)}>{children}</span>
      {props.lang ? (
        <span {...stylex.props(chrome.static, styles.includeLang)} contentEditable={false}>
          {props.lang}
        </span>
      ) : null}
    </div>
  );
}

type TypeTableRows = Record<string, Record<string, unknown>>;

function typeTableRows(value: unknown): TypeTableRows | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  for (const entry of Object.values(value)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  }
  return value as TypeTableRows;
}

function TypeCell({
  value,
  placeholder,
  mono,
  onChange,
}: {
  value: unknown;
  placeholder: string;
  mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      {...stylex.props(chrome.input, styles.input, mono && styles.monoSmall)}
      value={typeof value === "string" ? value : (value?.toString() ?? "")}
      placeholder={placeholder}
      spellCheck={false}
      tabIndex={-1}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function TypeTable({ props, literals, setLiteral }: ComponentRenderProps) {
  const rows =
    typeTableRows(literals.type) ?? (props.type === undefined ? ({} as TypeTableRows) : null);

  if (!rows) {
    return (
      <div {...stylex.props(chrome.static, styles.infoCard)} contentEditable={false}>
        <Table2 size={16} {...stylex.props(styles.infoIcon)} />
        <div {...stylex.props(styles.minWidth0)}>
          <p {...stylex.props(styles.infoTitle)}>TypeTable</p>
          <p {...stylex.props(styles.infoNote, styles.truncate, styles.monoSmall)}>
            dynamic type={"{…}"}; edit the expression from its menu
          </p>
        </div>
      </div>
    );
  }

  const entries = Object.entries(rows);
  const write = (mutate: (next: [string, Record<string, unknown>][]) => void) => {
    const next = entries.map(([key, def]) => [key, def] as [string, Record<string, unknown>]);
    mutate(next);
    setLiteral("type", Object.fromEntries(next));
  };
  const patch = (index: number, field: string, value: string | boolean) =>
    write((next) => {
      const def = { ...next[index][1] };
      if (value === "" || value === false) delete def[field];
      else def[field] = value;
      next[index][1] = def;
    });

  return (
    <div {...stylex.props(chrome.static, styles.typeTable)} contentEditable={false}>
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            <th {...stylex.props(styles.head)}>Prop</th>
            <th {...stylex.props(styles.head)}>Type</th>
            <th {...stylex.props(styles.head)}>Default</th>
            <th {...stylex.props(styles.head)}>Description</th>
            <th {...stylex.props(styles.head, styles.narrow)} aria-label="Required">
              Req
            </th>
            <th {...stylex.props(styles.narrow)} />
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, def], index) => (
            <tr key={index} {...stylex.props(row)}>
              <td {...stylex.props(styles.cell, styles.cellInput, styles.cellName)}>
                <TypeCell
                  value={name}
                  placeholder="name"
                  mono
                  onChange={(next) => write((rows) => (rows[index][0] = next))}
                />
              </td>
              <td {...stylex.props(styles.cell, styles.cellInput, styles.cellType)}>
                <TypeCell
                  value={def.type}
                  placeholder="string"
                  mono
                  onChange={(next) => patch(index, "type", next)}
                />
              </td>
              <td {...stylex.props(styles.cell, styles.cellInput, styles.cellDefault)}>
                <TypeCell
                  value={def.default}
                  placeholder="–"
                  mono
                  onChange={(next) => patch(index, "default", next)}
                />
              </td>
              <td {...stylex.props(styles.cell, styles.cellInput)}>
                <TypeCell
                  value={def.description}
                  placeholder="Description…"
                  onChange={(next) => patch(index, "description", next)}
                />
              </td>
              <td {...stylex.props(styles.cell)}>
                <Checkbox.Root
                  aria-label={`${name} required`}
                  tabIndex={-1}
                  checked={def.required === true}
                  onCheckedChange={(on) => patch(index, "required", on === true)}
                  {...stylex.props(chrome.button, styles.checkbox)}
                >
                  <Checkbox.Indicator {...stylex.props(styles.flex)}>
                    <Check size={11} strokeWidth={3} />
                  </Checkbox.Indicator>
                </Checkbox.Root>
              </td>
              <td {...stylex.props(styles.cell, styles.cellRemove)}>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  {...stylex.props(chrome.button, styles.removeButton)}
                  tabIndex={-1}
                  onClick={() => write((rows) => rows.splice(index, 1))}
                >
                  <X size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        {...stylex.props(chrome.button, styles.addButton)}
        tabIndex={-1}
        onClick={() => write((rows) => rows.push([`prop${rows.length + 1}`, { type: "string" }]))}
      >
        <Plus size={13} /> Add prop
      </button>
    </div>
  );
}

function GithubInfoBox({ props }: ComponentRenderProps) {
  return (
    <div {...stylex.props(chrome.static, styles.infoCard)} contentEditable={false}>
      <GitBranch size={16} {...stylex.props(styles.infoIcon)} />
      <div {...stylex.props(styles.minWidth0)}>
        <p {...stylex.props(styles.infoTitle, styles.truncate)}>
          {props.owner || "owner"}/{props.repo || "repo"}
        </p>
        <p {...stylex.props(styles.infoNote)}>GitHub repository</p>
      </div>
    </div>
  );
}

export const calloutRegions = {
  title: regionClass(styles.calloutTitle),
  body: regionClass(styles.calloutBody),
};

export const calloutSpec: UiComponentSpec = {
  name: "Callout",
  label: "Callout",
  icon: <Info size={13} />,
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Title…" }],
  childrenRegion: { region: "body", placeholder: "Write the callout…" },
  regions: calloutRegions,
  props: [
    {
      name: "type",
      label: "Type",
      type: "enum",
      options: ["info", "warn", "error", "success", "idea"],
      default: "info",
      inline: true,
    },
  ],
  render: Callout,
  insert: () => ({
    type: "mdxComponent",
    attrs: {
      name: "Callout",
      attributes: [{ type: "mdxJsxAttribute", name: "type", value: "info" }],
    },
    content: [
      { type: "mdxInlineRegion", attrs: { region: "title" } },
      { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
    ],
  }),
};

const cardInsert = () => ({
  type: "mdxComponent",
  attrs: { name: "Card", attributes: [{ type: "mdxJsxAttribute", name: "title", value: "" }] },
  content: [
    { type: "mdxInlineRegion", attrs: { region: "title" } },
    { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
  ],
});

export const cardSpec: UiComponentSpec = {
  name: "Card",
  label: "Card",
  icon: <SquareStack size={13} />,
  // title is edited inline; the multi-line body is the block region below it.
  // `description` and children render into the same slot in fumadocs-ui, so a
  // `description` attribute is folded into the body rather than shown separately.
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Card title…" }],
  childrenRegion: { region: "body", placeholder: "Write the card…", fromAttribute: "description" },
  regions: { title: regionClass(styles.cardTitle), body: regionClass(styles.cardBody) },
  props: [
    { name: "href", label: "Link", type: "string", placeholder: "/docs/…" },
    { name: "external", label: "Open in new tab", type: "boolean" },
  ],
  render: Card,
  insert: cardInsert,
};

export const cardsSpec: UiComponentSpec = {
  name: "Cards",
  label: "Cards",
  icon: <LayoutGrid size={13} />,
  childComponent: "Card",
  render: Cards,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Cards", attributes: [] },
    content: [cardInsert()],
  }),
};

export const stepSpec: UiComponentSpec = {
  name: "Step",
  label: "Step",
  childrenRegion: { region: "body", placeholder: "Describe this step…" },
  regions: { body: regionClass(styles.clearSlot) },
  render: Step,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Step", attributes: [] },
    content: [
      { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
    ],
  }),
};

export const stepsSpec: UiComponentSpec = {
  name: "Steps",
  label: "Steps",
  icon: <ListOrdered size={13} />,
  childComponent: "Step",
  render: Steps,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Steps", attributes: [] },
    content: [
      {
        type: "mdxComponent",
        attrs: { name: "Step", attributes: [] },
        content: [
          {
            type: "mdxBlockRegion",
            attrs: { region: "body" },
            content: [
              {
                type: "heading",
                attrs: { level: 3 },
                content: [{ type: "text", text: "Step one" }],
              },
            ],
          },
        ],
      },
    ],
  }),
};

const accordionInsert = () => ({
  type: "mdxComponent",
  attrs: { name: "Accordion", attributes: [{ type: "mdxJsxAttribute", name: "title", value: "" }] },
  content: [
    { type: "mdxInlineRegion", attrs: { region: "title" } },
    { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
  ],
});

export const accordionSpec: UiComponentSpec = {
  name: "Accordion",
  label: "Accordion",
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Question…" }],
  childrenRegion: { region: "body", placeholder: "Answer…" },
  regions: { title: regionClass(styles.accordionTitle), body: regionClass(styles.accordionBody) },
  props: [{ name: "id", label: "Anchor (id)", type: "string", placeholder: "section-id" }],
  render: Accordion,
  insert: accordionInsert,
};

export const accordionsSpec: UiComponentSpec = {
  name: "Accordions",
  label: "Accordions",
  icon: <Rows3 size={13} />,
  childComponent: "Accordion",
  props: [
    {
      name: "type",
      label: "Selection",
      type: "enum",
      options: ["single", "multiple"],
      default: "single",
    },
  ],
  render: Accordions,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Accordions", attributes: [] },
    content: [accordionInsert()],
  }),
};

const entryInsert = (name: string, region: string) => () => ({
  type: "mdxComponent",
  attrs: { name, attributes: [{ type: "mdxJsxAttribute", name: "name", value: "" }] },
  content: [{ type: "mdxInlineRegion", attrs: { region } }],
});

export const fileSpec: UiComponentSpec = {
  name: "File",
  label: "File",
  icon: <FileIcon size={13} />,
  attributeRegions: [{ attribute: "name", region: "file-name", placeholder: "file name…" }],
  regions: { "file-name": regionClass(styles.entryName) },
  render: File,
  insert: entryInsert("File", "file-name"),
};

export const folderSpec: UiComponentSpec = {
  name: "Folder",
  label: "Folder",
  icon: <FolderIcon size={13} />,
  attributeRegions: [{ attribute: "name", region: "folder-name", placeholder: "folder name…" }],
  regions: { "folder-name": regionClass(styles.entryName) },
  childComponent: ["File", "Folder"],
  listLike: true,
  render: Folder,
  insert: entryInsert("Folder", "folder-name"),
};

export const filesSpec: UiComponentSpec = {
  name: "Files",
  label: "Files",
  icon: <FolderTree size={13} />,
  childComponent: ["File", "Folder"],
  listLike: true,
  render: Files,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Files", attributes: [] },
    content: [
      {
        type: "mdxComponent",
        attrs: {
          name: "Folder",
          attributes: [{ type: "mdxJsxAttribute", name: "name", value: "app" }],
        },
        content: [
          {
            type: "mdxInlineRegion",
            attrs: { region: "folder-name" },
            content: [{ type: "text", text: "app" }],
          },
          {
            type: "mdxComponent",
            attrs: {
              name: "File",
              attributes: [{ type: "mdxJsxAttribute", name: "name", value: "page.tsx" }],
            },
            content: [
              {
                type: "mdxInlineRegion",
                attrs: { region: "file-name" },
                content: [{ type: "text", text: "page.tsx" }],
              },
            ],
          },
        ],
      },
      {
        type: "mdxComponent",
        attrs: {
          name: "File",
          attributes: [{ type: "mdxJsxAttribute", name: "name", value: "package.json" }],
        },
        content: [
          {
            type: "mdxInlineRegion",
            attrs: { region: "file-name" },
            content: [{ type: "text", text: "package.json" }],
          },
        ],
      },
    ],
  }),
};

const tabInsert = () => ({
  type: "mdxComponent",
  attrs: { name: "Tab", attributes: [] },
  content: [
    { type: "mdxInlineRegion", attrs: { region: "label" } },
    { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
  ],
});

export const tabSpec: UiComponentSpec = {
  name: "Tab",
  label: "Tab",
  childrenRegion: { region: "body", placeholder: "Tab content…" },
  // the label region is contributed by the Tabs `items` attribute, but it
  // renders inside a Tab: its styles belong to this spec
  regions: { label: regionClass(styles.tabLabel), body: regionClass(styles.tabBody) },
  props: [
    { name: "value", label: "Value", type: "string", placeholder: "derived from label" },
    { name: "id", label: "Anchor (id)", type: "string", placeholder: "tab-id" },
  ],
  render: Tab,
  insert: tabInsert,
};

export const tabsSpec: UiComponentSpec = {
  name: "Tabs",
  label: "Tabs",
  icon: <PanelTop size={13} />,
  childComponent: "Tab",
  listLike: true,
  itemsAttribute: { attribute: "items", childRegion: "label", placeholder: "Tab label…" },
  props: [
    { name: "groupId", label: "Group id", type: "string", placeholder: "shared-group" },
    { name: "persist", label: "Persist selection", type: "boolean" },
    { name: "updateAnchor", label: "Update URL hash", type: "boolean" },
  ],
  render: Tabs,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Tabs", attributes: [] },
    content: ["Tab 1", "Tab 2"].map((label) => ({
      type: "mdxComponent",
      attrs: { name: "Tab", attributes: [] },
      content: [
        {
          type: "mdxInlineRegion",
          attrs: { region: "label" },
          content: [{ type: "text", text: label }],
        },
        { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
      ],
    })),
  }),
};

export const includeSpec: UiComponentSpec = {
  name: "include",
  label: "Include",
  icon: <FileInput size={13} />,
  contentRegion: { region: "path", placeholder: "./path/to/file.mdx" },
  filePathRegion: "path",
  regions: { path: regionClass(styles.includePath) },
  props: [
    { name: "lang", label: "Language", type: "string", placeholder: "auto" },
    { name: "meta", label: "Code meta", type: "string", placeholder: 'title="…"' },
    { name: "cwd", label: "Resolve from project root", type: "boolean" },
  ],
  render: Include,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "include", attributes: [] },
    content: [{ type: "mdxInlineRegion", attrs: { region: "path" } }],
  }),
};

export const typeTableSpec: UiComponentSpec = {
  name: "TypeTable",
  label: "Type table",
  icon: <Table2 size={13} />,
  props: [
    {
      name: "type",
      label: "Type definition",
      type: "expression",
      placeholder: '{{ prop: { type: "string" } }}',
    },
  ],
  render: TypeTable,
  insert: () => ({
    type: "mdxComponent",
    attrs: {
      name: "TypeTable",
      attributes: [
        {
          type: "mdxJsxAttribute",
          name: "type",
          value: { type: "mdxJsxAttributeValueExpression", value: "{}", literal: {} },
        },
      ],
    },
  }),
};

export const githubInfoSpec: UiComponentSpec = {
  name: "GithubInfo",
  label: "GitHub info",
  icon: <GitBranch size={13} />,
  props: [
    { name: "owner", label: "Owner", type: "string", placeholder: "fuma-nama" },
    { name: "repo", label: "Repository", type: "string", placeholder: "fumadocs" },
  ],
  render: GithubInfoBox,
  insert: () => ({ type: "mdxComponent", attrs: { name: "GithubInfo", attributes: [] } }),
};

// Banner and InlineTOC are absent: they are page-layout components (mounted
// by the app shell, fed the page's own TOC), not document content. In a doc
// they stay on the lossless generic fallback.

/**
 * All built-in fumadocs-ui component specs. Child-only specs ({@link cardSpec},
 * {@link stepSpec}, {@link accordionSpec}, {@link fileSpec}, {@link folderSpec})
 * are registered so the parser can resolve them as `childComponent` targets,
 * even though they aren't offered as top-level inserts.
 */
export const fumadocsUiComponents: UiComponentSpec[] = [
  calloutSpec,
  cardSpec,
  cardsSpec,
  tabSpec,
  tabsSpec,
  stepSpec,
  stepsSpec,
  accordionSpec,
  accordionsSpec,
  fileSpec,
  folderSpec,
  filesSpec,
  includeSpec,
  typeTableSpec,
  githubInfoSpec,
];
