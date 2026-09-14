const SLOP = 4;
const EDGE = 40;
const SCROLL_STEP = 6;

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

export interface DragOptions {
  /** the tree root; the drop line is placed inside it */
  root: HTMLElement;
  /** the folder's list: its direct `li[data-index]` children are the slots */
  list: HTMLElement;
  from: number;
  /** pointer capture target */
  handle: HTMLElement;
  line: HTMLElement;
  onLift(): void;
  /** the slot released over: `to` rows come before it */
  onDrop(to: number): void;
}

/**
 * Drag a row within its folder. Past a few pixels the row lifts and a line
 * marks the slot under the pointer; the nearest scroll container scrolls
 * near its edges. Plain DOM: the pointer moves every frame and React has
 * nothing to say about it until the drop.
 */
export function dragRow(
  event: PointerEvent,
  { root, list, from, handle, line, onLift, onDrop }: DragOptions,
) {
  const items = list.querySelectorAll<HTMLElement>(":scope > li[data-index]");
  const rows: HTMLElement[] = [];
  for (const item of items) rows.push(item.querySelector<HTMLElement>("[data-row]")!);
  const indent = parseFloat(
    getComputedStyle(rows[0].querySelector<HTMLElement>("[data-item]")!).paddingInlineStart,
  );
  const scroller = scrollParent(root);
  const { pointerId, clientX: startX, clientY: startY } = event;
  let y = startY;
  let lifted = false;
  let target = -1;
  let scrolling = 0;

  const place = () => {
    let to = 0;
    for (const row of rows) {
      if (y > row.getBoundingClientRect().top + row.offsetHeight / 2) to++;
    }
    target = to;
    const valid = to !== from && to !== from + 1;
    line.hidden = !valid;
    if (!valid) return;
    const edge = rows[Math.min(to, rows.length - 1)].getBoundingClientRect();
    const box = root.getBoundingClientRect();
    line.style.top = `${(to < rows.length ? edge.top : edge.bottom) - box.top - 1}px`;
    line.style.left = `${edge.left - box.left + indent}px`;
    line.style.width = `${edge.width - indent}px`;
  };
  const scroll = () => {
    const box = scroller!.getBoundingClientRect();
    const dy = y < box.top + EDGE ? -SCROLL_STEP : y > box.bottom - EDGE ? SCROLL_STEP : 0;
    if (!dy) return void (scrolling = 0);
    scroller!.scrollBy(0, dy);
    place();
    scrolling = requestAnimationFrame(scroll);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    y = e.clientY;
    if (!lifted) {
      if (Math.abs(e.clientX - startX) < SLOP && Math.abs(y - startY) < SLOP) return;
      lifted = true;
      rows[from].setAttribute("data-lifted", "");
      root.setAttribute("data-dragging", "");
      onLift();
    }
    place();
    if (scroller && !scrolling) scrolling = requestAnimationFrame(scroll);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    handle.removeEventListener("lostpointercapture", end);
    cancelAnimationFrame(scrolling);
    if (!lifted) return;
    rows[from].removeAttribute("data-lifted");
    root.removeAttribute("data-dragging");
    const valid = !line.hidden;
    line.hidden = true;
    if (e.type === "pointerup" && valid) onDrop(target);
  };
  handle.setPointerCapture(pointerId);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("lostpointercapture", end);
}
