import { defineConfig } from "vite";
import { editorSync } from "@fumadocs-editor/core/vite";

declare function record(entry: { user?: string; path: string; at: Date }): void;

export default defineConfig({
  plugins: [
    editorSync({
      root: "content/docs",
      setup(sync) {
        // returns the unsubscribe, which runs when the server closes
        return sync.onChange(({ path, connection }) => {
          record({ user: connection.user?.name, path, at: new Date() });
        });
      },
    }),
  ],
});
