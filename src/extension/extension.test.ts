import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Hunk } from "../contract/hunk";
import type { HostToWebview } from "../contract/messages";
import { GitCommandError, ProviderError } from "../contract/ports";
import type { GitPort, Provider } from "../contract/ports";
import { LaunchRefusedError, resolveRepoPath } from "./activate";
import { CLAUDE_NOT_FOUND_MESSAGE, createClaudeQuery, findClaudeExecutable } from "./claude-runtime";
import { ReviewController, type ControllerDeps } from "./controller";
import { firstNewLine } from "./hunk-location";
import { buildCsp, renderHtml } from "./panel";
import { SettingsError, readSettings } from "./settings";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "db-unit-")));

describe("settings", () => {
  it("applies defaults", () => {
    expect(readSettings({ get: () => undefined })).toEqual({ provider: "claude", model: "sonnet", maxAttempts: 3 });
  });
  it("rejects a bad maxAttempts with a readable error", () => {
    const get = <T>(k: string) => (k === "maxAttempts" ? (0 as T) : undefined);
    expect(() => readSettings({ get })).toThrow(SettingsError);
    expect(() => readSettings({ get })).toThrow(/diffBoss\.maxAttempts/);
  });
});

describe("firstNewLine", () => {
  it("reads the new-side start", () => {
    expect(firstNewLine("@@ -10,4 +12,6 @@ fn")).toBe(12);
    expect(firstNewLine("@@ -1 +1 @@")).toBe(1);
    expect(firstNewLine("@@ -3,2 +0,0 @@")).toBe(1);
    expect(firstNewLine("garbage")).toBe(1);
  });
});

describe("renderHtml", () => {
  const html = `<head><script type="module" crossorigin src="./assets/a.js"></script><link rel="stylesheet" href="./assets/a.css"></head>`;
  const out = renderHtml(html, { nonce: "N0NCE", cspSource: "SRC", assetUri: (r) => `vsc://x/${r}` });
  it("rewrites asset URIs, injects the nonce and sets the CSP", () => {
    expect(out).toContain('src="vsc://x/assets/a.js"');
    expect(out).toContain('href="vsc://x/assets/a.css"');
    expect(out).toContain('<script nonce="N0NCE" type="module"');
    expect(out).toContain(`content="${buildCsp("N0NCE", "SRC")}"`);
    expect(buildCsp("n", "S")).toBe(
      "default-src 'none'; script-src 'nonce-n' S; style-src S; font-src S; img-src S data:",
    );
  });
});

describe("resolveRepoPath", () => {
  it("defaults to the first folder, accepts inside paths, refuses outside ones", () => {
    const a = tmp();
    const b = tmp();
    mkdirSync(join(a, "sub"));
    expect(resolveRepoPath(undefined, [a, b])).toBe(a);
    expect(resolveRepoPath(join(a, "sub"), [a])).toBe(join(a, "sub"));
    expect(() => resolveRepoPath(b, [a])).toThrow(LaunchRefusedError);
    expect(() => resolveRepoPath(join(a, "..", "x"), [a])).toThrow(/outside the open workspace folders/);
    expect(() => resolveRepoPath(undefined, [])).toThrow(LaunchRefusedError);
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  });
  it("sees through a symlinked folder", () => {
    const real = tmp();
    const holder = tmp();
    const link = join(holder, "link");
    symlinkSync(real, link);
    expect(resolveRepoPath(real, [link])).toBe(real);
  });
});

describe("claude runtime", () => {
  it("finds an executable claude on PATH", () => {
    const dir = tmp();
    const bin = join(dir, "claude");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    expect(findClaudeExecutable({ PATH: dir }, "linux", dir)).toBe(realpathSync(bin));
    expect(findClaudeExecutable({ PATH: "" }, "linux", tmp(), [])).toBeUndefined();
  });

  it("passes the found executable to the SDK query", async () => {
    const seen: unknown[] = [];
    const query = createClaudeQuery(
      () => "/x/claude",
      async () => ({
        query: (params) => {
          seen.push(params.options);
          return (async function* () {})();
        },
      }),
    );
    for await (const _ of query({ prompt: "p", options: { model: "m" } })) void _;
    expect(seen).toEqual([{ model: "m", pathToClaudeCodeExecutable: "/x/claude" }]);
  });

  it("throws a named error when claude is not installed", async () => {
    const query = createClaudeQuery(() => undefined, async () => ({ query: () => (async function* () {})() }));
    await expect((async () => { for await (const _ of query({ prompt: "p" })) void _; })()).rejects.toThrow(
      new ProviderError(CLAUDE_NOT_FOUND_MESSAGE, "claude"),
    );
  });
});

const hunk = (id: string, file: string): Hunk => ({ id, file, status: "modified", header: "@@ -1 +1 @@", patch: `p-${id}` });

