import {
  Extension,
  extensions as coreExtensions,
  flattenExtensions,
  getExtensionField,
  type AnyExtension,
} from "@tiptap/core";

const defaultPriority = 100;
/** reported once, not on every rebuild of the live editor */
const reported = new WeakSet<AnyExtension>();

function commandNames(extension: AnyExtension): string[] {
  // only builds the command table; no command runs, so no editor is needed
  const addCommands = getExtensionField<(() => object) | undefined>(extension, "addCommands", {
    name: extension.name,
    options: extension.options,
    storage: extension.storage,
    editor: undefined,
    type: null,
  } as never);
  return addCommands ? Object.keys(addCommands()) : [];
}

function problem(part: AnyExtension, names: Set<string>, commands: Set<string>): string | null {
  if (part.type !== "extension") {
    return `adds the ${part.type} "${part.name}"; host extensions add behaviour only (use a component spec for content)`;
  }
  if (names.has(part.name)) return `uses the name "${part.name}", which another extension has`;
  const clash = commandNames(part).find((command) => commands.has(command));
  if (clash) return `adds the command "${clash}", which another extension has`;
  return null;
}

/**
 * The host's extensions, ready to join `builtIn`. One that adds a node or a
 * mark is left out: content is what components are for, and the serializer
 * would drop it. So is one that takes a name or a command already in use:
 * it would replace that extension's storage or command.
 *
 * Each one, and each extension it nests, goes in half a step below its own
 * priority. On equal priority TipTap runs the later extension's keys and
 * plugins first, and its own core extensions (Enter, Backspace, paste) come
 * first in the list; half a step makes every built-in, core included, win
 * a tie, while the host still beats anything of lower priority.
 */
export function hostExtensions(own: AnyExtension[], builtIn: AnyExtension[]): AnyExtension[] {
  // the module also exports a plugin key
  const core = Object.values(coreExtensions).filter((value) => value instanceof Extension);
  const existing = flattenExtensions([...core, ...builtIn]);
  const names = new Set(existing.map((extension) => extension.name));
  const commands = new Set(existing.flatMap(commandNames));
  const kept: AnyExtension[] = [];
  for (const extension of own) {
    const parts = flattenExtensions([extension]);
    let reason: string | null = null;
    const partNames = new Set<string>();
    const partCommands = new Set<string>();
    for (const part of parts) {
      reason = problem(part, names, commands) ?? problem(part, partNames, partCommands);
      if (reason) break;
      partNames.add(part.name);
      for (const command of commandNames(part)) partCommands.add(command);
    }
    if (reason) {
      if (!reported.has(extension)) {
        reported.add(extension);
        console.error(`[fumadocs-editor] extension "${extension.name}" ${reason}. Left out.`);
      }
      continue;
    }
    for (const name of partNames) names.add(name);
    for (const command of partCommands) commands.add(command);
    for (const part of parts) {
      const priority = getExtensionField<number | undefined>(part, "priority") ?? defaultPriority;
      // its nested extensions are already in `parts`
      kept.push(part.extend({ priority: priority - 0.5, addExtensions: () => [] }));
    }
  }
  return kept;
}
