import { defineConfig } from "@fumadocs-editor/studio";

export default defineConfig({
  root: "docs",
  port: 5200,
  syntax: { math: true },
  server: {
    // playground auth: ?token=editor / ?token=viewer / anything else
    // (denied). No token = full access. Isomorphic, so it can stay inline.
    authenticate: ({ payload }) => {
      if (payload === undefined) return { write: true };
      if (payload === "editor") return { user: { name: "Editor", color: "#2563eb" }, write: true };
      if (payload === "viewer") return { user: { name: "Viewer", color: "#059669" }, write: false };
      return null;
    },
  },
});
