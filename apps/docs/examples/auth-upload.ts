import { AUTH_HEADER, UPLOAD_ENDPOINT } from "@fumadocs-editor/core/sync";
import type { MediaProvider } from "@fumadocs-editor/ui";

declare function getAccessToken(): Promise<string>;

export const media: MediaProvider = {
  async upload(file) {
    const res = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      body: file,
      headers: {
        "x-filename": encodeURIComponent(file.name),
        // the same payload the transport sends on hello, JSON-encoded
        [AUTH_HEADER]: JSON.stringify(await getAccessToken()),
      },
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const { src } = (await res.json()) as { src: string };
    return src;
  },
};
