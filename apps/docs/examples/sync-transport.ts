import { createSyncClient, type SyncTransport } from "@fumadocs-editor/core/sync";

// the sync server lives in a worker; its port is the channel
export function workerTransport(port: MessagePort): SyncTransport {
  const listeners = new Set<(data: string | Uint8Array) => void>();
  port.onmessage = (event) => {
    for (const listener of listeners) listener(event.data);
  };
  return {
    send: (data) => port.postMessage(data),
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // no `onStatus`: a port never drops
    close: () => port.close(),
  };
}

export const client = createSyncClient({ transport: workerTransport(new MessageChannel().port1) });
