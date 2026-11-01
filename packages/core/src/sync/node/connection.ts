import type { IncomingMessage } from "node:http";
import { encodeMessage } from "../codec";
import type { ServerMessage, SyncUser } from "../protocol";
import type { Scope } from "./scope";

/** an authenticated sync connection, as `authenticate` let it in */
export interface SyncConnection {
  /** the upgrade request `authenticate` saw: cookies, headers */
  readonly request: IncomingMessage;
  /** the client's `auth()` payload, verbatim */
  readonly payload: unknown;
  /** the user its scope names */
  readonly user?: SyncUser;
  /**
   * Ends the connection at once: nothing more is relayed to it, and what it
   * sends from then on is dropped. The client reconnects, so `authenticate`
   * decides again. Close the connections whose access changed, and they come
   * back with their new scope, or are refused.
   */
  close(): void;
}

/** an authenticated client as the resources see it */
export interface Connection extends SyncConnection {
  scope: Scope;
  /** one encoded server message */
  send(data: string | Uint8Array): void;
}

/** a client message as it arrives: only `type` and `resource` have been looked at */
export type Incoming = Record<string, unknown>;

export interface Resource {
  subscribe(conn: Connection, message: Incoming): Promise<void>;
  unsubscribe(conn: Connection, message: Incoming): void;
  update(conn: Connection, message: Incoming): Promise<void>;
  leave(conn: Connection): void;
}

type Body<T> = T extends unknown ? Omit<T, "type" | "id"> : never;
type UpdateBody = Body<Extract<ServerMessage, { type: "update" }>>;

export const str = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("malformed message");
  return value;
};

export const bytes = (value: unknown): Uint8Array => {
  if (!(value instanceof Uint8Array)) throw new Error("malformed message");
  return value;
};

/** encode a push once, then send it to every subscriber */
export const encode = (body: UpdateBody, id?: number) =>
  encodeMessage(id === undefined ? { type: "update", ...body } : { type: "update", id, ...body });

/** answers a message that carried an `id`; the others go unanswered */
export function answer(conn: Connection, message: Incoming, body: UpdateBody) {
  if (typeof message.id === "number") conn.send(encode(body, message.id));
}
