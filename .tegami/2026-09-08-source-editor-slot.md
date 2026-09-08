---
packages:
  "@fumadocs-editor/ui": minor
---

### Compose the editor from parts

`MdxEditor` is now a preset over exported parts: `MdxEditor.Root` owns the
document (parse, sync, collab, the ref) and renders no chrome;
`MdxEditor.Visual`, `MdxEditor.Source`, `MdxEditor.Status` and
`MdxEditor.Tabs` render inside it, in any layout, both surfaces at once if
you want a split view. `useSourceText()`, `useSyncStatus()` and
`useEditorMode()` back chrome of your own, a CodeMirror source pane for
example.

The document is the truth and the source is a projection: visual edits
serialize into the text, text edits parse back into the document, and text
that does not parse leaves the document alone and reports the error.

Under the hood the root is now a plain document store; the parts and hooks
subscribe to it, so a source-only or a split host pays for nothing it does
not render.
