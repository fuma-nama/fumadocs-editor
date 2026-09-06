import { defineConfig } from "vitest/config";

// one vitest run for the workspace: each package keeps its own config
// (environment, source aliases) and shows up as a named project
export default defineConfig({
  test: {
    projects: ["packages/core", "packages/ui"],
  },
});
