/**
 * Where uploaded files go. The host owns storage; the editor does not.
 * Without a provider, paste/drop upload is off and images are added by URL.
 */
export interface MediaProvider {
  /** store the file; the returned src is what the document will reference */
  upload(file: File): Promise<string>;
  /** turn a document src (often relative) into a displayable URL */
  resolve?(src: string): string;
}

export const resolveSrc = (media: MediaProvider | undefined, src: string): string =>
  media?.resolve?.(src) ?? src;

/**
 * Paths the document can reference. There is no filesystem in the browser,
 * so the host supplies them. Powers include picker and page-link
 * autocomplete; without a provider both stay plain text inputs.
 */
export interface FileProvider {
  /** candidate targets, as the exact relative paths to write into the
   * document (e.g. "./shared/props.mdx"), relative to the open document */
  list(): Promise<string[]>;
}
