import { stat } from "node:fs/promises";
import path from "node:path";
import { runnerImport } from "vite";
import type { StudioArgs } from "./args";
import type { StudioConfig, StudioServerConfig } from "./config";
import { baseConfig } from "./server";

const CONFIG_NAMES = ["ts", "mts", "tsx", "js", "mjs"].map(
  (ext) => `fumadocs-studio.config.${ext}`,
);
const ROOT_CANDIDATES = ["content/docs", "content"];
const DEFAULT_PORT = 5180;

export interface StudioOptions {
  /** absolute path of the loaded config file, if any */
  configFile?: string;
  /** the config file's directory (the cwd without one); relative config paths resolve against it */
  projectRoot: string;
  /** the directory being edited */
  contentRoot: string;
  port: number;
  host?: string | boolean;
  open: boolean;
  /** absolute paths of extra stylesheets */
  styles: string[];
  server: StudioServerConfig;
}

export interface ResolveStudioOptions {
  cwd: string;
  args?: StudioArgs;
  /** evaluates a config module and returns its default export; default: Vite's `runnerImport` */
  load?: (file: string, projectRoot: string) => Promise<unknown>;
}

const isDirectory = (file: string) =>
  stat(file).then(
    (s) => s.isDirectory(),
    () => false,
  );
const isFile = (file: string) =>
  stat(file).then(
    (s) => s.isFile(),
    () => false,
  );

async function loadModule(file: string, projectRoot: string): Promise<unknown> {
  const { module } = await runnerImport<{ default?: unknown }>(file, {
    ...baseConfig(projectRoot),
    logLevel: "warn",
  });
  return module.default;
}

export async function findConfigFile(cwd: string, explicit?: string): Promise<string | undefined> {
  if (explicit) {
    const file = path.resolve(cwd, explicit);
    if (!(await isFile(file))) throw new Error(`config file not found: ${file}`);
    return file;
  }
  for (const name of CONFIG_NAMES) {
    const file = path.join(cwd, name);
    if (await isFile(file)) return file;
  }
}

async function findContentRoot(projectRoot: string, explicit?: string): Promise<string> {
  if (explicit) {
    if (!(await isDirectory(explicit))) {
      throw new Error(
        `content directory not found: ${explicit}\nPass --root <dir> or set \`root\` in fumadocs-studio.config.ts`,
      );
    }
    return explicit;
  }
  for (const candidate of ROOT_CANDIDATES) {
    const dir = path.join(projectRoot, candidate);
    if (await isDirectory(dir)) return dir;
  }
  return projectRoot;
}

/** CLI flags win over the config file, the config over the defaults */
export async function resolveStudioOptions({
  cwd,
  args = {},
  load = loadModule,
}: ResolveStudioOptions): Promise<StudioOptions> {
  const configFile = await findConfigFile(cwd, args.config);
  const projectRoot = configFile ? path.dirname(configFile) : cwd;
  const config = configFile
    ? (((await load(configFile, projectRoot)) as StudioConfig | undefined) ?? {})
    : {};
  const server =
    typeof config.server === "string"
      ? (((await load(path.resolve(projectRoot, config.server), projectRoot)) as
          | StudioServerConfig
          | undefined) ?? {})
      : (config.server ?? {});
  const explicitRoot = args.root
    ? path.resolve(cwd, args.root)
    : config.root
      ? path.resolve(projectRoot, config.root)
      : undefined;
  const styles: string[] = [];
  for (const file of config.styles ?? []) styles.push(path.resolve(projectRoot, file));
  return {
    configFile,
    projectRoot,
    contentRoot: await findContentRoot(projectRoot, explicitRoot),
    port: args.port ?? config.port ?? DEFAULT_PORT,
    host: args.host || config.host,
    open: args.open ?? config.open ?? true,
    styles,
    server,
  };
}
