# fumadocs-editor

A WYSIWYG editor for Fumadocs MDX content. Documents render as an editable
page — prose, code, tables, and MDX components in place — and serialize back
losslessly: blocks you didn't touch are emitted byte-for-byte.

| Package                                  |                                                    |
| ---------------------------------------- | -------------------------------------------------- |
| [`@fumadocs-editor/ui`](packages/ui)     | the React editor component                         |
| [`@fumadocs-editor/core`](packages/core) | headless engine: parse, serialize, component specs |
| [`@fumadocs-editor/sync`](packages/sync) | FS mirror, collaboration, auth layer               |

Documentation lives in [`apps/docs`](apps/docs); a live playground in
[`apps/playground`](apps/playground).

## Development

```bash
pnpm install
pnpm dev          # playground with the FS mirror on docs/
pnpm test
pnpm build        # includes the playground size-budget assertions
```

## License

MIT
