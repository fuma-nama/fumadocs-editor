"use client";
import {
  Check,
  ChevronDown,
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
  ListTree,
  Megaphone,
  PanelTop,
  Rows3,
  SquareStack,
  Table2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Select } from "@base-ui/react/select";
import type { CSSProperties } from "react";
import { cn } from "../utils/cn";
import { itemCls, popupCls } from "./styles";
import type { ComponentRenderProps, UiComponentSpec } from "./spec";

/*
 * Node renderers for the fumadocs-ui MDX components. Each mirrors the real
 * component's markup: same Tailwind utilities, same `fd-*` tokens, so the
 * editor is genuinely WYSIWYG. In a fumadocs-ui consumer these renderers would
 * import the actual components and drop `<NodeViewContent>` into their editable
 * slots. The editable regions arrive as `children`, in document order.
 */

const CALLOUT_ICONS: Record<string, LucideIcon> = {
  info: Info,
  warn: TriangleAlert,
  warning: TriangleAlert,
  error: CircleX,
  success: CircleCheck,
  idea: Lightbulb,
};

const CALLOUT_TYPES = [
  { value: "info", label: "Info" },
  { value: "warn", label: "Warning" },
  { value: "error", label: "Error" },
  { value: "success", label: "Success" },
  { value: "idea", label: "Idea" },
];

/** map the JSX alias to the token/icon key */
const colorKey = (type: string) => (type === "warn" ? "warning" : type);

