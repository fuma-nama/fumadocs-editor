---
packages:
  "@fumadocs-editor/ui": minor
---

### Code block tabs

Consecutive fences with a `tab="…"` meta are one tab group, as fumadocs
renders them. The editor draws them as one box with an editable label per
tab: `⌘Enter` in a tab adds the next one, the block menu has **Add tab**,
and the slash menu has **Code tabs**. Clearing a label leaves the group.

The block menu now also edits the raw meta string, so `twoslash`,
`tab-group` and other flags no longer need the source view.
