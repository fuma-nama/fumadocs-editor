"use client";
import type { JSONContent } from "@tiptap/core";
import type { MdxAttribute } from "@fumadocs-editor/core/extensions";
import { SquareCode } from "lucide-react";
import {
  Component as ReactComponent,
  createContext,
  useContext,
  Fragment,
  type ReactNode,
} from "react";
import type { UiComponentSpec } from "./components/spec";
import { readLiterals, readStringProps } from "./components/attr-values";
import { resolveSrc, type MediaProvider } from "./components/media";

/**
 * Stage-0 paint: the parsed PM document as plain React, no TipTap and no
 * ProseMirror. Mirrors the live editor's DOM shape — the same
 * `.react-renderer` / `data-node-view-*` shells the React node views emit —
 * so preset.css styles both identically and the live editor can swap in
 * without a visible shift.
 */

type SpecMap = Map<string, UiComponentSpec>;

const MediaContext = createContext<MediaProvider | undefined>(undefined);

function StaticImg({ node }: { node: JSONContent }) {
  const media = useContext(MediaContext);
  return (
    <img
      src={resolveSrc(media, String(node.attrs?.src ?? ""))}
      alt={(node.attrs?.alt as string) ?? ""}
      title={(node.attrs?.title as string) ?? undefined}
    />
  );
}

const noop = () => {};

/**
 * Contains a throwing third-party renderer to its own component: the fallback
 * keeps that component's (still editable) regions visible while the document
 * and the rest of the editor stay intact. Colocated here, not its own module,
 * because both the static paint and the live node views need it and this file
 * is already eager — module extraction on the eager path costs real bytes.
 */
export class RenderBoundary extends ReactComponent<
  { resetOn?: unknown; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetOn?: unknown }) {
    // a node update retries the renderer, so an attr fix heals the component
    if (this.state.failed && prev.resetOn !== this.props.resetOn) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** the generic dashed card: unregistered components and crashed renderers */
export function FallbackCard({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div
      data-component-fallback=""
      className="rounded-[10px] border border-dashed border-fd-border px-3 py-2.5"
    >
      <div
        className="mb-1 font-mono text-[11px] text-fd-muted-foreground select-none"
        contentEditable={false}
      >{`<${name}>`}</div>
      {children}
    </div>
  );
}

function renderMarks(node: JSONContent, key: number): ReactNode {
  let out: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code>{out}</code>;
        break;
      case "link":
        out = (
          <a href={mark.attrs?.href as string} title={(mark.attrs?.title as string) ?? undefined}>
            {out}
          </a>
        );
        break;
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function renderChildren(nodes: JSONContent[] | undefined, specs: SpecMap): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(renderNode(nodes[i], specs, i));
  return out;
}

/** the per-node shell @tiptap/react wraps every React node view in */
function Shell({ type, children }: { type: string; children: ReactNode }) {
  return <div className={`react-renderer node-${type}`}>{children}</div>;
}

/** static twin of NodeViewContent + its inner React content wrapper */
function ContentHole({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className} data-node-view-content="" style={{ whiteSpace: "pre-wrap" }}>
      <div data-node-view-content-react="" style={{ whiteSpace: "inherit" }}>
        {children}
      </div>
    </div>
  );
}

function Component({ node, specs }: { node: JSONContent; specs: SpecMap }) {
  const name = (node.attrs?.name as string | null) ?? null;
  const spec = name ? specs.get(name) : undefined;
  const attributes = (node.attrs?.attributes ?? []) as MdxAttribute[];
  const children = renderChildren(node.content, specs);

  if (!spec) {
    return (
      <Shell type="mdxComponent">
        <div
          data-node-view-wrapper=""
          data-component={name ?? ""}
          className="relative"
          style={{ whiteSpace: "normal" }}
        >
          <FallbackCard name={name ?? ""}>
            <ContentHole>{children}</ContentHole>
          </FallbackCard>
        </div>
      </Shell>
    );
  }

  const Render = spec.render;
  return (
    <Shell type="mdxComponent">
      <div
        data-node-view-wrapper=""
        data-component={name}
        className="relative"
        style={{ whiteSpace: "normal" }}
      >
        <RenderBoundary
          fallback={
            <FallbackCard name={spec.name}>
              <ContentHole className="fde-component-content">{children}</ContentHole>
            </FallbackCard>
          }
        >
          <Render
            props={readStringProps(attributes)}
            literals={readLiterals(attributes)}
            selected={false}
            setProp={noop}
            setLiteral={noop}
          >
            <ContentHole className="fde-component-content">{children}</ContentHole>
          </Render>
        </RenderBoundary>
      </div>
    </Shell>
  );
}

function Region({ node, specs, kind }: { node: JSONContent; specs: SpecMap; kind: string }) {
  const region = (node.attrs?.region as string) ?? "";
  return (
    <Shell type={kind === "inline" ? "mdxInlineRegion" : "mdxBlockRegion"}>
      <div
        data-node-view-wrapper=""
        className={`fde-region fde-region-${kind}`}
        data-region={region}
        style={{ whiteSpace: "normal" }}
      >
        <ContentHole>{renderChildren(node.content, specs)}</ContentHole>
      </div>
    </Shell>
  );
}

