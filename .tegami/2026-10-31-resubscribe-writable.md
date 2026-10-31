---
packages:
  "@fumadocs-editor/core": minor
  "@fumadocs-editor/ui": minor
---

### Write access is reported again after a reconnect

The client re-subscribes every open document after a reconnect, and the
server's answer carries `writable`, but only the first answer reached the
host. When access changed between connections, for example the person signed
in again as a reader, the editor stayed editable and every autosave was
refused and retried.

- `SyncDocument.writable()` follows the latest answer, and `subscribe`
  listeners hear when it changes.
- A file document does not save while it is not writable; its edits stay
  local and are saved once write access comes back.
- `sync.onWritable` in `@fumadocs-editor/ui` reports a change after the
  document opened; the value at opening still comes in `onOpen`.
- `MdxEditor.Status` shows **Read only** (or **Read only, not saved** with
  pending edits) while the document is not writable, and `useSyncStatus()`
  returns `writable`.
