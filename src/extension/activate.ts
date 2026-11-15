import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToWebview } from "../contract/messages";
import type { Provider } from "../contract/ports";
import { GitCliPort, GitScratchIndex } from "../git";
import { createDefaultRegistry, loadSkill } from "../providers";
import { createClaudeQuery } from "./claude-runtime";
import { ReviewController } from "./controller";
import { ReviewPanel } from "./panel";
import { readSettings } from "./settings";

export const REVIEW_COMMAND = "diffBoss.review";
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
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The repository to review, or a refusal naming why not. */
export function resolveRepoPath(requested: string | undefined, folders: readonly string[]): string {
  if (folders.length === 0) {
    throw new LaunchRefusedError("Open a folder first: diff-boss reviews the repository of an open workspace folder");
  }
  if (requested === undefined || requested === "") return folders[0]!;
  const target = path.resolve(requested);
  const real = realOrSame(target);
  const allowed = folders.some(
    (f) => isInside(path.resolve(f), target) || isInside(realOrSame(f), real),
  );
  if (!allowed) {
    throw new LaunchRefusedError(`Refusing to review ${requested}: it is outside the open workspace folders`);
  }
  return target;
}

export interface DiffBossTestApi {
  /** Makes `diffBoss.provider` accept this provider's id. Test seam: no model calls. */
  registerProvider(provider: Provider): void;
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
}

export function activate(context: vscode.ExtensionContext): DiffBossApi {
  const extraProviders: Provider[] = [];
  const observers = new Set<(message: HostToWebview) => void>();
  let open: OpenReview | undefined;
  let panelsCreated = 0;

  const showError = (message: string) => {
    void vscode.window.showErrorMessage(message);
  };

  let folderOverride: readonly string[] | undefined;
  const workspaceFolders = () =>
    folderOverride ?? (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

  async function launch(requested?: string): Promise<ReviewController | undefined> {
    if (open) {
      open.panel.reveal();
      return open.controller;
    }
    let repo: string;
    try {
      repo = resolveRepoPath(requested, workspaceFolders());
    } catch (err) {
      showError(`diff-boss: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }

    const git = new GitCliPort(repo);
    let panel: ReviewPanel | undefined;
    const controller = new ReviewController({
      git,
      repoRoot: () => git.root(),
      scratchIndex: new GitScratchIndex(repo),
      readSettings: () => readSettings(vscode.workspace.getConfiguration("diffBoss")),
      resolveProvider: (settings) => {
        const registry = createDefaultRegistry({
          claude: { model: settings.model, query: createClaudeQuery(), cwd: repo },
        });
        for (const p of extraProviders) registry.register(p);
        const provider = registry.get(settings.provider);
        if (!provider) {
          throw new Error(
            `No provider "${settings.provider}" is registered (available: ${registry.list().join(", ")})`,
          );
        }
        return provider;
      },
      loadSkill: () => loadSkill(path.join(context.extensionPath, "skill")),
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
    open = { panel: reviewPanel, controller };
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
    const requested = new URLSearchParams(uri.query).get("path") ?? undefined;
    await launch(requested);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(REVIEW_COMMAND, () => launch()),
    vscode.window.registerUriHandler({ handleUri }),
    { dispose: () => open?.panel.dispose() },
  );

  return {
    test: {
      registerProvider: (provider) => {
        extraProviders.push(provider);
      },
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