/** The callout icon doubles as an in-place picker for the callout `type`. */
function CalloutTypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const Current = CALLOUT_ICONS[value] ?? Info;
  const isIdea = value === "idea";
  return (
    <Select.Root
      items={CALLOUT_TYPES}
      value={value}
      onValueChange={(next) => onChange(next as string)}
    >
      <Select.Trigger
        aria-label="Callout type"
        tabIndex={-1}
        className={cn(
          "-mx-0.5 mt-px inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 outline-none hover:bg-(--callout-color)/15 data-[popup-open]:bg-(--callout-color)/15 [&_svg]:fill-(--callout-color)",
          isIdea ? "text-(--callout-color)" : "text-fd-card",
        )}
      >
        <Current size={20} strokeWidth={2} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} align="start" alignItemWithTrigger={false}>
          <Select.Popup className={popupCls}>
            {CALLOUT_TYPES.map((item) => {
              const Icon = CALLOUT_ICONS[item.value] ?? Info;
              return (
                <Select.Item key={item.value} value={item.value} className={itemCls}>
                  <Icon
                    size={15}
                    className="shrink-0"
                    style={{ color: `var(--color-fd-${colorKey(item.value)})` }}
                  />
                  <Select.ItemText>{item.label}</Select.ItemText>
                  <Select.ItemIndicator className="ms-auto text-fd-foreground">
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

function Callout({ props, children, setProp }: ComponentRenderProps) {
  const type = props.type ?? "info";
  return (
    <div
      className="fde-callout flex items-start gap-2 rounded-xl border border-fd-border bg-fd-card p-3 ps-1 text-[0.925em] text-fd-card-foreground shadow-md"
      style={{ "--callout-color": `var(--color-fd-${colorKey(type)})` } as CSSProperties}
      data-type={type}
    >
      <div
        role="none"
        className="w-0.5 self-stretch rounded-sm bg-(--callout-color)/50"
        contentEditable={false}
      />
      <span className="contents" contentEditable={false}>
        <CalloutTypeSelect value={type} onChange={(value) => setProp("type", value)} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Card({ props, children }: ComponentRenderProps) {
  return (
    <div
      className={cn(
        "fde-card rounded-xl border border-fd-border bg-fd-card p-4 text-fd-card-foreground transition-colors",
        props.href && "hover:bg-fd-accent/80",
      )}
      data-has-href={props.href ? "" : undefined}
    >
      {children}
    </div>
  );
}

function Cards({ children }: ComponentRenderProps) {
  return <div className="fde-cards grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">{children}</div>;
}

function Steps({ children }: ComponentRenderProps) {
  return <div className="fde-steps">{children}</div>;
}

function Step({ children }: ComponentRenderProps) {
  return <div className="fde-step">{children}</div>;
}

function Accordions({ children }: ComponentRenderProps) {
  return (
    <div className="fde-accordions divide-y divide-fd-border overflow-hidden rounded-lg border border-fd-border bg-fd-card">
      {children}
    </div>
  );
}

function Files({ children }: ComponentRenderProps) {
  return (
    <div className="fde-files rounded-xl border border-fd-border bg-fd-card p-2 text-[0.9em] text-fd-card-foreground">
      {children}
    </div>
  );
}

/**
 * File and Folder rows share one geometry; the icon doubles as the drag grip.
 * `z-[1]` lifts it above the name region (`position: relative`, later in DOM
 * order), which would otherwise swallow every pointer event aimed at it.
 */
const entryIconCls =
  "absolute start-2 top-2 z-[1] cursor-grab text-fd-muted-foreground active:cursor-grabbing";

function File({ children }: ComponentRenderProps) {
  return (
    <div className="fde-file relative">
      <span className={entryIconCls} contentEditable={false} draggable data-drag-handle>
        <FileIcon size={15} />
      </span>
      {children}
    </div>
  );
}

function Folder({ children }: ComponentRenderProps) {
  return (
    <div className="fde-folder relative">
      <span className={entryIconCls} contentEditable={false} draggable data-drag-handle>
        <FolderIcon size={15} />
      </span>
      {children}
    </div>
  );
}

function Accordion({ props, children }: ComponentRenderProps) {
  // Editor renders every item open so its body stays editable; the chevron is a
  // real collapse toggle (mirrors the component) rather than the whole header,
  // so clicking the title still places the caret. Open state is a DOM attribute
  // toggled imperatively: node-view renderers can't hold React hook state
  // reliably, and "reopens on edit" is the right default for an editor anyway.
  const anchor = props.id;
  return (
    <div className="fde-accordion" data-open="">
      <button
        type="button"
        aria-label="Toggle"
        tabIndex={-1}
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const item = event.currentTarget.closest(".fde-accordion");
          if (item?.hasAttribute("data-open")) item.removeAttribute("data-open");
          else item?.setAttribute("data-open", "");
        }}
        className="fde-accordion-chevron outline-none"
      >
        <ChevronRight size={16} />
      </button>
      {anchor ? (
        <span
          className="fde-accordion-anchor"
          contentEditable={false}
          title={`#${anchor}`}
          aria-hidden
        >
          <LinkIcon size={13} />
        </span>
      ) : null}
      {children}
    </div>
  );
}

function Tabs({ children }: ComponentRenderProps) {
  return (
    <div className="fde-tabs flex flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-secondary">
      {children}
    </div>
  );
}

function Tab({ children }: ComponentRenderProps) {
  return <div className="fde-tab">{children}</div>;
}

function Include({ props, children }: ComponentRenderProps) {
  return (
    <div className="fde-include flex items-center gap-2 rounded-xl border border-dashed border-fd-border bg-fd-card px-3 py-2 text-[0.9em]">
      <span className="flex shrink-0 items-center gap-2" contentEditable={false}>
        <FileInput size={15} className="text-fd-muted-foreground" />
        <span className="font-mono text-[11px] font-semibold tracking-wide text-fd-muted-foreground">
          include
        </span>
      </span>
      {children}
      {props.lang ? (
        <span
          className="shrink-0 rounded-md border border-fd-border bg-fd-muted px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground"
          contentEditable={false}
        >
          {props.lang}
        </span>
      ) : null}
    </div>
  );
}

function TypeTable({ props }: ComponentRenderProps) {
  return (
    <div
      className="fde-typetable flex items-center gap-3 rounded-xl border border-fd-border bg-fd-card p-3 text-sm"
      contentEditable={false}
    >
      <Table2 size={16} className="shrink-0 text-fd-muted-foreground" />
      <div className="min-w-0">
        <p className="font-medium">TypeTable</p>
        <p className="truncate font-mono text-[12px] text-fd-muted-foreground">
          {props.type ? "type={…}" : "no type set — edit via the ⋯ menu"}
        </p>
      </div>
    </div>
  );
}

function GithubInfoBox({ props }: ComponentRenderProps) {
  return (
    <div
      className="fde-github flex items-center gap-3 rounded-xl border border-fd-border bg-fd-card p-3 text-sm"
      contentEditable={false}
    >
      <GitBranch size={16} className="shrink-0 text-fd-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate font-medium">
          {props.owner || "owner"}/{props.repo || "repo"}
        </p>
        <p className="text-[12px] text-fd-muted-foreground">GitHub repository</p>
      </div>
    </div>
  );
}

function Banner({ props, children }: ComponentRenderProps) {
  return (
    <div
      className="fde-banner rounded-xl px-4 py-3 text-center text-sm font-medium"
      data-variant={props.variant ?? "normal"}
    >
      {children}
    </div>
  );
}

function InlineTOC({ children }: ComponentRenderProps) {
  return (
    <div className="fde-inline-toc rounded-xl border border-fd-border bg-fd-card px-4 py-3 text-sm">
      <span className="float-right ms-2 text-fd-muted-foreground" contentEditable={false}>
        <ChevronDown size={16} />
      </span>
      {children}
    </div>
  );
}

export const calloutSpec: UiComponentSpec = {
  name: "Callout",
  title: "Callout",
  icon: <Info size={13} />,
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Title…" }],
  childrenRegion: { region: "body", placeholder: "Write the callout…" },
  props: [
    {
      name: "type",
      label: "Type",
      type: "enum",
      options: ["info", "warn", "error", "success", "idea"],
      default: "info",
      // edited in place by clicking the callout icon
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
  title: "Card",
  icon: <SquareStack size={13} />,
  // title is edited inline; the multi-line body is the block region below it.
  // `description` and children render into the same slot in fumadocs-ui, so a
  // `description` attribute is folded into the body rather than shown separately.
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Card title…" }],
  childrenRegion: { region: "body", placeholder: "Write the card…", fromAttribute: "description" },
  props: [
    { name: "href", label: "Link", type: "string", placeholder: "/docs/…" },
    { name: "external", label: "Open in new tab", type: "boolean" },
  ],
  render: Card,
  insert: cardInsert,
};

export const cardsSpec: UiComponentSpec = {
  name: "Cards",
  title: "Cards",
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
  title: "Step",
  childrenRegion: { region: "body", placeholder: "Describe this step…" },
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
  title: "Steps",
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
  title: "Accordion",
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Question…" }],
  childrenRegion: { region: "body", placeholder: "Answer…" },
  props: [
    // the `id` attribute is the accordion's anchor (deep-link target)
    { name: "id", label: "Anchor (id)", type: "string", placeholder: "section-id" },
  ],
  render: Accordion,
  insert: accordionInsert,
};

export const accordionsSpec: UiComponentSpec = {
  name: "Accordions",
  title: "Accordions",
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

const fileInsert = () => ({
  type: "mdxComponent",
  attrs: { name: "File", attributes: [{ type: "mdxJsxAttribute", name: "name", value: "" }] },
  content: [{ type: "mdxInlineRegion", attrs: { region: "file-name" } }],
});

export const fileSpec: UiComponentSpec = {
  name: "File",
  title: "File",
  icon: <FileIcon size={13} />,
  attributeRegions: [{ attribute: "name", region: "file-name", placeholder: "file name…" }],
  render: File,
  insert: fileInsert,
};

export const folderSpec: UiComponentSpec = {
  name: "Folder",
  title: "Folder",
  icon: <FolderIcon size={13} />,
  attributeRegions: [{ attribute: "name", region: "folder-name", placeholder: "folder name…" }],
  // a folder holds files and further folders: needs the array child form
  childComponent: ["File", "Folder"],
  listLike: true,
  render: Folder,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Folder", attributes: [{ type: "mdxJsxAttribute", name: "name", value: "" }] },
    content: [{ type: "mdxInlineRegion", attrs: { region: "folder-name" } }],
  }),
};

export const filesSpec: UiComponentSpec = {
  name: "Files",
  title: "Files",
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
  title: "Tab",
  childrenRegion: { region: "body", placeholder: "Tab content…" },
  props: [
    { name: "value", label: "Value", type: "string", placeholder: "derived from label" },
    { name: "id", label: "Anchor (id)", type: "string", placeholder: "tab-id" },
  ],
  render: Tab,
  insert: tabInsert,
};

export const tabsSpec: UiComponentSpec = {
  name: "Tabs",
  title: "Tabs",
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
  title: "Include",
  icon: <FileInput size={13} />,
  contentRegion: { region: "path", placeholder: "./path/to/file.mdx" },
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
  title: "Type table",
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
          value: { type: "mdxJsxAttributeValueExpression", value: "{}" },
        },
      ],
    },
  }),
};

