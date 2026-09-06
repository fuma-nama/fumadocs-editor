## @fumadocs-editor/core@0.1.0

### Initial release

WYSIWYG editor for Fumadocs MDX.

- **`@fumadocs-editor/ui`**: React editor. Prose, code, tables, MDX
  components in place. Slash menu, selection toolbar, mobile bar. Untouched
  blocks serialize byte-for-byte. Custom components: spec + renderer.
- **`@fumadocs-editor/core`**: parse, incremental serialize, component specs,
  dialects (math, directive admonitions, files fences, heading suffixes). FS
  mirror with CAS autosave and block-level merge, Yjs collab, server auth with
  per-doc scopes.
