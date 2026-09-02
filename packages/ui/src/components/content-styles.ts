import { Extension } from "@tiptap/core";
import { contentClass, nodeClass } from "../styles/content";

/** Attaches the content classes to TipTap's rendered DOM: one global
 * attribute per node/mark type. Markup TipTap builds on its own (task item
 * internals, the table wrapper) is styled in base.css. */

export const contentStyles = Extension.create({
  name: "fdeContentStyles",
  addGlobalAttributes() {
    const attribute = (renderHTML: (attrs: Record<string, unknown>) => { class: string }) => ({
      fdeClass: { default: null, parseHTML: () => null, renderHTML },
    });
    const all = [];
    for (const type in nodeClass) {
      const className = nodeClass[type as keyof typeof nodeClass];
      all.push({ types: [type], attributes: attribute(() => ({ class: className })) });
    }
    all.push({
      types: ["heading"],
      attributes: attribute((attrs) => ({ class: contentClass.heading(attrs.level as number) })),
    });
    return all;
  },
});
