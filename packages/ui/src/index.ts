export { MdxEditor } from "./editor";
export type { MdxEditorProps } from "./editor";
export { useEditorMode, useSourceText, useSyncStatus } from "./root";
export type { MdxEditorRootProps } from "./root";
export type { MdxEditorRef, MdxEditorSync, CollabUser, EditorMode } from "./store";
export type { VisualSurfaceProps, SourceSurfaceProps } from "./surfaces";
export type { FileProvider, MediaProvider } from "./components/media";
export { EditorThemeProvider, useEditorTheme } from "./theme";
export type { EditorTheme, EditorThemeProviderProps, ResolvedTheme } from "./theme";
export type { UiComponentSpec, ComponentRenderProps } from "./components/spec";
export { emptyComponent } from "@fumadocs-editor/core";
export type {
  ComponentSpec,
  PropField,
  AttributeRegion,
  SyntaxOptions,
} from "@fumadocs-editor/core";
export { admonitionSpec } from "./components/admonition";
export { filesFenceSpecs } from "./components/files-fence";
export { fumadocsUiComponents } from "./components/fumadocs-ui";
