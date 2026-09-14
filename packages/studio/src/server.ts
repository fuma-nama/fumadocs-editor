import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  mergeConfig,
  normalizePath,
  type InlineConfig,
  type Plugin,
  type ViteDevServer,
} from "vite";
import {
  ASSET_ENDPOINT,
  AUTH_HEADER,
  SYNC_ENDPOINT,
  UPLOAD_ENDPOINT,
} from "@fumadocs-editor/core/sync";
import stylex from "@stylexjs/unplugin/vite";
import { createSyncServer, type SyncScope } from "@fumadocs-editor/core/node";
import { TREE_ENDPOINT, TREE_EVENT, type TreeCommand, type TreeResponse } from "../app/protocol";
import type { StudioOptions } from "./load-config";
import { CommandError, openWorkspace } from "./tree";

const studioDir = path.resolve(import.meta.dirname, "..");
const appDir = path.join(studioDir, "app");

/**
 * Packages the app and a user config import at runtime, resolved from this
 * package rather than the importer: a config in a project that only ran
 * `npx` still finds them, and React stays a single copy.
 */
const PINNED = [
  "@fumadocs-editor/studio",
  "@fumadocs-editor/ui",
  "@fumadocs-editor/core",
  "@base-ui/react",
  "@stylexjs/stylex",
  "react",
  "react-dom",
];
/**
 * Pre-bundle candidates. Vite skips dep discovery for importers inside
 * `node_modules` (the installed app), so what resolves there is listed
 * explicitly; in the monorepo the workspace packages resolve outside it and
 * are served as source.
 */
const OPTIMIZE = [
  "@fumadocs-editor/studio",
  "@fumadocs-editor/ui",
  "@fumadocs-editor/core",
  "@fumadocs-editor/core/parse",
  "@fumadocs-editor/core/serialize",
  "@fumadocs-editor/core/extensions",
  "@fumadocs-editor/core/sync",
  "@fumadocs-editor/core/collab",
  "@base-ui/react/alert-dialog",
  "@base-ui/react/autocomplete",
  "@base-ui/react/collapsible",
  "@base-ui/react/dialog",
  "@base-ui/react/menu",
  "@base-ui/react/scroll-area",
  "@stylexjs/stylex",
  "lucide-react",
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
];
const NODE_MODULES = "/node_modules/";
const CONFIG_ID = "virtual:fumadocs-studio-config";
const STYLES_ID = "virtual:fumadocs-studio-styles";
const EMPTY_CONFIG_ID = "\0fumadocs-studio-config";
const RESOLVED_STYLES_ID = "\0fumadocs-studio-styles";
/** editors write in bursts; read a changed file once it settles */
const SETTLE_MS = 100;
const MAX_COMMAND_BYTES = 64 * 1024;

function optimizeInclude(): string[] {
  const include: string[] = [];
  for (const spec of OPTIMIZE) {
    if (normalizePath(fileURLToPath(import.meta.resolve(spec))).includes(NODE_MODULES)) {
      include.push(spec);
    }
  }
  return include;
}

/** the package an id under `node_modules` belongs to */
function packageDir(id: string): string | undefined {
  const at = id.lastIndexOf(NODE_MODULES);
  if (at < 0) return;
  const name = at + NODE_MODULES.length;
  let end = id.indexOf("/", name);
  if (id[name] === "@") end = id.indexOf("/", end + 1);
  if (end > 0) return id.slice(0, end);
}

/**
 * Vite serves the modules it resolved, but the fonts a stylesheet references
 * are checked against `fs.allow` alone. Installs spread packages over many
 * roots (pnpm's global virtual store, npx caches), so rather than guessing
 * roots, every package a module loads from becomes servable.
 */
function packageAccess(): Plugin {
  let allow: string[];
  return {
    name: "fumadocs-studio:packages",
    configResolved(config) {
      allow = config.server.fs.allow;
    },
    load(id) {
      const dir = packageDir(id);
      if (dir && !allow.some((root) => dir.startsWith(`${root}/`))) allow.push(dir);
    },
  };
}

/** resolution rules shared by the dev server and the config loader */
export function baseConfig(projectRoot: string): InlineConfig {
  return {
    configFile: false,
    envDir: false,
    root: appDir,
    resolve: { dedupe: PINNED },
    server: { fs: { allow: [appDir, projectRoot] } },
  };
}

const ALLOW_ALL: SyncScope = { write: true };

const allows = (rule: SyncScope["read"], target: string) =>
  typeof rule === "function" ? rule(target) : rule !== false;

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_COMMAND_BYTES) {
        reject(new CommandError(413, "command too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new CommandError(400, "not a JSON command"));
      }
    });
    request.on("error", reject);
  });
}

const isString = (value: unknown): value is string => typeof value === "string";

function parseCommand(body: unknown): TreeCommand {
  const command = body as Partial<Record<string, unknown>> | null;
  if (command && typeof command === "object") {
    const { type, path: target, title, dir, order } = command;
    if (type === "create" && isString(target) && isString(title)) {
      return { type, path: target, title };
    }
    if (type === "mkdir" && isString(dir) && isString(title)) return { type, dir, title };
    if (type === "delete" && isString(target)) return { type, path: target };
    if (type === "order" && isString(dir) && Array.isArray(order) && order.every(isString)) {
      return { type, dir, order };
    }
  }
  throw new CommandError(400, "not a tree command");
}

