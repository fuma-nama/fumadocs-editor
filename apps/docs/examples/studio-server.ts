import { defineServerConfig } from "@fumadocs-editor/studio";
import tailwindcss from "@tailwindcss/vite";

export default defineServerConfig({
  // same hook as the sync server: ?token=… reaches `payload`
  authenticate: ({ payload }) => (payload === process.env.STUDIO_TOKEN ? { write: true } : null),
  upload: { maxBytes: 5 * 1024 * 1024 },
  vite: { plugins: [tailwindcss()] },
});
