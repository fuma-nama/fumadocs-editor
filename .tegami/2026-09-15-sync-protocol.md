---
packages:
  "@fumadocs-editor/core": minor
  "@fumadocs-editor/ui": minor
  "@fumadocs-editor/studio": patch
---

### Sync speaks one protocol

Sync is now three layers: a transport that only carries messages, a sync
client that owns the connection (hello, reconnect, subscriptions) and the
synced state, and the server. Files, the tree and collab docs are resources
of one small protocol over one connection, documented for anyone writing a
backend or a transport. There is no client-side storage interface anymore:
a custom backend speaks the protocol.

- `wsTransport({ auth })` becomes `createSyncClient({ auth })`; a custom URL
  goes in `createSyncClient({ transport: wsTransport(url) })`.
- `sync={{ transport }}` and `useWorkspace({ transport })` take `client`
  instead. Without it, the page shares one default client.
- `sync={{ collab }}` becomes `createSyncClient({ collab })`.
- `createFileSession` becomes `client.open(path, { editor })`, returning a
  `SyncDocument`; `document.opened` resolves `{ text, writable }`. The client
  holds one document per path. `SessionStatus` is now `DocumentStatus` and
  `SyncedDocument` is `DocumentEditor`.
- `createCollabSession`, the `@fumadocs-editor/core/collab` entry and the
  `CollabUser` type are removed: `client.open` on a collab client, then
  `document.collab()`; the user type is `SyncUser`.
- `ConnectionStatus` is `connecting`, `online`, `offline` or `denied`.
