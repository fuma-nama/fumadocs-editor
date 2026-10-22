/**
 * Where uploaded files go. The host owns storage; the editor does not.
 * Without a provider, paste/drop upload is off and images are added by URL.
 */
export interface MediaProvider {
  /** store the file; the returned src is what the document will reference */
  upload(file: File): Promise<string>;
  /** turn a document src (often relative) into a displayable URL */
  resolve?(src: string): string;
  /** show a failed upload */
  onError?(error: unknown, file: File): void;
}

export const resolveSrc = (media: MediaProvider | undefined, src: string): string =>
  media?.resolve?.(src) ?? src;

/**
 * error-handling wrapper for MediaProvider.upload().
 * call `onError` and return undefined if it fails.
 * if `onError` is not provided, the error is rethrown.
 * return the image path on success, to be inserted into the markdown.
 */
export async function uploadFile(media: MediaProvider, file: File): Promise<string | undefined> {
  try {
    return await media.upload(file);
  } catch (error) {
    if (!media.onError) throw error;
    media.onError(error, file);
    return undefined;
  }
}

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

export interface EditorProviders {
  media?: MediaProvider;
  files?: FileProvider;
}
