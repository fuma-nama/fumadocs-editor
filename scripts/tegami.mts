import { x } from "tinyexec";
import { tegami } from "tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";
import type { TegamiPlugin } from "tegami";

function buildOnPublish(): TegamiPlugin {
  return {
    name: "build-on-publish",
    async willPublish({ pkg }) {
      const result = await x("pnpm", ["turbo", "run", "build", "--filter", pkg.name], {
        nodeOptions: { cwd: this.cwd },
      });

      if (result.exitCode !== 0) {
        throw new Error(`Failed to build ${pkg.name}`);
      }
    },
  };
}

const paper = tegami({
  npm: {
    updateLockFile: true,
  },
  plugins: [
    github({
      repo: "fuma-nama/fumadocs-editor",
      versionPr: {
        base: "dev",
      },
    }),
    buildOnPublish(),
  ],
  ignore: ["playground", "docs", "fumadocs-editor", "@repo/typescript-config"],
});

void createCli(paper).parseAsync();
