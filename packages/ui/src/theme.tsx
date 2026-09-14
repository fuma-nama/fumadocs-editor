"use client";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type EditorTheme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** the requested theme, including `system` */
  theme: EditorTheme;
  /** the concrete theme actually applied (`system` resolved against the OS) */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: EditorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeSystemTheme(onChange: () => void): () => void {
  if (!window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// the `storage` event only fires in other tabs; same-tab writes notify here
const storageListeners = new Set<() => void>();

function subscribeStorage(onChange: () => void): () => void {
  storageListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    storageListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(key: string): EditorTheme | null {
  const stored = window.localStorage.getItem(key);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : null;
}

const noStored = () => null;

/**
 * Theme context for standalone hosts (plain React, Storybook, playground).
 * Fumadocs sites already toggle `.dark` via next-themes; the tokens key off
 * that. Tracks `light | dark | system`, persists it, and applies the class
 * on a wrapper.
 */
export interface EditorThemeProviderProps {
  /** @defaultValue "system" */
  defaultTheme?: EditorTheme;
  /**
   * localStorage key for the persisted choice; pass `null` to disable
   * @defaultValue "fde-theme"
   */
  storageKey?: string | null;
  children: ReactNode;
  /** applied to the wrapper that carries the theme class */
  className?: string;
}

export function EditorThemeProvider({
  defaultTheme = "system",
  storageKey = "fde-theme",
  children,
  className,
}: EditorThemeProviderProps) {
  // storage is the theme's home when there is a key; state only stands in without one
  const stored = useSyncExternalStore(
    subscribeStorage,
    () => (storageKey ? readStored(storageKey) : null),
    noStored,
  );
  const [local, setLocal] = useState(defaultTheme);
  const system = useSyncExternalStore(subscribeSystemTheme, systemTheme, () => "light" as const);

  const setTheme = useCallback(
    (next: EditorTheme) => {
      if (!storageKey) return setLocal(next);
      window.localStorage.setItem(storageKey, next);
      for (const listener of storageListeners) listener();
    },
    [storageKey],
  );

  const theme = stored ?? local;
  const resolvedTheme = theme === "system" ? system : theme;
  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={className ? `${resolvedTheme} ${className}` : resolvedTheme}
        data-fde-theme={resolvedTheme}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/**
 * Access the editor theme. Safe to call outside an {@link EditorThemeProvider};
 * it then reports `system` and `setTheme` is a no-op, so the editor
 * inherits whatever ambient theme (`next-themes`, OS) is in effect.
 */
export function useEditorTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      theme: "system",
      resolvedTheme: systemTheme(),
      setTheme: () => {},
    }
  );
}
