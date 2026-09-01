"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditorTheme } from "../theme";

/*
 * Diagram preview for `mermaid` code fences — a code-block renderer variant,
 * not a syntax: the fence stays an ordinary editable code block in the
 * document (and in MDX), the diagram simply renders beneath it, the way
 * fumadocs' remarkMdxMermaid renders it on the site. The mermaid library
 * (~large) loads in its own chunk only when a mermaid fence actually renders.
 */

type Mermaid = typeof import("mermaid").default;

let mermaidPromise: Promise<Mermaid> | undefined;
let renderSeq = 0;

/**
 * Whether `el` sits in a dark scope. `color-scheme` in preset.css tracks
 * every theming path — `.dark` / `.light` classes and the OS fallback — so
 * the computed value is authoritative even for nested overrides.
 */
function isDark(el: Element): boolean {
  return getComputedStyle(el).colorScheme.includes("dark");
}

function subscribeThemeScope(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    mql.removeEventListener("change", onChange);
  };
}

export function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
  // provider toggles re-render us (context) and this snapshot re-reads; the
  // subscription covers next-themes class flips and OS scheme changes
  const { resolvedTheme } = useEditorTheme();
  const scope = useSyncExternalStore(
    subscribeThemeScope,
    () => {
      const el = containerRef.current;
      return el ? isDark(el) : resolvedTheme === "dark";
    },
    () => false,
  );

  useEffect(() => {
    let live = true;
    const render = async () => {
      mermaidPromise ??= import("mermaid").then((m) => m.default);
      const mermaid = await mermaidPromise;
      if (!live) return;
      mermaid.initialize({
        startOnLoad: false,
        fontFamily: "inherit",
        theme: scope ? "dark" : "default",
      });
      try {
        const { svg } = await mermaid.render(`fde-mermaid-${++renderSeq}`, code);
        if (!live) return;
        setSvg(svg);
        setError(false);
      } catch {
        // mid-edit sources are transient garbage: keep the last good diagram
        if (live) setError(true);
      }
    };
    // typing in the fence re-renders per keystroke; the diagram can lag a beat
    const timer = window.setTimeout(() => void render(), svg ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- svg only picks the delay
  }, [code, scope]);

  return (
    // kept mounted even before the first render: the ref is where the theme
    // scope is read from (computed styles resolve on hidden elements too)
    <div className="border-t border-fd-border" contentEditable={false} hidden={!svg}>
      <div
        ref={containerRef}
        className="fde-mermaid flex justify-center overflow-x-auto p-4 data-[error]:opacity-60"
        data-error={error || undefined}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
