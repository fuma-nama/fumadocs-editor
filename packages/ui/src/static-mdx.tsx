"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./styles/tokens.stylex";
import type { JSONContent } from "@tiptap/core";
import { componentRegions, type MdxAttribute } from "@fumadocs-editor/core";
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
import { content, contentClass } from "./styles/content";
import { consts } from "./styles/consts.stylex";
import { chrome } from "./styles/shared";

/**
 * Same DOM shape and classes as the live editor (`.react-renderer` /
 * `data-node-view-*` shells) so the swap has no visible shift.
 */

type SpecMap = Map<string, UiComponentSpec>;

const MediaContext = createContext<MediaProvider | undefined>(undefined);

function StaticImg({ node }: { node: JSONContent }) {
  const media = useContext(MediaContext);
  return (
    <img
      className={contentClass.image}
      src={resolveSrc(media, String(node.attrs?.src ?? ""))}
      alt={(node.attrs?.alt as string) ?? ""}
      title={(node.attrs?.title as string) ?? undefined}
    />
  );
}

const noop = () => {};

export class RenderBoundary extends ReactComponent<
  { resetOn?: unknown; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetOn?: unknown }) {
    if (this.state.failed && prev.resetOn !== this.props.resetOn) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const styles = stylex.create({
  fallback: {
    boxSizing: "border-box",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border,
    paddingInline: "0.75rem",
    paddingBlock: "0.625rem",
  },
  fallbackName: {
    marginBottom: "0.25rem",
    fontFamily: consts.mono,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  wrapper: { whiteSpace: "normal" },
  hole: { whiteSpace: "pre-wrap" },
  holeInner: { whiteSpace: "inherit" },
  codeLang: {
    paddingInline: "0.375rem",
    fontSize: 12,
    lineHeight: "1rem",
    fontWeight: 500,
  },
  spacer: { flex: 1 },
  root: { whiteSpace: "pre-wrap" },
});

export function FallbackCard({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-component-fallback="" {...stylex.props(styles.fallback)}>
      <div {...stylex.props(chrome.static, styles.fallbackName)} contentEditable={false}>
        {`<${name}>`}
      </div>
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
        out = <code className={contentClass.code}>{out}</code>;
        break;
      case "link":
        out = (
          <a
            className={contentClass.link}
            href={mark.attrs?.href as string}
            title={(mark.attrs?.title as string) ?? undefined}
          >
            {out}
          </a>
        );
        break;
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function renderChildren(
  nodes: JSONContent[] | undefined,
  specs: SpecMap,
  parent?: UiComponentSpec,
): ReactNode {
  if (!nodes || nodes.length === 0) return null;
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(renderNode(nodes[i], specs, i, parent));
  return out;
}

/** the per-node shell @tiptap/react wraps every React node view in */
function Shell({
  type,
  className,
  children,
}: {
  type: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        className ? `react-renderer node-${type} ${className}` : `react-renderer node-${type}`
      }
    >
      {children}
    </div>
  );
}

/** static twin of NodeViewContent + its inner React content wrapper */
function ContentHole({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(content.hole, styles.hole)} data-fde-hole="" data-node-view-content="">
      <div {...stylex.props(styles.holeInner)} data-node-view-content-react="">
        {children}
      </div>
    </div>
  );
}

function Component({
  node,
  spec,
  specs,
}: {
  node: JSONContent;
  spec: UiComponentSpec;
  specs: SpecMap;
}) {
  const attributes = (node.attrs?.attributes ?? []) as MdxAttribute[];
  const children = renderChildren(node.content, specs, spec);

  const Render = spec.render;
  return (
    <Shell type={node.type!} className={contentClass.component}>
      <div
        data-node-view-wrapper=""
        data-component={spec.name}
        {...stylex.props(content.nodeWrapper, styles.wrapper)}
      >
        <RenderBoundary
          fallback={
            <FallbackCard name={spec.name}>
              <ContentHole>{children}</ContentHole>
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
            <ContentHole>{children}</ContentHole>
          </Render>
        </RenderBoundary>
      </div>
    </Shell>
  );
}

function Region({
  node,
  specs,
  kind,
  parent,
  index,
}: {
  node: JSONContent;
  specs: SpecMap;
  kind: "inline" | "block";
  parent: UiComponentSpec;
  index: number;
}) {
  const { region } = componentRegions(parent, specs)[index];
  const sx = stylex.props(content.region, kind === "block" && content.regionBlock, styles.wrapper);
  const own = parent.regions?.[region];
  return (
    <Shell type={node.type!}>
      <div
        data-node-view-wrapper=""
        className={own ? `${sx.className} ${own}` : sx.className}
        data-region={region}
      >
        <ContentHole>{renderChildren(node.content, specs)}</ContentHole>
      </div>
    </Shell>
  );
}

function StaticCodeBlock({ node }: { node: JSONContent }) {
  const language = (node.attrs?.language as string | null) ?? "";
  return (
    <Shell type="codeBlock" className={contentClass.block}>
      <figure
        data-node-view-wrapper=""
        dir="ltr"
        {...stylex.props(content.codeBlock, styles.wrapper)}
      >
        <div {...stylex.props(content.codeHeader)}>
          <SquareCode size={15} {...stylex.props(content.codeHeaderIcon)} />
          <div {...stylex.props(styles.spacer)} />
          <span {...stylex.props(styles.codeLang)}>{language || "plaintext"}</span>
        </div>
        <div {...stylex.props(content.codeScroll)}>
          <pre {...stylex.props(content.codePre)}>
            <code {...stylex.props(content.codeCode, styles.hole)} data-node-view-content="">
              {node.content?.[0]?.text ?? ""}
            </code>
          </pre>
        </div>
      </figure>
    </Shell>
  );
}

function renderNode(
  node: JSONContent,
  specs: SpecMap,
  key: number,
  parent?: UiComponentSpec,
): ReactNode {
  const children = () => renderChildren(node.content, specs);
  const spec = specs.get(node.type!);
  if (spec) return <Component key={key} node={node} spec={spec} specs={specs} />;
  switch (node.type) {
    case "text":
      return renderMarks(node, key);
    case "paragraph":
      return (
        <p key={key} className={contentClass.paragraph}>
          {children()}
        </p>
      );
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const Tag = `h${level}` as "h1";
      return (
        <Tag
          key={key}
          className={contentClass.heading(level)}
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
      return (
        <ul key={key} className={contentClass.bulletList}>
          {children()}
        </ul>
      );
    case "orderedList":
      return (
        <ol
          key={key}
          className={contentClass.orderedList}
          start={(node.attrs?.start as number) ?? undefined}
        >
          {children()}
        </ol>
      );
    case "listItem":
      return (
        <li key={key} className={contentClass.listItem}>
          {children()}
        </li>
      );
    case "taskList":
      return (
        <ul key={key} className={contentClass.taskList} data-type="taskList">
          {children()}
        </ul>
      );
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return (
        <li key={key} className={contentClass.taskItem} data-type="taskItem" data-checked={checked}>
          <label>
            <input type="checkbox" defaultChecked={checked} disabled />
          </label>
          <div>{children()}</div>
        </li>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className={contentClass.blockquote}>
          {children()}
        </blockquote>
      );
    case "horizontalRule":
      return <hr key={key} className={contentClass.horizontalRule} />;
    case "image":
      return <StaticImg key={key} node={node} />;
    case "table":
      return (
        <div key={key} className="tableWrapper">
          <table className={contentClass.table}>
            <tbody>{children()}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{children()}</tr>;
    case "tableHeader":
      return (
        <th
          key={key}
          className={contentClass.tableHeader}
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
          className={contentClass.tableCell}
          colSpan={node.attrs?.colspan as number}
          rowSpan={node.attrs?.rowspan as number}
        >
          {children()}
        </td>
      );
    case "codeBlock":
      return <StaticCodeBlock key={key} node={node} />;
    case "mathInline":
      return (
        <span key={key} className="react-renderer node-mathInline">
          <span {...stylex.props(content.mathInline)} data-node-view-wrapper="">
            <span {...stylex.props(content.mathInlineSrc)}>
              <span data-node-view-content="">{node.content?.[0]?.text ?? ""}</span>
            </span>
          </span>
        </span>
      );
    case "mathBlock":
      return (
        <Shell key={key} type="mathBlock" className={contentClass.block}>
          <div data-node-view-wrapper="" {...stylex.props(content.mathBlock, styles.wrapper)}>
            <pre {...stylex.props(content.mathBlockSrc)}>
              <code {...stylex.props(styles.hole)} data-node-view-content="">
                {node.content?.[0]?.text ?? ""}
              </code>
            </pre>
          </div>
        </Shell>
      );
    case "mdxInlineRegion":
    case "mdxBlockRegion":
      return (
        <Region
          key={key}
          node={node}
          specs={specs}
          kind={node.type === "mdxInlineRegion" ? "inline" : "block"}
          parent={parent!}
          index={key}
        />
      );
    case "mdxJsxFlowElement":
      return (
        <div
          key={key}
          className={contentClass.mdxJsxFlowElement}
          data-mdx-flow=""
          data-component={(node.attrs?.name as string) ?? "Fragment"}
        >
          {children()}
        </div>
      );
    case "mdxJsxTextElement":
      return (
        <span
          key={key}
          className={contentClass.mdxJsxTextElement}
          data-mdx-inline=""
          data-component={(node.attrs?.name as string) ?? "Fragment"}
        >
          {children()}
        </span>
      );
    case "mdxTextExpression":
      return (
        <code key={key} className={contentClass.mdxTextExpression} data-mdx-expression="">
          {`{${String(node.attrs?.value ?? "")}}`}
        </code>
      );
    case "verbatimInline":
      return (
        <code key={key} className={contentClass.verbatimInline} data-mdx-verbatim="">
          {String(node.attrs?.value ?? "")}
        </code>
      );
    case "mdxFlowExpression":
    case "mdxjsEsm":
    case "frontmatter":
    case "verbatim":
      return (
        <pre key={key} className={contentClass[node.type]}>
          <code>{String(node.attrs?.value ?? "")}</code>
        </pre>
      );
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
      <div
        className={`ProseMirror ${stylex.props(content.root, styles.root).className}`}
        aria-label="Loading editor"
      >
        {renderChildren(doc.content, specs)}
      </div>
    </MediaContext.Provider>
  );
}