function studioPlugin({ configFile, styles, contentRoot, server }: StudioOptions): Plugin {
  const { authenticate, upload, evictAfterMs, helloTimeoutMs } = server;
  const workspace = openWorkspace(contentRoot);

  const authorize = async (request: IncomingMessage): Promise<SyncScope | null> => {
    const header = request.headers[AUTH_HEADER];
    let payload: unknown;
    if (typeof header === "string") {
      try {
        payload = JSON.parse(header);
      } catch {
        return null;
      }
    }
    if (!authenticate) return ALLOW_ALL;
    try {
      return await authenticate({ request, payload });
    } catch {
      return null;
    }
  };

  const sendTree = async (scope: SyncScope, response: ServerResponse) => {
    const tree = (await workspace).tree((target) => allows(scope.read, target));
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({ root: path.basename(contentRoot), tree } satisfies TreeResponse));
  };

  return {
    name: "fumadocs-studio",
    resolveId(id) {
      // the config file itself is the module: edits to it reload the app
      if (id === CONFIG_ID) return configFile ?? EMPTY_CONFIG_ID;
      if (id === STYLES_ID) return RESOLVED_STYLES_ID;
    },
    load(id) {
      if (id === EMPTY_CONFIG_ID) return "export default {}";
      if (id === RESOLVED_STYLES_ID) {
        let code = "";
        for (const file of styles) code += `import ${JSON.stringify(`/@fs/${file}`)};\n`;
        return code;
      }
    },
    configureServer(vite) {
      const sync = createSyncServer({
        root: contentRoot,
        authenticate,
        upload,
        evictAfterMs,
        helloTimeoutMs,
      });
      vite.httpServer?.on("upgrade", (request, socket, head) => {
        if (request.url === SYNC_ENDPOINT) sync.handleUpgrade(request, socket, head as Buffer);
      });
      vite.httpServer?.once("close", () => void sync.close());
      vite.middlewares.use(UPLOAD_ENDPOINT, sync.handleUpload);
      vite.middlewares.use(ASSET_ENDPOINT, sync.handleAsset);

      // the documents are not modules, so Vite's watcher only feeds the index
      vite.watcher.add(contentRoot);
      const pending = new Map<string, NodeJS.Timeout>();
      let ping: NodeJS.Timeout | undefined;
      vite.watcher.on("all", (event, file) => {
        clearTimeout(pending.get(file));
        pending.set(
          file,
          setTimeout(() => {
            pending.delete(file);
            workspace
              .then((ws) => ws.update(event, file))
              .then((changed) => {
                if (!changed) return;
                clearTimeout(ping);
                ping = setTimeout(() => vite.hot.send(TREE_EVENT), SETTLE_MS);
              });
          }, SETTLE_MS),
        );
      });

      const handle = async (request: IncomingMessage, response: ServerResponse) => {
        const scope = await authorize(request);
        if (!scope) throw new CommandError(401, "");
        if (request.method !== "POST") return sendTree(scope, response);
        const command = parseCommand(await readJson(request));
        const ws = await workspace;
        const target =
          command.type === "order"
            ? command.dir
              ? `${command.dir}/meta.json`
              : "meta.json"
            : command.type === "mkdir"
              ? `${command.dir}/index.mdx`
              : command.path;
        if (!allows(scope.write, target))
          throw new CommandError(403, `no write access to ${target}`);
        if (command.type === "create") await ws.create(command.path, command.title);
        else if (command.type === "mkdir") await ws.mkdir(command.dir, command.title);
        else if (command.type === "delete") {
          await ws.remove(command.path, () => sync.remove(command.path));
        } else await ws.order(command.dir, command.order);
        await sendTree(scope, response);
      };
      vite.middlewares.use(TREE_ENDPOINT, (request, response) => {
        handle(request, response).catch((error: unknown) => {
          response.statusCode = error instanceof CommandError ? error.status : 500;
          response.setHeader("content-type", "text/plain");
          response.end(error instanceof Error ? error.message : String(error));
        });
      });
    },
  };
}

/** starts the studio's Vite dev server; resolves once it listens */
export async function startStudio(options: StudioOptions): Promise<ViteDevServer> {
  const { projectRoot, port, host, open, server } = options;
  const config: InlineConfig = mergeConfig(baseConfig(projectRoot), {
    publicDir: false,
    clearScreen: false,
    // the project's, never this package's: it may be an npx cache
    cacheDir: path.join(projectRoot, "node_modules/.fumadocs-studio"),
    plugins: [
      studioPlugin(options),
      packageAccess(),
      // the app's StyleX compiles per request; its CSS is served from a virtual endpoint
      stylex({
        dev: false,
        classNamePrefix: "fds",
        propertyValidationMode: "throw",
        unstable_moduleResolution: { type: "commonJS", rootDir: studioDir },
        lightningcssOptions: {
          targets: { chrome: 120 << 16, firefox: 120 << 16, safari: 17 << 16 },
        },
      }),
    ],
    server: { port, host, open },
    optimizeDeps: { include: optimizeInclude() },
  } satisfies InlineConfig);
  const vite = await createServer(mergeConfig(config, server.vite ?? {}));
  await vite.listen();
  return vite;
}