export const githubInfoSpec: UiComponentSpec = {
  name: "GithubInfo",
  title: "GitHub info",
  icon: <GitBranch size={13} />,
  props: [
    { name: "owner", label: "Owner", type: "string", placeholder: "fuma-nama" },
    { name: "repo", label: "Repository", type: "string", placeholder: "fumadocs" },
  ],
  render: GithubInfoBox,
  insert: () => ({ type: "mdxComponent", attrs: { name: "GithubInfo", attributes: [] } }),
};

export const bannerSpec: UiComponentSpec = {
  name: "Banner",
  title: "Banner",
  icon: <Megaphone size={13} />,
  childrenRegion: { region: "body", placeholder: "Announcement…" },
  props: [
    {
      name: "variant",
      label: "Variant",
      type: "enum",
      options: ["normal", "rainbow"],
      default: "normal",
    },
    { name: "id", label: "Dismiss id", type: "string", placeholder: "release-1" },
  ],
  render: Banner,
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Banner", attributes: [] },
    content: [
      { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
    ],
  }),
};

export const inlineTocSpec: UiComponentSpec = {
  name: "InlineTOC",
  title: "Inline TOC",
  icon: <ListTree size={13} />,
  childrenRegion: { region: "body", placeholder: "Table of Contents" },
  props: [
    { name: "items", label: "Items", type: "expression", placeholder: "{toc}", default: "toc" },
  ],
  render: InlineTOC,
  insert: () => ({
    type: "mdxComponent",
    attrs: {
      name: "InlineTOC",
      attributes: [
        {
          type: "mdxJsxAttribute",
          name: "items",
          value: { type: "mdxJsxAttributeValueExpression", value: "toc" },
        },
      ],
    },
    content: [
      { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
    ],
  }),
};

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
  bannerSpec,
  inlineTocSpec,
];
