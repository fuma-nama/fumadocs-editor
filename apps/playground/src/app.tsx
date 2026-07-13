import { useState } from 'react';
import {
  MdxEditor,
  EditorThemeProvider,
  useEditorTheme,
  fumadocsUiComponents,
} from '@fumadocs-editor/ui';
import { Moon, Sun } from 'lucide-react';
import sample from './sample.mdx?raw';

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useEditorTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-fd-border bg-fd-card text-fd-muted-foreground transition-colors hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
    >
      {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Playground() {
  const [markdown, setMarkdown] = useState(sample);
  const identical = markdown === sample;

  return (
    <main className="mx-auto max-w-[840px] px-5 pt-12 pb-24">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight">fumadocs editor</h1>
          <p className="text-[13px] text-fd-muted-foreground">
            WYSIWYG MDX editing with real fumadocs-ui components
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
              identical
                ? 'border-fd-success/30 bg-fd-success/15 text-fd-success'
                : 'border-fd-warning/30 bg-fd-warning/15 text-fd-warning'
            }`}
          >
            {identical ? 'round-trip: byte-identical' : 'modified'}
          </span>
          <ThemeToggle />
        </div>
      </header>
      <MdxEditor
        defaultValue={sample}
        components={fumadocsUiComponents}
        onMarkdownChange={setMarkdown}
      />
      <details className="mt-6 text-[13px]">
        <summary className="cursor-pointer text-fd-muted-foreground select-none">
          Serialized MDX output
        </summary>
        <pre className="mt-2.5 overflow-x-auto rounded-xl border border-fd-border bg-fd-card p-4 font-mono text-[12.5px] leading-relaxed">
          {markdown}
        </pre>
      </details>
    </main>
  );
}

export function App() {
  return (
    <EditorThemeProvider className="min-h-screen bg-fd-background text-fd-foreground">
      <Playground />
    </EditorThemeProvider>
  );
}
