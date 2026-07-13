'use client';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  createRegistry,
  editorExtensions,
  parseMdxToDoc,
  serializeDocToMdx,
  type DocSnapshot,
} from '@fumadocs-editor/core';
import type { JSONContent } from '@tiptap/core';
import { Tabs } from '@base-ui/react/tabs';
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { EditorToolbar } from './toolbar';
import { componentExtensions } from './components/node-views';
import { codeBlockExtension } from './components/code-block';
import type { UiComponentSpec } from './components/spec';
import { focusRing } from './components/styles';
import { useEditorTheme, type EditorTheme } from './theme';
import { cn } from './utils/cn';

export interface MdxEditorRef {
  getMarkdown: () => string;
}

export interface MdxEditorProps {
  /** initial MDX source */
  defaultValue?: string;
  /** fires with the serialized MDX after each change */
  onMarkdownChange?: (markdown: string) => void;
  /** MDX components to render as WYSIWYG nodes with editable regions */
  components?: UiComponentSpec[];
  /**
   * Scope the editor to a fixed colour theme. When omitted, the editor inherits
   * the ambient theme — an {@link EditorThemeProvider}, a `next-themes` `.dark`
   * class, or the OS preference — which is what a real fumadocs site wants.
   */
  theme?: EditorTheme;
  className?: string;
  ref?: Ref<MdxEditorRef>;
}

type Mode = 'visual' | 'source';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const modeTabCls =
  `cursor-pointer rounded-md px-3 py-0.5 text-[12.5px] font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground data-[selected]:bg-fd-background data-[selected]:text-fd-foreground data-[selected]:shadow-sm ${focusRing}`;

export function MdxEditor({
  defaultValue = '',
  onMarkdownChange,
  components,
  theme,
  className,
  ref,
}: MdxEditorProps) {
  const registry = useMemo(() => createRegistry(components ?? []), [components]);
  const ambient = useEditorTheme();
  // an explicit `theme` prop wins; otherwise stay unscoped so the editor
  // inherits the provider / next-themes / OS theme from an ancestor.
  const scoped = theme === 'system' ? ambient.resolvedTheme : theme;

  const [initial] = useState(() => {
    try {
      return { ...parseMdxToDoc(defaultValue, registry), error: null as string | null };
    } catch (error) {
      return { doc: EMPTY_DOC, snapshot: undefined, error: String(error) };
    }
  });

  const snapshotRef = useRef<DocSnapshot | undefined>(initial.snapshot);
  const [mode, setMode] = useState<Mode>(initial.error ? 'source' : 'visual');
  const [source, setSource] = useState(initial.error ? defaultValue : '');
  const [sourceError, setSourceError] = useState(initial.error);

  const onChangeRef = useRef(onMarkdownChange);
  useEffect(() => {
    onChangeRef.current = onMarkdownChange;
  });

  const extensions = useMemo(
    () => [
      ...editorExtensions({ componentNodes: false, codeBlock: false }),
      codeBlockExtension(),
      ...componentExtensions(components ?? []),
    ],
    [components],
  );

  const editor = useEditor({
    extensions,
    content: initial.doc,
    onUpdate({ editor }) {
      onChangeRef.current?.(serializeDocToMdx(editor.getJSON(), snapshotRef.current, registry));
    },
  });

  const getMarkdown = () => {
    if (mode === 'source' || !editor) return source;
    return serializeDocToMdx(editor.getJSON(), snapshotRef.current, registry);
  };

  useImperativeHandle(ref, () => ({ getMarkdown }));

  function switchMode(next: Mode) {
    if (next === mode || !editor) return;

    if (next === 'source') {
      setSource(serializeDocToMdx(editor.getJSON(), snapshotRef.current, registry));
      setMode('source');
      return;
    }

    try {
      const parsed = parseMdxToDoc(source, registry);
      snapshotRef.current = parsed.snapshot;
      editor.commands.setContent(parsed.doc);
      setSourceError(null);
      setMode('visual');
    } catch (error) {
      setSourceError(String(error));
    }
  }

  return (
    <div
      className={cn(
        scoped,
        'flex flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-background text-fd-foreground text-[15px] leading-relaxed shadow-sm focus-within:border-fd-ring/60',
        className,
      )}
    >
      <Tabs.Root value={mode} onValueChange={(value) => switchMode(value as Mode)}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fd-border bg-fd-card/40 px-2 py-1.5">
          <EditorToolbar editor={editor} components={components} disabled={mode !== 'visual'} />
          <Tabs.List className="flex gap-0.5 rounded-lg border border-fd-border bg-fd-muted p-0.5">
            <Tabs.Tab className={modeTabCls} value="visual">
              Visual
            </Tabs.Tab>
            <Tabs.Tab className={modeTabCls} value="source">
              MDX
            </Tabs.Tab>
          </Tabs.List>
        </div>
      </Tabs.Root>
      {mode === 'visual' ? (
        <EditorContent editor={editor} className="fde-content" />
      ) : (
        <div className="flex flex-1 flex-col">
          {sourceError != null && (
            <div className="border-b border-fd-border bg-fd-error/10 px-5 py-2.5 font-mono text-[13px] whitespace-pre-wrap text-fd-error">
              {sourceError}
            </div>
          )}
          <textarea
            className="min-h-[420px] flex-1 resize-y bg-fd-background px-5 py-4 font-mono text-[13px] leading-relaxed text-fd-foreground outline-none [tab-size:2] focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-fd-ring/40"
            value={source}
            spellCheck={false}
            onChange={(event) => {
              setSource(event.target.value);
              onChangeRef.current?.(event.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
