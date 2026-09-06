import { parseArgs } from "node:util";

export interface StudioArgs {
  root?: string;
  config?: string;
  port?: number;
  /** listen on all addresses */
  host?: boolean;
  open?: boolean;
  help?: boolean;
  version?: boolean;
}

export function parseCliArgs(argv: string[]): StudioArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowNegative: true,
    options: {
      root: { type: "string" },
      config: { type: "string" },
      port: { type: "string" },
      host: { type: "boolean" },
      open: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  let port: number | undefined;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`invalid port: ${values.port}`);
    }
  }
  return {
    root: values.root,
    config: values.config,
    port,
    host: values.host,
    open: values.open,
    help: values.help,
    version: values.version,
  };
}
