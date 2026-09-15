import type { SyncTransport } from "@fumadocs-editor/core/sync";

// a backend running in a worker, speaking the protocol over postMessage
export function workerTransport(url: URL): SyncTransport {
  return {
    connect(listener) {
      const worker = new Worker(url, { type: "module" });
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        worker.terminate();
        listener.close();
      };
      worker.onmessage = (event) => listener.message(event.data);
      worker.onerror = close;
      queueMicrotask(() => listener.open());
      return {
        send(message) {
          if (open) worker.postMessage(message);
        },
        close,
      };
    },
  };
}
