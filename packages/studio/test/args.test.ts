import { expect, test } from "vitest";
import { parseCliArgs } from "../src/args";

test("flags", () => {
  expect(parseCliArgs([])).toEqual({});
  expect(
    parseCliArgs(["--root", "docs", "--config", "c.ts", "--port", "4000", "--host", "--no-open"]),
  ).toMatchObject({ root: "docs", config: "c.ts", port: 4000, host: true, open: false });
  expect(parseCliArgs(["-h"]).help).toBe(true);
  expect(parseCliArgs(["-v"]).version).toBe(true);
});

test("rejects unknown flags, positionals and bad ports", () => {
  expect(() => parseCliArgs(["--nope"])).toThrow();
  expect(() => parseCliArgs(["docs"])).toThrow();
  expect(() => parseCliArgs(["--port", "80a"])).toThrow("invalid port");
  expect(() => parseCliArgs(["--port", "70000"])).toThrow("invalid port");
});
