import * as stylex from "@stylexjs/stylex";
import type { CollabCaret } from "@fumadocs-editor/core/sync";
import { content } from "./styles/content";

export const caret: CollabCaret = {
  render(user) {
    const element = document.createElement("span");
    element.className = stylex.props(content.caret).className!;
    element.style.borderColor = user.color ?? "";
    const label = document.createElement("div");
    label.className = stylex.props(content.caretLabel).className!;
    label.style.backgroundColor = user.color ?? "";
    label.textContent = user.name;
    element.append(label);
    return element;
  },
  selectionRender: (user) => ({
    class: stylex.props(content.caretSelection).className!,
    style: `background-color: ${user.color}70`,
  }),
};
