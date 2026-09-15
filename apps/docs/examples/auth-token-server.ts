import type { SyncAuthenticate } from "@fumadocs-editor/core/node";

declare function verifyToken(token: unknown): Promise<{ name: string; teams: string[] } | null>;

export const authenticate: SyncAuthenticate = async ({ payload }) => {
  const claims = await verifyToken(payload);
  if (!claims) return null;
  // `write` must be synchronous: resolve everything async here
  const teams = new Set(claims.teams);
  return {
    user: { name: claims.name },
    write: (path) => teams.has(path.split("/")[0] ?? ""),
  };
};
