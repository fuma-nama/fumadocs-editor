---
packages:
  "@fumadocs-editor/core": minor
---

### Keep the synced files anywhere with `storage`

Every file the sync server reads or writes now goes through one `SyncStorage`:
list, read, write, delete and an optional `watch`. `root` is shorthand for
`storage: fsStorage(root)`. Pass your own to use a database or a bucket, or
wrap `fsStorage`. `read` may stream, so a large file never sits in memory:
assets stream, titles come from the first 4 KB, and a file changed outside the
server is read only while an editor has it open.

### Storage fixes

- An outside change back to the text the server last wrote was ignored.
- Reads could see a file the server was halfway through writing.
- A collab save that failed was never retried.
- `meta.json` was rewritten outside the per-file lock, so a save could be lost.
- Deleting a page while someone opened it could bring it back.
- Two uploads of one name in the same millisecond replaced one another.
- `.env` and other dot or `node_modules` paths could be read and written
  through the file resource and the asset endpoint. They are now refused.
- Errors no longer show the server's paths.
