"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { DocumentState, DocumentStore } from "../store";
import type { EditorProviders } from "./media";

export interface EditorContextValue extends EditorProviders {
  store: DocumentStore;
  editable: boolean;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error("MdxEditor parts must be rendered inside MdxEditor.Root");
  return value;
}

export function useDocumentState(): DocumentState {
  const { store } = useEditorContext();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
