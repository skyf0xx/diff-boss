// Runs before every unit test file. Host API mocks live in test/mocks and are
// aliased in vitest.config.ts, so tests import "vscode" as the real code does.
import { beforeEach } from "vitest";
import { resetVscodeMock } from "./mocks/vscode";

beforeEach(() => {
  resetVscodeMock();
});
