import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToWebview } from "../contract/messages";
import { GitCliPort, GitScratchIndex } from "../git";
import { ReviewController } from "./controller";
import { FilePlanSource, handoffDir } from "./handoff";
import { ReviewPanel } from "./panel";

/** Validates `<git-dir>/diff-boss/plan.json` and opens the review with it. */
export const REVIEW_URI_PATH = "/review";

export class LaunchRefusedError extends Error {
  override readonly name = "LaunchRefusedError";
}

function realOrSame(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/** The repository to review, or a refusal naming why not. Returns the real path. */
export function resolveRepoPath(requested: string | undefined, folders: readonly string[]): string {
  if (folders.length === 0) {
    throw new LaunchRefusedError("Open a folder first: diff-boss reviews the repository of an open workspace folder");
  }
  if (requested === undefined || requested === "") return folders[0]!;
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(requested));
  } catch {
    throw new LaunchRefusedError(`Refusing to review ${requested}: the path cannot be resolved`);
  }
  if (!folders.some((f) => isInside(realOrSame(f), real))) {
    throw new LaunchRefusedError(`Refusing to review ${requested}: it is outside the open workspace folders`);
  }
  return real;
}

/**
 * `path` is the link's only parameter, so its value is everything after `path=`. `query` is
 * `vscode.Uri.query`, which VS Code has already percent-decoded, so `&`, `+` and `%` in the
 * value are literal and are not decoded again.
 */
export function parsePathParam(query: string): string | undefined {
  const at = query.startsWith("path=") ? 0 : query.indexOf("&path=") + 1;
  if (at === 0 && !query.startsWith("path=")) return undefined;
  return query.slice(at + "path=".length);
}

export interface DiffBossTestApi {
  /** Same entry point the URI handler uses. */
  handleUri(uri: vscode.Uri): Promise<void>;
  launch(repoPath?: string): Promise<ReviewController | undefined>;
  controller(): ReviewController | undefined;
  panelsCreated(): number;
  closePanel(): void;
  /**
   * Replaces the open workspace folders the launch checks against, or restores them with
   * `undefined`. Adding real folders to a single-folder test workspace restarts the host.
   */
  overrideWorkspaceFolders(folders: readonly string[] | undefined): void;
  /** Receives every message the host posts to the webview. Returns an unsubscribe. */
  observe(listener: (message: HostToWebview) => void): () => void;
}

export interface DiffBossApi {
  test: DiffBossTestApi;
}

interface OpenReview {
  panel: ReviewPanel;
  controller: ReviewController;
  repo: string;
}

export function activate(context: vscode.ExtensionContext): DiffBossApi {
  const observers = new Set<(message: HostToWebview) => void>();
  let open: OpenReview | undefined;
  let panelsCreated = 0;

  const showError = (message: string) => {
    void vscode.window.showErrorMessage(message);
  };

  let folderOverride: readonly string[] | undefined;
  const workspaceFolders = () =>
    folderOverride ?? (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function launch(requested?: string): Promise<ReviewController | undefined> {
    let repo: string;
    let planSource: FilePlanSource;
    try {
      repo = resolveRepoPath(requested, workspaceFolders());
      planSource = new FilePlanSource(await handoffDir(repo));
    } catch (err) {
      showError(`diff-boss: ${errorText(err)}`);
      return undefined;
    }
    if (open && open.repo !== repo) {
      open.panel.dispose();
      open = undefined;
    }
    if (open) {
      void open.controller.start();
      open.panel.reveal();
      return open.controller;
    }

    const git = new GitCliPort(repo);
    let panel: ReviewPanel | undefined;
    const controller = new ReviewController({
      git,
      repoRoot: () => git.root(),
      scratchIndex: new GitScratchIndex(repo),
      planSource,
      host: {
        post: (message) => {
          panel?.post(message);
          for (const o of observers) o(message);
        },
        showError,
        openFile: async (absolutePath, line) => {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
          const pos = new vscode.Position(Math.max(0, line - 1), 0);
          await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
        },
      },
    });

    panelsCreated++;
    const reviewPanel = new ReviewPanel(context.extensionUri, {
      onMessage: (raw) => void controller.handleMessage(raw),
      onDispose: () => {
        controller.dispose();
        if (open?.controller === controller) open = undefined;
      },
    });
    panel = reviewPanel;
    open = { panel: reviewPanel, controller, repo };
    try {
      await reviewPanel.load();
    } catch (err) {
      reviewPanel.dispose();
      showError(`diff-boss: could not load the review view (${err instanceof Error ? err.message : String(err)})`);
      return undefined;
    }
    void controller.start();
    return controller;
  }

  async function handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== REVIEW_URI_PATH) {
      showError(`diff-boss: unknown link ${uri.path}; expected ${REVIEW_URI_PATH}`);
      return;
    }
    let requested: string | undefined;
    try {
      requested = parsePathParam(uri.query);
    } catch {
      showError("diff-boss: the link has a malformed path");
      return;
    }
    await launch(requested);
  }

  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri }),
    { dispose: () => open?.panel.dispose() },
  );

  return {
    test: {
      handleUri,
      launch,
      controller: () => open?.controller,
      panelsCreated: () => panelsCreated,
      closePanel: () => open?.panel.dispose(),
      overrideWorkspaceFolders: (folders) => {
        folderOverride = folders;
      },
      observe: (listener) => {
        observers.add(listener);
        return () => observers.delete(listener);
      },
    },
  };
}

export function deactivate(): void {}
