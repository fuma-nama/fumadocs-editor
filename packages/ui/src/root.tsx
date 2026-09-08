"use client";
import * as stylex from "@stylexjs/stylex";
import type { SyntaxOptions } from "@fumadocs-editor/core/parse";
import { useEffect, useImperativeHandle, useMemo, useState, type ReactNode, type Ref } from "react";
import { EditorContext, useDocumentState, useEditorContext } from "./components/context";
import { fumadocsUiComponents } from "./components/fumadocs-ui";
import type { FileProvider, MediaProvider } from "./components/media";
import type { UiComponentSpec } from "./components/spec";
import { DocumentStore, type MdxEditorRef, type MdxEditorSync } from "./store";
import { useEditorTheme, type EditorTheme } from "./theme";

export interface MdxEditorRootProps {
  /** initial MDX; with `sync`, the file content is used instead */
  defaultValue?: string;
  /** serialized MDX after each change (debounced) */
  onChange?: (markdown: string) => void;
  /** editable MDX components; defaults to fumadocs-ui. Fixed for the life of the root */
  components?: UiComponentSpec[];
  /**
   * Parse-level dialects beyond component specs, e.g. `{ math: true }`.
   * Combined with `components` into the document's `Syntax`.
   */
  syntax?: SyntaxOptions;
  /**
   * Sync with a file: autosave, live merge of disk edits, conflict chip,
   * optional collab.
   */
  sync?: MdxEditorSync;
  /**
   * Reuse a parsed document across mounts (small LRU). Default: `sync.path`.
   */
  cacheKey?: string;
  /**
   * Pin a colour theme. Omit to inherit {@link EditorThemeProvider},
   * `next-themes` `.dark`, or the OS preference.
   */
  theme?: EditorTheme;
  /** uploads and display URL resolution */
  media?: MediaProvider;
  /** include paths, page links */
  files?: FileProvider;
  /**
   * TipTap passthrough, default true. `false`: read-only, no mutating
   * chrome. Does not enforce auth; wire scope `writable` in yourself.
   */
  editable?: boolean;
  ref?: Ref<MdxEditorRef>;
  children?: ReactNode;
}

const styles = stylex.create({ root: { display: "contents" } });

/**
 * Owns the document: parse, snapshot, serializer, sync session, collab, and
 * the ref API. Renders no chrome; compose `MdxEditor.Visual`,
 * `MdxEditor.Source`, `MdxEditor.Status` and `MdxEditor.Tabs` inside it, or
 * your own through the hooks.
 */
export function MdxEditorRoot({
  defaultValue = "",
  onChange,
  components = fumadocsUiComponents,
  syntax,
  sync,
  cacheKey,
  theme,
  media,
  files,
  editable = true,
  ref,
  children,
}: MdxEditorRootProps) {
  const options = { defaultValue, sync, cacheKey, onChange };
  const [store] = useState(() => new DocumentStore(components, syntax, options));
  store.options = options;
  store.media = media;
  store.files = files;
  useImperativeHandle(ref, () => store.handle, [store]);

  const path = sync?.path;
  const transport = sync?.transport;
  const collab = Boolean(sync?.collab);
  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store, path, transport, collab]);

  const ambient = useEditorTheme();
  const scoped = theme === "system" ? ambient.resolvedTheme : theme;
  const context = useMemo(
    () => ({ store, editable, media, files }),
    [store, editable, media, files],
  );

  let rootClass = stylex.props(styles.root).className!;
  if (scoped) rootClass += ` ${scoped}`;

  return (
    <EditorContext.Provider value={context}>
      <div
        data-fde-root=""
        className={rootClass}
        onKeyDown={(event) => {
          if (sync && (event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            store.flush();
          }
        }}
      >
        {children}
      </div>
    </EditorContext.Provider>
  );
}

/** the preset's surface and the switch between them */
export function useEditorMode() {
  const { store } = useEditorContext();
  const { mode, sourceError } = useDocumentState();
  return {
    mode,
    setMode: store.setMode,
    /** the visual surface cannot show text that does not parse */
    canShowVisual: sourceError === null,
    /** under collab, a lone source surface cannot reach the shared document */
    canShowSource: !store.options.sync?.collab,
  };
}

/** session status and the conflict resolutions; null without `sync` */
export function useSyncStatus() {
  const { store } = useEditorContext();
  const { status } = useDocumentState();
  return status === null
    ? null
    : { status, keepMine: store.keepMine, takeDisk: store.takeDisk, flush: store.flush };
}

/**
 * The document as text, for a source surface of your own. Visual edits
 * serialize into it; text edits parse back into the document once they
 * parse, and until then only report the error.
 */
export function useSourceText() {
  const { store, editable } = useEditorContext();
  const { text, sourceError } = useDocumentState();
  return { value: text, onChange: store.setSourceText, error: sourceError, readOnly: !editable };
}
