---
packages:
  "@fumadocs-editor/core": patch
---

### Blocks after a nested list stay in their list item

An edited list is written tight, so a paragraph or other block after a
nested list inside a list item lost its blank line and re-parsed as part
of the nested list's last item. The serializer now keeps one blank line
between a nested list and the next block in the same item.
