"use client";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../styles/tokens.stylex";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEditorTheme } from "../theme";
import { chrome } from "../styles/shared";

type Mermaid = typeof import("mermaid").default;

let mermaidPromise: Promise<Mermaid> | undefined;
let renderSeq = 0;

const styles = stylex.create({
  frame: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  diagram: {
    display: "flex",
    justifyContent: "center",
    overflowX: "auto",
    padding: "1rem",
    opacity: { default: null, ":is([data-error])": 0.6 },
  },
});

/**
 * Whether `el` sits in a dark scope. The `color-scheme` declarations in
 * base.css track every theming path (`.dark` / `.light` classes and the OS
 * fallback), so the computed value is authoritative even for nested overrides.
 */
function isDark(el: Element): boolean {
  return getComputedStyle(el).colorScheme.includes("dark");
}

// one class observer and media query for every diagram on the page
const scopeListeners = new Set<() => void>();
let stopScope = () => {};

function subscribeThemeScope(onChange: () => void): () => void {
  if (scopeListeners.size === 0) {
    const notify = () => {
      for (const listener of scopeListeners) listener();
    };
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", notify);
    stopScope = () => {
      observer.disconnect();
      mql.removeEventListener("change", notify);
    };
  }
  scopeListeners.add(onChange);
  return () => {
    scopeListeners.delete(onChange);
    if (scopeListeners.size === 0) stopScope();
  };
}

export function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
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
        if (live) setError(true);
      }
    };
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
    <div {...stylex.props(chrome.static, styles.frame)} contentEditable={false} hidden={!svg}>
      <div
        ref={containerRef}
        {...stylex.props(styles.diagram)}
        data-error={error || undefined}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
