"use client";
import { createContext, useContext } from "react";
import type { FileProvider, MediaProvider } from "./media";

/**
 * Host-injected providers, delivered to renderer/chrome components through
 * context: node views render inside the editor's React tree, so this reaches
 * the include picker and the link autocomplete without prop-drilling.
 */
export interface EditorProviders {
  media?: MediaProvider;
  files?: FileProvider;
}

export const ProvidersContext = createContext<EditorProviders>({});

export const useEditorProviders = (): EditorProviders => useContext(ProvidersContext);
