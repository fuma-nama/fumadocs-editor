#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { parseCliArgs, type StudioArgs } from "./args";
import { resolveStudioOptions } from "./load-config";
import { startStudio } from "./server";

const USAGE = `Usage: fumadocs-studio [options]

  --root <dir>     directory to edit (default: content/docs, content, then the current directory)
  --config <file>  config file (default: fumadocs-studio.config.{ts,mts,tsx,js,mjs})
  --port <n>       port (default: 5180)
  --host           listen on all addresses
  --no-open        do not open the browser
  -h, --help
  -v, --version
`;

function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let args: StudioArgs;
try {
  args = parseCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`\n${USAGE}`);
  process.exit(1);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (args.version) {
  console.log(createRequire(import.meta.url)("../package.json").version);
  process.exit(0);
}

const cwd = process.cwd();
const options = await resolveStudioOptions({ cwd, args }).catch(fail);
const server = await startStudio(options).catch(fail);
server.config.logger.info(
  `\n  fumadocs studio  editing ${path.relative(cwd, options.contentRoot) || "."}\n`,
);
server.printUrls();
server.bindCLIShortcuts({ print: true });

const stop = () => {
  // a close during the first pre-bundle waits on transforms that never settle
  setTimeout(() => process.exit(0), 2000).unref();
  server.close().then(() => process.exit(0), fail);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
