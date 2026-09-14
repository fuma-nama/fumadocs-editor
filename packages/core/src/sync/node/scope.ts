import type { IncomingMessage } from "node:http";
import { AUTH_HEADER, type SyncUser } from "../transport";

/**
 * What one authenticated connection may do. Document identity is the
 * root-relative posix path, so the predicates are per-document permissions;
 * they run on the message hot path and must be synchronous and cheap. Async
 * policy resolves inside `authenticate` and closes over the result (changes
 * apply on reconnect).
 */
export interface SyncScope {
  /** authoritative presence identity: awareness disagreeing on it is rewritten */
  user?: SyncUser;
  /** default true */
  read?: boolean | ((path: string) => boolean);
  write: boolean | ((path: string) => boolean);
}

export type SyncAuthenticate = (ctx: {
  request: IncomingMessage;
  /**
   * The client transport's `auth()` payload, verbatim. Sent on the
   * connection hello and in {@link AUTH_HEADER} on HTTP media endpoints.
   * Cookie-based consumers ignore it and read the request.
   */
  payload?: unknown;
}) => SyncScope | null | Promise<SyncScope | null>;

/** a scope with the boolean shorthands resolved to predicates */
export interface Scope {
  user?: SyncUser;
  read: (path: string) => boolean;
  write: (path: string) => boolean;
}

const YES = () => true;
const NO = () => false;
export const ALLOW: Scope = { read: YES, write: YES };
export const DENY: Scope = { read: NO, write: NO };

const rule = (value: boolean | ((path: string) => boolean)) =>
  typeof value === "function" ? value : value ? YES : NO;

/** `authenticate` as one call per surface: null rejects, absent allows all */
export type Authorize = (request: IncomingMessage, payload: unknown) => Promise<Scope | null>;

export function createAuthorize(authenticate: SyncAuthenticate | undefined): Authorize {
  return async (request, payload) => {
    if (!authenticate) return ALLOW;
    try {
      const scope = await authenticate({ request, payload });
      return (
        scope && { user: scope.user, read: rule(scope.read ?? true), write: rule(scope.write) }
      );
    } catch {
      return null;
    }
  };
}

/** authorize an HTTP request; the hello payload travels in {@link AUTH_HEADER}, JSON-encoded */
export function authorizeHttp(
  authorize: Authorize,
  request: IncomingMessage,
): Promise<Scope | null> {
  const header = request.headers[AUTH_HEADER];
  let payload: unknown;
  if (typeof header === "string") {
    try {
      payload = JSON.parse(header);
    } catch {
      return Promise.resolve(null);
    }
  }
  return authorize(request, payload);
}