function setup(over: Partial<ControllerDeps> = {}, provider?: Provider) {
  const posted: HostToWebview[] = [];
  const hunks = [hunk("h1", "a.ts"), hunk("h2", "b.ts")];
  const git: GitPort = {
    collect: vi.fn(async () => ({ hunks, recentCommits: [] })),
    recentCommits: vi.fn(async () => []),
    checkApplies: vi.fn(async () => ({ ok: true as const })),
    stage: vi.fn(async () => {}),
    unstage: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
  };
  const host = { post: (m: HostToWebview) => void posted.push(m), showError: vi.fn(), openFile: vi.fn(async () => {}) };
  const fake: Provider = provider ?? {
    id: "fake",
    generatePlan: async () =>
      JSON.stringify({
        stages: [
          { type: "feat", scope: "a", description: "change a", hunks: [{ id: "h1", summary: "A line changed.", needs: [] }] },
          { type: "fix", scope: "b", description: "change b", hunks: [{ id: "h2", summary: "A line changed.", needs: ["h1"] }] },
        ],
      }),
  };
  const controller = new ReviewController({
    git,
    repoRoot: async () => "/repo",
    scratchIndex: { apply: async (hs) => hs.map((h) => ({ id: h.id, ok: true as const })) },
    readSettings: () => ({ provider: "fake", model: "m", maxAttempts: 2 }),
    resolveProvider: () => fake,
    loadSkill: async () => ({ body: "s", references: {} }),
    host,
    ...over,
  });
  return { controller, git, host, posted };
}

describe("ReviewController", () => {
  it("posts loading, generating, then review", async () => {
    const { controller, posted } = setup();
    await controller.start();
    expect(posted.map((m) => m.type)).toEqual(["loading", "generating", "review"]);
  });

  it("turns a ProviderError into a failed state and an error message", async () => {
    const { controller, posted, host } = setup(
      {},
      { id: "x", generatePlan: async () => { throw new ProviderError("not signed in", "x"); } },
    );
    await controller.start();
    expect(posted.at(-1)).toEqual({ type: "failed", problems: [{ field: "review", message: "not signed in" }] });
    expect(host.showError).toHaveBeenCalledWith("diff-boss: not signed in");
  });

  it("turns a GitCommandError into a failed state", async () => {
    const { controller, posted, git, host } = setup();
    vi.mocked(git.collect).mockRejectedValue(new GitCommandError("git broke", ["status"], 128, "fatal: not a repo\n"));
    await controller.start();
    expect(posted.at(-1)).toMatchObject({ type: "failed" });
    expect(host.showError).toHaveBeenCalledWith("diff-boss: Git failed: fatal: not a repo");
  });

  it("posts the last problems when attempts run out", async () => {
    const { controller, posted } = setup({}, { id: "x", generatePlan: async () => "not json" });
    await controller.start();
    expect(posted.at(-1)).toMatchObject({ type: "failed" });
  });

  it("acts on stored patches and never recollects", async () => {
    const { controller, git } = setup();
    await controller.start();
    await controller.handleMessage({ type: "stageHunk", hunkId: "h1" });
    expect(git.stage).toHaveBeenCalledWith(expect.objectContaining({ id: "h1", patch: "p-h1" }));
    expect(git.collect).toHaveBeenCalledTimes(1);
  });

  it("checks before acting and posts stale on failure, then refuses until rerun", async () => {
    const { controller, git, posted } = setup();
    await controller.start();
    vi.mocked(git.checkApplies).mockResolvedValue({ ok: false, reason: "drift" });
    await controller.handleMessage({ type: "stageHunk", hunkId: "h1" });
    expect(posted.at(-1)).toEqual({ type: "stale" });
    expect(git.stage).not.toHaveBeenCalled();
    await controller.handleMessage({ type: "unstageHunk", hunkId: "h1" });
    expect(git.checkApplies).toHaveBeenCalledTimes(1);
  });

  it("discards only after confirm, with dependents", async () => {
    const { controller, git, posted } = setup();
    await controller.start();
    await controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
    expect(posted.at(-1)).toEqual({ type: "confirmDiscard", hunkId: "h1", dependents: [2] });
    expect(git.discard).not.toHaveBeenCalled();
    await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
    expect(git.checkApplies).toHaveBeenCalledWith(expect.objectContaining({ id: "h1" }), "discard");
    expect(git.discard).toHaveBeenCalledTimes(1);
  });

  it("commit uses the edited message and advances; skip advances", async () => {
    const { controller, git, posted } = setup();
    await controller.start();
    await controller.handleMessage({ type: "commit", stageIndex: 0, message: "feat(a): edited" });
    expect(git.commit).toHaveBeenCalledWith("feat(a): edited");
    const after = posted.at(-1);
    expect(after).toMatchObject({ type: "review", state: { currentStage: 1 } });
    await controller.handleMessage({ type: "skip", stageIndex: 1 });
    expect(posted.at(-1)).toMatchObject({ state: { currentStage: 2 } });
  });

  it("keeps the review and shows an error when a git action throws", async () => {
    const { controller, git, host, posted } = setup();
    await controller.start();
    vi.mocked(git.commit).mockRejectedValue(new GitCommandError("x", [], 1, "nothing to commit"));
    await controller.handleMessage({ type: "commit", stageIndex: 0, message: "m" });
    expect(host.showError).toHaveBeenCalledWith("diff-boss: Git failed: nothing to commit");
    expect(posted.at(-1)?.type).toBe("review");
  });

  it("opens the file at the first new-side line", async () => {
    const { controller, host } = setup();
    await controller.start();
    await controller.handleMessage({ type: "openFile", hunkId: "h2" });
    expect(host.openFile).toHaveBeenCalledWith("/repo/b.ts", 1);
  });

  it("ignores messages that fail the contract schema", async () => {
    const { controller, posted, git } = setup();
    await controller.start();
    const n = posted.length;
    await controller.handleMessage({ type: "stageHunk" });
    await controller.handleMessage(42);
    expect(posted.length).toBe(n);
    expect(git.stage).not.toHaveBeenCalled();
  });
});
