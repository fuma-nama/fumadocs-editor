import { encodeMessage } from "../codec";
import type { ServerMessage } from "../protocol";
import type { Scope } from "./scope";

/** an authenticated client as the resources see it */
export interface Connection {
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
