import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: "./test/fixtures/workspace",
  // VS Code puts an IPC socket in the user-data dir; under a long checkout path it exceeds
  // the 104-byte Unix socket limit and the test instance fails with `listen EINVAL`.
  launchArgs: ["--user-data-dir", join(tmpdir(), "diff-boss-vscode-test")],
  mocha: { ui: "tdd", timeout: 20000 },
});
