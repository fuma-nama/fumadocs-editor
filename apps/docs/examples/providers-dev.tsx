import { ASSET_ENDPOINT, UPLOAD_ENDPOINT } from "@fumadocs-editor/core/sync";
import type { MediaProvider } from "@fumadocs-editor/ui";

// uploads land in <root>/assets on the dev server; relative srcs display
// through the asset endpoint
export const devMedia: MediaProvider = {
  async upload(file) {
    const res = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      body: file,
      headers: { "x-filename": encodeURIComponent(file.name) },
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const { src } = (await res.json()) as { src: string };
    return src;
  },
  resolve: (src) =>
    /^(?:[a-z]+:|\/)/i.test(src) ? src : `${ASSET_ENDPOINT}/${src.replace(/^\.\//, "")}`,
};