/** the code-block figure without its language picker or copy button */
function StaticCodeBlock({ node }: { node: JSONContent }) {
  const language = (node.attrs?.language as string | null) ?? "";
  return (
    <Shell type="codeBlock">
      <figure
        data-node-view-wrapper=""
        dir="ltr"
        className="fde-codeblock shiki not-prose relative my-4 overflow-hidden rounded-xl border border-fd-border bg-fd-card text-sm shadow-sm"
        style={{ whiteSpace: "normal" }}
      >
        <div className="flex h-9.5 items-center gap-1 border-b border-fd-border px-3 text-fd-muted-foreground">
          <SquareCode size={15} className="shrink-0 opacity-70" />
          <div className="flex-1" />
          <span className="px-1.5 text-xs font-medium">{language || "plaintext"}</span>
        </div>
        <div className="overflow-auto">
          <pre className="fde-codeblock-pre">
            <code data-node-view-content="" style={{ whiteSpace: "pre-wrap" }}>
              {node.content?.[0]?.text ?? ""}
            </code>
          </pre>
        </div>
      </figure>
    </Shell>
  );
}

function renderNode(node: JSONContent, specs: SpecMap, key: number): ReactNode {
  const children = () => renderChildren(node.content, specs);
  switch (node.type) {
    case "text":
      return renderMarks(node, key);
    case "paragraph":
      return <p key={key}>{children()}</p>;
    case "heading": {
      const Tag = `h${(node.attrs?.level as number) ?? 1}` as "h1";
      return (
        <Tag
          key={key}
          data-anchor={(node.attrs?.anchor as string) ?? undefined}
          data-toc={(node.attrs?.toc as string) ?? undefined}
        >
          {children()}
        </Tag>
      );
    }
    case "hardBreak":
      return <br key={key} />;
    case "bulletList":
      return <ul key={key}>{children()}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={(node.attrs?.start as number) ?? undefined}>
          {children()}
        </ol>
      );
    case "listItem":
      return <li key={key}>{children()}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {children()}
        </ul>
      );
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return (
        <li key={key} data-type="taskItem" data-checked={checked}>
          <label>
            <input type="checkbox" defaultChecked={checked} disabled />
            <span />
          </label>
          <div>{children()}</div>
        </li>
      );
    }
    case "blockquote":
      return <blockquote key={key}>{children()}</blockquote>;
    case "horizontalRule":
      return <hr key={key} />;
    case "image":
      return <StaticImg key={key} node={node} />;
    case "table":
      return (
        <table key={key}>
          <tbody>{children()}</tbody>
        </table>
      );
    case "tableRow":
      return <tr key={key}>{children()}</tr>;
    case "tableHeader":
      return (
        <th
          key={key}
          colSpan={node.attrs?.colspan as number}
          rowSpan={node.attrs?.rowspan as number}
        >
          {children()}
        </th>
      );
    case "tableCell":
      return (
        <td
          key={key}
          colSpan={node.attrs?.colspan as number}
          rowSpan={node.attrs?.rowspan as number}
        >
          {children()}
        </td>
      );
    case "codeBlock":
      return <StaticCodeBlock key={key} node={node} />;
    // math paints as its TeX source: the live editor looks identical until
    // the lazy KaTeX chunk arrives, so the hydration swap stays still
    case "mathInline":
      return (
        <span key={key} className="react-renderer node-mathInline">
          <span className="fde-math fde-math-inline" data-node-view-wrapper="">
            <span className="fde-math-src">
              <span data-node-view-content="">{node.content?.[0]?.text ?? ""}</span>
            </span>
          </span>
        </span>
      );
    case "mathBlock":
      return (
        <Shell key={key} type="mathBlock">
          <div
            data-node-view-wrapper=""
            className="fde-math fde-math-block"
            style={{ whiteSpace: "normal" }}
          >
            <pre className="fde-math-src">
              <code data-node-view-content="" style={{ whiteSpace: "pre-wrap" }}>
                {node.content?.[0]?.text ?? ""}
              </code>
            </pre>
          </div>
        </Shell>
      );
    case "mdxComponent":
      return <Component key={key} node={node} specs={specs} />;
    case "mdxInlineRegion":
      return <Region key={key} node={node} specs={specs} kind="inline" />;
    case "mdxBlockRegion":
      return <Region key={key} node={node} specs={specs} kind="block" />;
    case "mdxJsxFlowElement":
      return (
        <div key={key} data-mdx-flow="" data-component={(node.attrs?.name as string) ?? "Fragment"}>
          {children()}
        </div>
      );
    case "mdxJsxTextElement":
      return (
        <span
          key={key}
          data-mdx-inline=""
          data-component={(node.attrs?.name as string) ?? "Fragment"}
        >
          {children()}
        </span>
      );
    case "mdxTextExpression":
      return <code key={key} data-mdx-expression="">{`{${String(node.attrs?.value ?? "")}}`}</code>;
    case "verbatimInline":
      return (
        <code key={key} data-mdx-verbatim="">
          {String(node.attrs?.value ?? "")}
        </code>
      );
    case "mdxFlowExpression":
    case "mdxjsEsm":
    case "frontmatter":
    case "verbatim": {
      const attr = {
        mdxFlowExpression: "data-mdx-expression",
        mdxjsEsm: "data-mdx-esm",
        frontmatter: "data-mdx-frontmatter",
        verbatim: "data-mdx-verbatim",
      }[node.type];
      return (
        <pre key={key} {...{ [attr]: "" }}>
          <code>{String(node.attrs?.value ?? "")}</code>
        </pre>
      );
    }
    default:
      return <div key={key}>{children()}</div>;
  }
}

export function StaticMdx({
  doc,
  specs,
  media,
}: {
  doc: JSONContent;
  specs: SpecMap;
  media?: MediaProvider;
}) {
  return (
    <MediaContext.Provider value={media}>
      <div className="ProseMirror" style={{ whiteSpace: "pre-wrap" }} aria-label="Loading editor">
        {renderChildren(doc.content, specs)}
      </div>
    </MediaContext.Provider>
  );
}
