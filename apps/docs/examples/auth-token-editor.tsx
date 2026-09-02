import { MdxEditor } from "@fumadocs-editor/ui";
import { transport } from "./auth-token-client";

export function Editor({ path }: { path: string }) {
  return <MdxEditor sync={{ transport, path }} />;
}
