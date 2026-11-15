// Shared, composable fake of the `vscode` module for unit tests. Extend this
// file when a layer starts using a new host API; do not hand-roll vi.mock
// blocks per test file.
import { vi } from "vitest";

export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showTextDocument: vi.fn(),
  createWebviewPanel: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({ get: vi.fn() })),
  openTextDocument: vi.fn(),
  workspaceFolders: undefined as unknown,
};

export const Uri = {
  file: (fsPath: string) => ({ scheme: "file", fsPath, path: fsPath }),
  parse: (value: string) => ({ scheme: "unknown", fsPath: value, path: value }),
};

export const ViewColumn = { One: 1, Two: 2, Beside: -2 } as const;

export function resetVscodeMock(): void {
  for (const group of [window, commands]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  workspace.getConfiguration.mockReset();
  workspace.getConfiguration.mockImplementation(() => ({ get: vi.fn() }));
  workspace.openTextDocument.mockReset();
  workspace.workspaceFolders = undefined;
}
