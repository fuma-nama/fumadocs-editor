import { defineConfig } from "vite";
import { editorSync } from "@fumadocs-editor/core/vite";
import { authenticate } from "./auth-cookie";

declare const sessions: { onEnd(listener: (id: string) => void): () => void };
declare function sessionOf(cookie: string | undefined): string | undefined;

export default defineConfig({
  plugins: [
    editorSync({
      root: "content/docs",
      authenticate,
      setup(sync) {
        // `authenticate` refuses an ended session, so the reconnect is refused too
        return sessions.onEnd((session) => {
          for (const connection of sync.connections()) {
            if (sessionOf(connection.request.headers.cookie) === session) connection.close();
          }
        });
      },
    }),
  ],
});
