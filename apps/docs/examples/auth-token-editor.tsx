import { MdxEditor } from "@fumadocs-editor/ui";
import { client } from "./auth-token-client";

export function Editor({ path }: { path: string }) {
  return <MdxEditor sync={{ client, path }} />;
}
