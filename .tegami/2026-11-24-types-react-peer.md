---
packages:
  "@fumadocs-editor/ui": patch
---

### Declare `@types/react` as an optional peer dependency

The published declarations import from `react`, but the package did not
declare `@types/react`, so with a strict layout (pnpm without hoisting,
Bun's isolated linker, Yarn PnP) TypeScript could not find React's types from
the package and its components became `any`. `@types/react` is now an
optional peer, so it resolves to the app's own copy.
