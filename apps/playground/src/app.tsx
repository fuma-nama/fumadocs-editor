import { useState } from 'react';
import { MdxEditor, fumadocsUiComponents } from '@fumadocs-editor/ui';
import sample from './sample.mdx?raw';

export function App() {
  const [markdown, setMarkdown] = useState(sample);
  const identical = markdown === sample;

  return (
    <main className="page">
      <header className="page-header">
        <h1>fumadocs editor</h1>
        <span className={identical ? 'badge badge-ok' : 'badge badge-dirty'}>
          {identical ? 'round-trip: byte-identical' : 'modified'}
        </span>
      </header>
      <MdxEditor
        defaultValue={sample}
        components={fumadocsUiComponents}
        onMarkdownChange={setMarkdown}
      />
      <details className="output">
        <summary>Serialized MDX output</summary>
        <pre>{markdown}</pre>
      </details>
    </main>
  );
}
