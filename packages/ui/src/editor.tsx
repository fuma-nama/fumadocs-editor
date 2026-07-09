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
import type { UiComponentSpec } from './components/spec';

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
  className?: string;
  ref?: Ref<MdxEditorRef>;
}

type Mode = 'visual' | 'source';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export function MdxEditor({
  defaultValue = '',
  onMarkdownChange,
  components,
  className,
  ref,
}: MdxEditorProps) {
  const registry = useMemo(() => createRegistry(components ?? []), [components]);

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
    () => [...editorExtensions({ componentNodes: false }), ...componentExtensions(components ?? [])],
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
    <div className={className ? `fde ${className}` : 'fde'}>
      <Tabs.Root value={mode} onValueChange={(value) => switchMode(value as Mode)}>
        <div className="fde-header">
          <EditorToolbar editor={editor} disabled={mode !== 'visual'} />
          <Tabs.List className="fde-tabs">
            <Tabs.Tab className="fde-tab" value="visual">
              Visual
            </Tabs.Tab>
            <Tabs.Tab className="fde-tab" value="source">
              MDX
            </Tabs.Tab>
          </Tabs.List>
        </div>
      </Tabs.Root>
      {mode === 'visual' ? (
        <EditorContent editor={editor} className="fde-content" />
      ) : (
        <div className="fde-source-wrap">
          {sourceError != null && <div className="fde-error">{sourceError}</div>}
          <textarea
            className="fde-source"
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
