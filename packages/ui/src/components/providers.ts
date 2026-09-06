"use client";
import { createContext, useContext } from "react";
import type { FileProvider, MediaProvider } from "./media";

export interface EditorProviders {
  media?: MediaProvider;
  files?: FileProvider;
}

export const ProvidersContext = createContext<EditorProviders>({});

export const useEditorProviders = (): EditorProviders => useContext(ProvidersContext);
