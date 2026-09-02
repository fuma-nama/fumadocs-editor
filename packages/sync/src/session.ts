import type { FileState, ReadResult, SyncTransport } from "./transport";

export type SessionStatus = "synced" | "dirty" | "saving" | "conflict" | "offline" | "denied";

/**
 * The editor side of a session. `MdxEditorRef` satisfies it; any document
 * that can serialize itself, merge external text, and be replaced does.
 */
export interface SyncedDocument {
  /** the current markdown, read at save time */
  getMarkdown(): string;
  /** merge disk text in; resolves with the conflicting block indices */
  applyExternalMarkdown(text: string): Promise<number[]>;
  /** replace the document with disk text outright (conflict → "take disk") */
  setMarkdown(text: string): Promise<void>;
  /**
   * The disk now holds `text`, written from this document: adopt it as the
   * base later external changes merge against. Edits made since stay local.
   */
  markSaved(text: string): void;
}

export interface FileSessionOptions {
  transport: SyncTransport;
  path: string;
  document: SyncedDocument;
  onStatus?: (status: SessionStatus) => void;
}

export interface FileSession {
  /** read the file and adopt it as the sync base; returns its state (plus any scope-derived data) */
  open(): Promise<ReadResult>;
  /** the document changed: schedules an autosave */
  changed(): void;
  /** save now if there is anything to save (blur / beforeunload / Cmd-S) */
  flush(): Promise<void>;
  /** resolve a conflict by overwriting the disk with the local document */
  keepMine(): Promise<void>;
  /** resolve a conflict by dropping local edits for the disk version */
  takeDisk(): Promise<void>;
  status(): SessionStatus;
  /** what the disk held the last time we were in sync with it */
  syncedText(): string;
  close(): void;
}

const TRAILING_MS = 800;
const MAX_WAIT_MS = 5000;

/**
 * One open file against a `SyncTransport`: autosave with compare-and-swap
 * writes, external changes merged in as they land, and same-block conflicts
 * pausing writes until the user picks a side.
 */
export function createFileSession(options: FileSessionOptions): FileSession {
  const { transport, path, document, onStatus } = options;

  let baseVersion = "";
  let lastSynced = "";
  let dirty = false;
  let saving = false;
  let conflict = false;
  let online = true;
  let denied = false;
  let closed = false;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let maxWait: ReturnType<typeof setTimeout> | undefined;

  const status = (): SessionStatus =>
    conflict
      ? "conflict"
      : denied
        ? "denied"
        : !online
          ? "offline"
          : saving
            ? "saving"
            : dirty
              ? "dirty"
              : "synced";

  // no emissions while constructing: the transport reports its online state
  // synchronously, and callers haven't seen the session object yet
  let constructed = false;
  let lastEmitted: SessionStatus | undefined;
  const emit = () => {
    if (!constructed) return;
    const current = status();
    if (current === lastEmitted) return;
    lastEmitted = current;
    onStatus?.(current);
  };

  const clearTimers = () => {
    clearTimeout(trailing);
    clearTimeout(maxWait);
    trailing = maxWait = undefined;
  };

  const save = async (): Promise<void> => {
    clearTimers();
    if (closed || conflict || !online || saving || !dirty) return;
    const text = document.getMarkdown();
    if (text === lastSynced) {
      dirty = false;
      emit();
      return;
    }
    saving = true;
    emit();
    try {
      const result = await transport.write(path, text, baseVersion);
      if (result.ok) {
        baseVersion = result.version;
        lastSynced = text;
        document.markSaved(text);
        dirty = document.getMarkdown() !== text;
      } else {
        // lost a race with the disk: merge what's there, then try again
        await incoming(result.current);
      }
    } catch {
      // offline or connection lost mid-save; retried on reconnect
    } finally {
      saving = false;
      emit();
      if (dirty && !conflict && online) schedule();
    }
  };

  const schedule = () => {
    clearTimeout(trailing);
    trailing = setTimeout(save, TRAILING_MS);
    maxWait ??= setTimeout(save, MAX_WAIT_MS);
  };

  const incoming = async (state: FileState): Promise<void> => {
    baseVersion = state.version;
    lastSynced = state.text;
    const conflicts = await document.applyExternalMarkdown(state.text);
    if (conflicts.length > 0) {
      conflict = true;
    } else {
      dirty = document.getMarkdown() !== state.text;
      if (dirty) schedule();
    }
    emit();
  };

  const stopWatch = transport.watch(path, (state) => {
    if (!closed && !conflict) void incoming(state);
  });

  const stopStatus =
    transport.onStatus?.((next) => {
      online = next === "online";
      denied = next === "denied";
      emit();
      if (online && dirty && !conflict) schedule();
    }) ?? (() => {});
  constructed = true;

  return {
    async open() {
      const state = await transport.read(path);
      baseVersion = state.version;
      lastSynced = state.text;
      dirty = false;
      conflict = false;
      emit();
      return state;
    },
    changed() {
      if (closed || conflict) return;
      // compare now (cheap with an incremental serializer): a change that
      // lands back on the synced text — a clean external merge's own update
      // event, or an undo — never even reports dirty
      dirty = document.getMarkdown() !== lastSynced;
      emit();
      if (dirty) schedule();
    },
    flush: () => save(),
    async keepMine() {
      if (!conflict) return;
      conflict = false;
      dirty = true;
      emit();
      await save();
    },
    async takeDisk() {
      if (!conflict) return;
      const state = await transport.read(path);
      await document.setMarkdown(state.text);
      baseVersion = state.version;
      lastSynced = state.text;
      conflict = false;
      dirty = false;
      emit();
    },
    status,
    syncedText: () => lastSynced,
    close() {
      closed = true;
      clearTimers();
      stopWatch();
      stopStatus();
    },
  };
}
