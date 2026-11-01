"use client";
import { useState } from "react";
import { MdxEditor } from "@fumadocs-editor/ui";
import { NotesEditor } from "../examples/extensions";

const source = `## Release notes

Select a sentence, then press ⌘J (Ctrl+J), use **✦** in the toolbar, or **Ask AI** in the header.

The sync server now retries a dropped connection after a short delay, so a laptop that sleeps for a minute comes back without a reload. TODO link the protocol page.

Uploads keep their order when several images are dropped at once. TODO add a screenshot.
`;

const fillers = /\b(now|also|just|really|very|several|after a short delay|at once)\b\s*/gi;

/** stands in for a model: answers are made up in the page, nothing is sent */
async function demoModel(instruction: string, selection: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const sentences = selection.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = selection.split(/\s+/).filter(Boolean);
  switch (instruction) {
    case "Summarize":
      return words.length <= 14 ? selection : `${words.slice(0, 14).join(" ")}…`;
    case "Make it shorter":
      return sentences[0]!
        .replace(fillers, "")
        .replace(/,\s*so\b.*$/, ".")
        .trim();
    case "Explain":
      return `This says, in ${sentences.length} sentence${sentences.length === 1 ? "" : "s"}, what changed and why it matters to someone using the editor.`;
    default:
      return `(demo model) You asked "${instruction}" about ${words.length} words. A real model would answer here.`;
  }
}

export function ExtensionsDemo() {
  const [on, setOn] = useState(true);
  return (
    <div className="not-prose my-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-fd-muted-foreground">
          A preview of the examples below:{" "}
          <a className="underline" href="#highlight-text">
            highlight
          </a>
          ,{" "}
          <a className="underline" href="#ask-ai-about-the-selection">
            Ask AI
          </a>
          ,{" "}
          <a className="underline" href="#read-the-editor-from-your-ui">
            word count
          </a>{" "}
          and the{" "}
          <a className="underline" href="#buttons-in-the-format-bubble">
            bubble button
          </a>
          .
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => setOn(!on)}
          className="group inline-flex items-center gap-2"
        >
          <span className="relative h-5 w-9 rounded-full bg-fd-muted transition-colors group-aria-checked:bg-fd-primary">
            <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-fd-background shadow transition-transform group-aria-checked:translate-x-4" />
          </span>
          Extensions
        </button>
      </div>
      {/* the lists are fixed for the life of a root: switching remounts it */}
      {on ? (
        <NotesEditor key="on" text={source} model={demoModel} />
      ) : (
        <MdxEditor key="off" defaultValue={source} />
      )}
    </div>
  );
}
