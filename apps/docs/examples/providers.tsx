import type { FileProvider, MediaProvider } from "@fumadocs-editor/ui";

//#region media
export const media: MediaProvider = {
  async upload(file) {
    const res = await fetch("/api/upload", { method: "POST", body: file });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const { src } = (await res.json()) as { src: string };
    return src;
  },
  // turn document srcs (often relative) into displayable URLs
  resolve: (src) => (src.startsWith("./") ? `/content/${src.slice(2)}` : src),
};
//#endregion

//#region files
export const files: FileProvider = {
  // the exact relative paths to write into the document
  list: async () => {
    const res = await fetch("/api/pages");
    return (await res.json()) as string[];
  },
};
//#endregion
