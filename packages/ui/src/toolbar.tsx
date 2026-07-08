'use client';
// side-effect imports: register the extension packages' command typings,
// which are lost when @fumadocs-editor/core bundles its declarations
import '@tiptap/starter-kit';
import '@tiptap/extension-list';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { Toolbar } from '@base-ui/react/toolbar';
import { Tooltip } from '@base-ui/react/tooltip';
import { Select } from '@base-ui/react/select';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Redo2,
  Strikethrough,
  TextQuote,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';

const BLOCK_ITEMS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'codeBlock', label: 'Code block' },
];

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  block: string;
  canUndo: boolean;
  canRedo: boolean;
}

function ActionButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Toolbar.Button
            className="fde-tb"
            data-active={active || undefined}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Toolbar.Button>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="fde-tooltip">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function EditorToolbar({
  editor,
  disabled = false,
}: {
  editor: Editor | null;
  disabled?: boolean;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }): ToolbarState | null => {
      if (!current) return null;
      let block = 'p';
      for (const level of [1, 2, 3]) {
        if (current.isActive('heading', { level })) block = `h${level}`;
      }
      if (current.isActive('codeBlock')) block = 'codeBlock';
      return {
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        strike: current.isActive('strike'),
        code: current.isActive('code'),
        bulletList: current.isActive('bulletList'),
        orderedList: current.isActive('orderedList'),
        taskList: current.isActive('taskList'),
        blockquote: current.isActive('blockquote'),
        block,
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });

  const off = disabled || !editor || !state;
  const run = (fn: (chain: ReturnType<Editor['chain']>) => { run: () => boolean }) => {
    if (editor) fn(editor.chain().focus()).run();
  };

  function setBlock(value: string) {
    if (value === 'p') run((c) => c.setParagraph());
    else if (value === 'codeBlock') run((c) => c.toggleCodeBlock());
    else run((c) => c.toggleHeading({ level: Number(value[1]) as 1 | 2 | 3 }));
  }

  return (
    <Tooltip.Provider>
      <Toolbar.Root className="fde-toolbar">
        <Select.Root
          items={BLOCK_ITEMS}
          value={state?.block ?? 'p'}
          onValueChange={(value) => setBlock(value as string)}
          disabled={off}
        >
          <Select.Trigger className="fde-select-trigger">
            <Select.Value />
            <ChevronDown size={14} />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner sideOffset={4}>
              <Select.Popup className="fde-popup">
                {BLOCK_ITEMS.map((item) => (
                  <Select.Item key={item.value} value={item.value} className="fde-item">
                    <Select.ItemIndicator className="fde-item-indicator">
                      <Check size={14} />
                    </Select.ItemIndicator>
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>

        <Toolbar.Separator className="fde-sep" />

        <Toolbar.Group className="fde-group">
          <ActionButton label="Bold" active={state?.bold} disabled={off} onClick={() => run((c) => c.toggleBold())}>
            <Bold size={16} />
          </ActionButton>
          <ActionButton label="Italic" active={state?.italic} disabled={off} onClick={() => run((c) => c.toggleItalic())}>
            <Italic size={16} />
          </ActionButton>
          <ActionButton label="Strikethrough" active={state?.strike} disabled={off} onClick={() => run((c) => c.toggleStrike())}>
            <Strikethrough size={16} />
          </ActionButton>
          <ActionButton label="Inline code" active={state?.code} disabled={off} onClick={() => run((c) => c.toggleCode())}>
            <Code size={16} />
          </ActionButton>
        </Toolbar.Group>

        <Toolbar.Separator className="fde-sep" />

        <Toolbar.Group className="fde-group">
          <ActionButton label="Bullet list" active={state?.bulletList} disabled={off} onClick={() => run((c) => c.toggleBulletList())}>
            <List size={16} />
          </ActionButton>
          <ActionButton label="Ordered list" active={state?.orderedList} disabled={off} onClick={() => run((c) => c.toggleOrderedList())}>
            <ListOrdered size={16} />
          </ActionButton>
          <ActionButton label="Task list" active={state?.taskList} disabled={off} onClick={() => run((c) => c.toggleTaskList())}>
            <ListTodo size={16} />
          </ActionButton>
          <ActionButton label="Blockquote" active={state?.blockquote} disabled={off} onClick={() => run((c) => c.toggleBlockquote())}>
            <TextQuote size={16} />
          </ActionButton>
          <ActionButton label="Divider" disabled={off} onClick={() => run((c) => c.setHorizontalRule())}>
            <Minus size={16} />
          </ActionButton>
        </Toolbar.Group>

        <Toolbar.Separator className="fde-sep" />

        <Toolbar.Group className="fde-group">
          <ActionButton label="Undo" disabled={off || !state?.canUndo} onClick={() => run((c) => c.undo())}>
            <Undo2 size={16} />
          </ActionButton>
          <ActionButton label="Redo" disabled={off || !state?.canRedo} onClick={() => run((c) => c.redo())}>
            <Redo2 size={16} />
          </ActionButton>
        </Toolbar.Group>
      </Toolbar.Root>
    </Tooltip.Provider>
  );
}
