---
packages:
  "@fumadocs-editor/core": minor
  "@fumadocs-editor/studio": minor
---

### Manage sync connections, and hear what they change

- `SyncServer.connections()` lists the open connections, with the `request`,
  `payload` and `user` that `authenticate` saw. `close()` ends one: the client
  reconnects and `authenticate` decides again.
- `SyncServer.onChange` reports every file a connection changes, once stored:
  saves, file tree commands, and collab edits at their debounced write.
- The `setup` option is called with the server once it exists, in
  `createSyncServer`, the Vite plugin and Studio alike. What it returns runs,
  and is awaited, when the server closes. Studio's `server` config now takes
  every sync server option.
