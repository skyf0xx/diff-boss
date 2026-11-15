import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToWebview } from "../contract/messages";
import type { Provider } from "../contract/ports";
import { GitCliPort, GitScratchIndex } from "../git";
import { createDefaultRegistry, loadSkill } from "../providers";
import { createClaudeQuery } from "./claude-runtime";
import { ReviewController } from "./controller";
import { FilePlanSource, buildHunkIndex, handoffDir, writeHunkIndex } from "./handoff";
import { ReviewPanel } from "./panel";
import { readSettings } from "./settings";

export const REVIEW_COMMAND = "diffBoss.review";
export const REVIEW_URI_PATH = "/review";
/** Writes the hunk index an agent session plans from. */
export const PREPARE_URI_PATH = "/prepare";
/** Opens the review with the plan the agent session wrote, with no provider call. */
export const REVIEW_PLAN_URI_PATH = "/review-plan";

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

/** Reads the `path` query parameter, keeping `+` literal (a path is not form-encoded). */
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
  repo: string;
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

  const skillDir = () => path.join(context.extensionPath, "skill");
  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function launch(requested?: string, fromAgent = false): Promise<ReviewController | undefined> {
    let repo: string;
    let planSource: FilePlanSource | undefined;
    try {
      repo = open && !requested ? open.repo : resolveRepoPath(requested, workspaceFolders());
      if (fromAgent) planSource = new FilePlanSource(await handoffDir(repo));
    } catch (err) {
      showError(`diff-boss: ${errorText(err)}`);
      return undefined;
    }
    if (open && fromAgent && open.repo !== repo) {
      open.panel.dispose();
      open = undefined;
    }
    if (open) {
      if (fromAgent) {
        open.controller.usePlanSource(planSource);
        void open.controller.start();
      }
      open.panel.reveal();
      return open.controller;
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
      loadSkill: () => loadSkill(skillDir()),
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

  async function prepare(requested?: string): Promise<void> {
    let dir: string | undefined;
    try {
      const repo = resolveRepoPath(requested, workspaceFolders());
      dir = await handoffDir(repo);
      const input = await new GitCliPort(repo).collect();
      await writeHunkIndex(dir, buildHunkIndex(input, dir, skillDir()));
      vscode.window.setStatusBarMessage(`diff-boss: ${input.hunks.length} hunks ready for planning`, 5000);
    } catch (err) {
      const message = errorText(err);
      if (dir) await new FilePlanSource(dir).report({ ok: false, problems: [{ field: "prepare", message }] }).catch(() => {});
      showError(`diff-boss: ${message}`);
    }
  }

  const routes: Record<string, (requested: string | undefined) => Promise<unknown>> = {
    [REVIEW_URI_PATH]: (requested) => launch(requested),
    [PREPARE_URI_PATH]: (requested) => prepare(requested),
    [REVIEW_PLAN_URI_PATH]: (requested) => launch(requested, true),
  };

  async function handleUri(uri: vscode.Uri): Promise<void> {
    const route = routes[uri.path];
    if (!route) {
      showError(`diff-boss: unknown link ${uri.path}; expected one of ${Object.keys(routes).join(", ")}`);
      return;
    }
    let requested: string | undefined;
    try {
      requested = parsePathParam(uri.query);
    } catch {
      showError("diff-boss: the link has a malformed path");
      return;
    }
    await route(requested);
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
