# @fumadocs-editor/ui

WYSIWYG editor for Fumadocs MDX. Prose, code, tables, and MDX components
render as an editable page. Untouched blocks serialize byte-for-byte.

```bash
npm install @fumadocs-editor/ui
```

```css
/* app.css */
@import "@fumadocs-editor/ui/styles.css";
```

```tsx
import { MdxEditor } from "@fumadocs-editor/ui";

<MdxEditor defaultValue={source} onChange={save} />;

<MdxEditor sync={{ path: "docs/index.mdx" }} />;
```

Docs live in the [fumadocs-editor repo](https://github.com/fuma-nama/fumadocs-editor)
(`apps/docs`).
