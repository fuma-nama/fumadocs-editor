---
packages:
  "@fumadocs-editor/core": minor
  "@fumadocs-editor/ui": minor
---

### Write access is reported again after a reconnect

Only the first answer's `writable` reached the host, so a writer who came back
as a reader kept an editable editor whose saves were refused and retried.
`SyncDocument.writable()` now follows every answer, a file document holds its
saves while it is `false`, and `sync.onWritable` in `@fumadocs-editor/ui`
reports it once the document is open, then on every change.
