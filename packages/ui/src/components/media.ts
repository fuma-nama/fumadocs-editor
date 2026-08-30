/**
 * Where uploaded files go — the host's concern, not the editor's. Without a
 * provider, paste/drop upload is off and images are added by URL.
 */
export interface MediaProvider {
  /** store the file; the returned src is what the document will reference */
  upload(file: File): Promise<string>;
  /** turn a document src (often relative) into a displayable URL */
  resolve?(src: string): string;
}

export const resolveSrc = (media: MediaProvider | undefined, src: string): string =>
  media?.resolve?.(src) ?? src;
