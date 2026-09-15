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
import { editorSync } from "@fumadocs-editor/core/vite";
import type { StudioOptions } from "./load-config";

const appDir = path.resolve(import.meta.dirname, "../dist/app");

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

/** the config and the user's stylesheets as virtual modules of the app */
function studioPlugin({ configFile, styles }: StudioOptions): Plugin {
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
  };
}

/** starts the studio's Vite dev server; resolves once it listens */
export async function startStudio(options: StudioOptions): Promise<ViteDevServer> {
  const { projectRoot, contentRoot, port, host, open, server } = options;
  const { authenticate, upload, evictAfterMs, helloTimeoutMs } = server;
  const config: InlineConfig = mergeConfig(baseConfig(projectRoot), {
    publicDir: false,
    clearScreen: false,
    // the project's, never this package's: it may be an npx cache
    cacheDir: path.join(projectRoot, "node_modules/.fumadocs-studio"),
    plugins: [
      studioPlugin(options),
      editorSync({ root: contentRoot, authenticate, upload, evictAfterMs, helloTimeoutMs }),
      packageAccess(),
    ],
    server: { port, host, open },
    optimizeDeps: { include: optimizeInclude() },
  } satisfies InlineConfig);
  const vite = await createServer(mergeConfig(config, server.vite ?? {}));
  await vite.listen();
  return vite;
}
