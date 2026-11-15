import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const vscodeMock = fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url));
const setup = fileURLToPath(new URL("./test/setup.ts", import.meta.url));

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias: { vscode: vscodeMock } },
        test: {
          name: "host",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/extension/test/**", "node_modules/**"],
          setupFiles: [setup],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { vscode: vscodeMock } },
        test: {
          name: "webview",
          environment: "jsdom",
          include: ["webview/**/*.test.{ts,tsx}"],
          setupFiles: [setup],
        },
      },
    ],
  },
});
