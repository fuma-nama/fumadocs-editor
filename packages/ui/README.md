# @fumadocs-editor/ui

A WYSIWYG editor for Fumadocs MDX content: prose, code, tables, and your MDX
components rendered as an editable page, with a lossless round-trip back to
source — untouched blocks are emitted byte-for-byte.

```bash
npm install @fumadocs-editor/ui
```

```css
/* app.css — Tailwind v4 */
@import "tailwindcss";
@import "@fumadocs-editor/ui/css/preset.css";
```

```tsx
import { MdxEditor } from "@fumadocs-editor/ui";

<MdxEditor defaultValue={source} onChange={save} />;

// or, on the dev server with @fumadocs-editor/sync: autosave, live merge, collab
<MdxEditor sync={{ path: "docs/index.mdx" }} />;
```

Documentation — quick start, component authoring, sync, collaboration, auth —
lives in the [fumadocs-editor repository](https://github.com/fuma-nama/fumadocs-editor)
(`apps/docs`).
