import type { SyncAuthenticate } from "@fumadocs-editor/core/node";

// your session store; the sync server only cares about the resulting scope
declare function verifySession(
  cookie: string | undefined,
): Promise<{ name: string; isEditor: boolean } | null>;

export const authenticate: SyncAuthenticate = async ({ request }) => {
  const session = await verifySession(request.headers.cookie);
  if (!session) return null;
  return {
    user: { name: session.name },
    write: session.isEditor,
  };
};
