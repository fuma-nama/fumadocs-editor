import {
  admonitionSpec,
  filesFenceSpecs,
  fumadocsUiComponents,
  type MdxEditorSync,
  type MediaProvider,
} from "@fumadocs-editor/ui";
import {
  ASSET_ENDPOINT,
  AUTH_HEADER,
  UPLOAD_ENDPOINT,
  wsTransport,
} from "@fumadocs-editor/core/sync";
import config from "virtual:fumadocs-studio-config";

const params = new URLSearchParams(location.search);

export const components = config.components ?? [
  ...fumadocsUiComponents,
  admonitionSpec,
  ...filesFenceSpecs,
];
export const syntax = config.syntax;

// read per call: a reconnect picks up a token rotated in localStorage
export const auth =
  config.auth ?? (() => params.get("token") ?? localStorage.getItem("fde-token") ?? undefined);

export const transport = wsTransport({ auth });

export const collab: MdxEditorSync["collab"] =
  typeof config.collab === "object"
    ? config.collab
    : config.collab === true || params.has("collab");

export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await auth();
  if (token !== undefined) headers[AUTH_HEADER] = JSON.stringify(token);
  return headers;
}

// uploads land in <root>/assets through the studio server; relative srcs
// display through the asset endpoint
const serverMedia: MediaProvider = {
  async upload(file) {
    const headers = await authHeaders();
    headers["x-filename"] = encodeURIComponent(file.name);
    const res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: file, headers });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    const { src } = (await res.json()) as { src: string };
    return src;
  },
  resolve: (src) =>
    /^(?:[a-z]+:|\/)/i.test(src) ? src : `${ASSET_ENDPOINT}/${src.replace(/^\.\//, "")}`,
};

export const media = config.media === false ? undefined : (config.media ?? serverMedia);
