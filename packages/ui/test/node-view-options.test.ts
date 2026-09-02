// @vitest-environment jsdom
import { expect, test } from "vitest";
import { nodeViewOptions } from "../src/components/node-view-options";

/*
 * The DOM of a React node view, as TipTap builds it:
 *   .react-renderer            (the view's `dom`)
 *     [data-node-view-wrapper]
 *       chrome…
 *       [data-node-view-content]
 *         [data-node-view-content-react]   (the view's `contentDOM`)
 *           <p>text</p>
 */
function view() {
  const dom = document.createElement("div");
  dom.className = "react-renderer";
  dom.innerHTML =
    '<div data-node-view-wrapper=""><span class="chrome"></span>' +
    '<div data-node-view-content=""><div data-node-view-content-react=""><p>text</p></div></div></div>';
  return {
    dom,
    chrome: dom.querySelector(".chrome")!,
    content: dom.querySelector("[data-node-view-content]")!,
    contentDOM: dom.querySelector("[data-node-view-content-react]")!,
    text: dom.querySelector("p")!.firstChild!,
  };
}

const ignore = (target: Node, type = "childList") =>
  nodeViewOptions.ignoreMutation!({ mutation: { type, target } as never });

test("chrome mounts and the content element's move are the view's own", () => {
  const v = view();
  expect(ignore(v.dom)).toBe(true);
  expect(ignore(v.chrome)).toBe(true);
  expect(ignore(v.content)).toBe(true);
  expect(ignore(v.chrome, "attributes")).toBe(true);
});

test("edits inside the content element reach ProseMirror", () => {
  const v = view();
  expect(ignore(v.contentDOM)).toBe(false);
  expect(ignore(v.text, "characterData")).toBe(false);
  expect(ignore(v.dom, "selection")).toBe(false);
});

test("stops only events aimed at real controls", () => {
  const v = view();
  const input = v.chrome.appendChild(document.createElement("input"));
  const stop = (target: Element) =>
    nodeViewOptions.stopEvent!({ event: { target } as unknown as Event });
  expect(stop(input)).toBe(true);
  expect(stop(v.chrome)).toBe(false);
});
