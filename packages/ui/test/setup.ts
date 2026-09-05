// jsdom has no layout: ProseMirror's endOfTextblock probes client rects, which
// Range doesn't implement there. Empty rects make it degrade gracefully.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = emptyRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

// jsdom has no matchMedia; theme + touch chrome query it (never matches here)
if (!window.matchMedia) {
  window.matchMedia = (media: string) =>
    ({
      matches: false,
      media,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
}

// jsdom has no ResizeObserver; the bubble menu re-anchors from one
if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
