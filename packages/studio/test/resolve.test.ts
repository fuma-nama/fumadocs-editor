import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { findConfigFile, resolveStudioOptions } from "../src/load-config";

let dir: string;
const modules: Record<string, unknown> = {};
const load = async (file: string) => {
  if (!(file in modules)) throw new Error(`unexpected load: ${file}`);
  return modules[file];
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fde-studio-resolve-"));
  await mkdir(path.join(dir, "bare/content/docs"), { recursive: true });
  await mkdir(path.join(dir, "content-only/content"), { recursive: true });
  await mkdir(path.join(dir, "configured/docs"), { recursive: true });
  await mkdir(path.join(dir, "explicit"), { recursive: true });
  await writeFile(path.join(dir, "configured/fumadocs-studio.config.ts"), "");
  await writeFile(path.join(dir, "explicit/studio.mts"), "");
});
afterAll(() => rm(dir, { recursive: true, force: true }));

test("root fallback chain without a config", async () => {
  const bare = await resolveStudioOptions({ cwd: path.join(dir, "bare"), load });
  expect(bare).toEqual({
    configFile: undefined,
    projectRoot: path.join(dir, "bare"),
    contentRoot: path.join(dir, "bare/content/docs"),
    port: 5180,
    host: undefined,
    open: true,
    styles: [],
    server: {},
  });
  const contentOnly = await resolveStudioOptions({ cwd: path.join(dir, "content-only"), load });
  expect(contentOnly.contentRoot).toBe(path.join(dir, "content-only/content"));
  const explicit = await resolveStudioOptions({ cwd: path.join(dir, "explicit"), load });
  expect(explicit.contentRoot).toBe(path.join(dir, "explicit"));
});

test("config values, relative to the config file", async () => {
  const cwd = path.join(dir, "configured");
  const configFile = path.join(cwd, "fumadocs-studio.config.ts");
  const authenticate = () => null;
  modules[configFile] = {
    root: "docs",
    port: 4100,
    host: "127.0.0.1",
    open: false,
    styles: ["./studio.css"],
    server: { authenticate },
  };
  const options = await resolveStudioOptions({ cwd, load });
  expect(options).toEqual({
    configFile,
    projectRoot: cwd,
    contentRoot: path.join(cwd, "docs"),
    port: 4100,
    host: "127.0.0.1",
    open: false,
    styles: [path.join(cwd, "studio.css")],
    server: { authenticate },
  });
});

test("CLI flags win over the config", async () => {
  const cwd = path.join(dir, "configured");
  modules[path.join(cwd, "fumadocs-studio.config.ts")] = { port: 4100, open: false, root: "docs" };
  const options = await resolveStudioOptions({
    cwd,
    args: { port: 4200, host: true, open: true, root: "../explicit" },
    load,
  });
  expect(options.port).toBe(4200);
  expect(options.host).toBe(true);
  expect(options.open).toBe(true);
  expect(options.contentRoot).toBe(path.join(dir, "explicit"));
});

test("server as a module path is loaded separately", async () => {
  const cwd = path.join(dir, "configured");
  const evictAfterMs = 5;
  modules[path.join(cwd, "fumadocs-studio.config.ts")] = { server: "./studio.server.ts" };
  modules[path.join(cwd, "studio.server.ts")] = { evictAfterMs };
  const options = await resolveStudioOptions({ cwd, load });
  expect(options.server).toEqual({ evictAfterMs });
});

test("--config, missing files and missing roots", async () => {
  const explicit = path.join(dir, "explicit/studio.mts");
  expect(await findConfigFile(dir, "explicit/studio.mts")).toBe(explicit);
  expect(await findConfigFile(path.join(dir, "bare"))).toBeUndefined();
  await expect(findConfigFile(dir, "nope.ts")).rejects.toThrow("config file not found");
  await expect(
    resolveStudioOptions({ cwd: path.join(dir, "bare"), args: { root: "missing" }, load }),
  ).rejects.toThrow("content directory not found");
});
