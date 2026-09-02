# fumadocs-editor

A WYSIWYG editor for Fumadocs MDX. Documents render as an editable page
(prose, code, tables, MDX components) and serialize losslessly: untouched
blocks come back byte-for-byte.

| Package                                  |                                   |
| ---------------------------------------- | --------------------------------- |
| [`@fumadocs-editor/ui`](packages/ui)     | React editor                      |
| [`@fumadocs-editor/core`](packages/core) | parse, serialize, component specs |
| [`@fumadocs-editor/sync`](packages/sync) | FS mirror, collab, auth           |

Docs: [`apps/docs`](apps/docs). Playground: [`apps/playground`](apps/playground).

## Development

```bash
pnpm install
pnpm dev          # playground with the FS mirror on docs/
pnpm test
pnpm build        # includes the playground size-budget assertions
```

## License

MIT
