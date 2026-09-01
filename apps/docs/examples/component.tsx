import { MdxEditor, fumadocsUiComponents } from "@fumadocs-editor/ui";
import type { ComponentRenderProps, UiComponentSpec } from "@fumadocs-editor/ui";

//#region renderer
function Feature({ literals, children }: ComponentRenderProps) {
  const soon = literals.soon === true;
  return (
    <div className="rounded-xl border border-fd-border bg-fd-card p-4 [&_[data-region=title]]:font-medium">
      {soon && (
        <span
          contentEditable={false}
          className="float-right rounded-full bg-fd-primary/10 px-2 py-0.5 text-xs text-fd-primary"
        >
          Soon
        </span>
      )}
      {children}
    </div>
  );
}
//#endregion

//#region spec
export const featureSpec: UiComponentSpec = {
  name: "Feature",
  label: "Feature",
  attributeRegions: [{ attribute: "title", region: "title", placeholder: "Feature name…" }],
  childrenRegion: { region: "body", placeholder: "Describe the feature…" },
  props: [{ name: "soon", label: "Coming soon", type: "boolean", default: false }],
  insert: () => ({
    type: "mdxComponent",
    attrs: { name: "Feature", attributes: [] },
    content: [
      { type: "mdxInlineRegion", attrs: { region: "title" } },
      { type: "mdxBlockRegion", attrs: { region: "body" }, content: [{ type: "paragraph" }] },
    ],
  }),
  render: Feature,
};
//#endregion

//#region usage
const components = [...fumadocsUiComponents, featureSpec];

export function Editor({ text }: { text: string }) {
  return <MdxEditor defaultValue={text} components={components} />;
}
//#endregion
