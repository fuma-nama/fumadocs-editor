# fumadocs-editor

A WYSIWYG editor for Fumadocs MDX.

> [!WARNING]
> **Experimental.** This project is still in early stage, breaking changes expected for future v1 release.

| Package                                  |                                   |
| ---------------------------------------- | --------------------------------- |
| [`@fumadocs-editor/ui`](packages/ui)     | React editor                      |
| [`@fumadocs-editor/core`](packages/core) | parse, serialize, component specs |

Docs: https://editor.fumadocs.dev.

## Development

```bash
pnpm install
pnpm dev          # playground with the FS mirror on docs/
pnpm test
pnpm build        # includes the playground size-budget assertions
```

## License

MIT
