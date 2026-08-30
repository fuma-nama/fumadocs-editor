// jsdom has no layout: ProseMirror's endOfTextblock probes client rects, which
// Range doesn't implement there. Empty rects make it degrade gracefully.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = emptyRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
