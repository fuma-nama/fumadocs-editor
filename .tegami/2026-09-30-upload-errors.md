---
packages:
  "@fumadocs-editor/ui": patch
---

### Report failed uploads

`MediaProvider` has an optional `onError(error, file)`, called when `upload`
rejects from paste, drop, the slash menu or the image panel, so the host can
show the failure. The slash menu's `/image` text is now replaced only once
the upload succeeds.
