---
packages:
  "@fumadocs-editor/studio": patch
---

### Studio no longer hangs on a white page

Opening the studio while a stale tab was still polling the port could leave
the page blank forever: the StyleX plugin compiled the app on every request
and, for the two style-only modules, loaded their `@stylexjs/stylex` import
through Vite's dependency optimizer, which was itself waiting for those
requests to finish before committing. The app is now compiled ahead of time
(StyleX included), so the dev server serves plain JS and CSS and neither
`@stylexjs/unplugin` nor Babel is installed with the package.
