import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Hunk } from "../contract/hunk";
import type { HostToWebview } from "../contract/messages";
import { GitCommandError, ProviderError } from "../contract/ports";
import type { GitPort, Provider } from "../contract/ports";
import { LaunchRefusedError, parsePathParam, resolveRepoPath } from "./activate";
import { CLAUDE_NOT_FOUND_MESSAGE, createClaudeQuery, findClaudeExecutable } from "./claude-runtime";
import { ReviewController, type ControllerDeps } from "./controller";
import { firstNewLine } from "./hunk-location";
import { FilePlanSource, HUNKS_FILE, PLAN_FILE, RESULT_FILE, buildHunkIndex, handoffDir, writeHunkIndex } from "./handoff";
import { runGitChecked } from "../git";
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
  const withHunk = (h: string) => `diff --git a/f b/f\n--- a/f\n+++ b/f\n${h}\n-x\n+y\n`;
  it("reads the new-side start of the first hunk header in a patch", () => {
    expect(firstNewLine(withHunk("@@ -10,4 +12,6 @@ fn"))).toBe(12);
    expect(firstNewLine(withHunk("@@ -1 +1 @@"))).toBe(1);
    expect(firstNewLine(withHunk("@@ -3,2 +0,0 @@"))).toBe(1);
    expect(firstNewLine("diff --git a/f b/f\nnew mode 100755\n")).toBe(1);
  });
  it("uses the first @@ only", () => {
    expect(firstNewLine(withHunk("@@ -2 +5 @@") + "@@ -40 +90 @@\n")).toBe(5);
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

describe("renderHtml CSP placement", () => {
  it("puts the CSP meta before every script and link, and the script carries the nonce", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./assets/a.css"><script type="module" src="./assets/a.js"></script></head><body></body></html>`;
    const out = renderHtml(html, { nonce: "N0NCE", cspSource: "SRC", assetUri: (r) => `vsc://x/${r}` });
    const meta = out.indexOf("Content-Security-Policy");
    const script = out.indexOf("<script");
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(script);
    expect(meta).toBeLessThan(out.indexOf("<link"));
    expect(meta).toBeLessThan(out.indexOf('<meta charset'));
    expect(out.slice(script)).toMatch(/^<script nonce="N0NCE" type="module"/);
  });
});

describe("parsePathParam", () => {
  it("takes the already-decoded value literally, including +, % and &", () => {
    expect(parsePathParam("path=/tmp/a+b")).toBe("/tmp/a+b");
    expect(parsePathParam("path=/tmp/c++ 100% a&b")).toBe("/tmp/c++ 100% a&b");
    expect(parsePathParam("x=1&path=/tmp/a b")).toBe("/tmp/a b");
    expect(parsePathParam("path=")).toBe("");
    expect(parsePathParam("other=1")).toBeUndefined();
    expect(parsePathParam("")).toBeUndefined();
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
    expect(() => resolveRepoPath(join(a, "..", "x"), [a])).toThrow(LaunchRefusedError);
    expect(() => resolveRepoPath(join(a, ".."), [a])).toThrow(/outside the open workspace folders/);
    expect(() => resolveRepoPath(undefined, [])).toThrow(LaunchRefusedError);
    rmSync(a, { recursive: true });
    rmSync(b, { recursive: true });
  });
  it("refuses a symlink inside the workspace that points outside it", () => {
    const ws = tmp();
    const outside = tmp();
    symlinkSync(outside, join(ws, "escape"));
    expect(() => resolveRepoPath(join(ws, "escape"), [ws])).toThrow(/outside the open workspace folders/);
  });
  it("returns the real path of an accepted symlink", () => {
    const ws = tmp();
    mkdirSync(join(ws, "real"));
    symlinkSync(join(ws, "real"), join(ws, "alias"));
    expect(resolveRepoPath(join(ws, "alias"), [ws])).toBe(join(ws, "real"));
  });
  it("refuses a target that cannot be resolved", () => {
    const ws = tmp();
    expect(() => resolveRepoPath(join(ws, "missing"), [ws])).toThrow(LaunchRefusedError);
  });
  it("accepts a directory literally named ..foo", () => {
    const ws = tmp();
    mkdirSync(join(ws, "..foo"));
    expect(resolveRepoPath(join(ws, "..foo"), [ws])).toBe(join(ws, "..foo"));
  });
  it("refuses a sibling that shares the folder name as a prefix", () => {
    const root = tmp();
    mkdirSync(join(root, "repo"));
    mkdirSync(join(root, "repo-evil"));
    expect(() => resolveRepoPath(join(root, "repo-evil"), [join(root, "repo")])).toThrow(LaunchRefusedError);
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

const hunk = (id: string, file: string, at = "@@ -1 +1 @@"): Hunk => {
  const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`;
  return { id, file, status: "modified", header, patch: `${header}${at}\n-x\n+y\n` };
};

function setup(over: Partial<ControllerDeps> = {}, provider?: Provider) {
  const posted: HostToWebview[] = [];
  const hunks = [hunk("h1", "a.ts"), hunk("h2", "b.ts", "@@ -5,2 +7,3 @@")];
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
    expect(git.stage).toHaveBeenCalledWith(expect.objectContaining({ id: "h1", patch: hunk("h1", "a.ts").patch }));
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

  describe("host-side guards", () => {
    it("ignores commit and skip for a stage that is not current", async () => {
      const { controller, git, posted } = setup();
      await controller.start();
      const n = posted.length;
      await controller.handleMessage({ type: "commit", stageIndex: 1, message: "m" });
      await controller.handleMessage({ type: "skip", stageIndex: 1 });
      expect(git.commit).not.toHaveBeenCalled();
      expect(posted.length).toBe(n);
    });

    it("ignores a second commit of an already committed stage", async () => {
      const { controller, git } = setup();
      await controller.start();
      await controller.handleMessage({ type: "commit", stageIndex: 0, message: "m" });
      await controller.handleMessage({ type: "commit", stageIndex: 0, message: "again" });
      await controller.handleMessage({ type: "skip", stageIndex: 0 });
      expect(git.commit).toHaveBeenCalledTimes(1);
    });

    it("ignores confirmDiscard without a pending request", async () => {
      const { controller, git } = setup();
      await controller.start();
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      expect(git.discard).not.toHaveBeenCalled();
    });

    it("ignores confirmDiscard for a different hunk than requested", async () => {
      const { controller, git } = setup();
      await controller.start();
      await controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h2" });
      expect(git.discard).not.toHaveBeenCalled();
    });

    it("uses a pending request once", async () => {
      const { controller, git } = setup();
      await controller.start();
      await controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      expect(git.discard).toHaveBeenCalledTimes(1);
    });

    it("clears a pending request on any other action", async () => {
      const { controller, git } = setup();
      await controller.start();
      await controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
      await controller.handleMessage({ type: "openFile", hunkId: "h2" });
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      expect(git.discard).not.toHaveBeenCalled();
    });

    it("clears a pending request even when the actions are sent back to back", async () => {
      const { controller, git } = setup();
      await controller.start();
      void controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
      void controller.handleMessage({ type: "openFile", hunkId: "h2" });
      void controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      await controller.idle();
      expect(git.discard).not.toHaveBeenCalled();
    });

    it("refuses to discard a staged hunk and says to unstage first", async () => {
      const { controller, git, host, posted } = setup();
      await controller.start();
      await controller.handleMessage({ type: "stageHunk", hunkId: "h1" });
      await controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
      expect(posted.some((m) => m.type === "confirmDiscard")).toBe(false);
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining("unstage"));
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      expect(git.discard).not.toHaveBeenCalled();
    });

    it("refuses a confirmed discard if the hunk was staged after the request", async () => {
      const { controller, git } = setup();
      await controller.start();
      await controller.handleMessage({ type: "requestDiscard", hunkId: "h1" });
      await controller.handleMessage({ type: "stageHunk", hunkId: "h1" });
      await controller.handleMessage({ type: "confirmDiscard", hunkId: "h1" });
      expect(git.discard).not.toHaveBeenCalled();
    });
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
    expect(host.openFile).toHaveBeenCalledWith("/repo/b.ts", 7);
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

describe("agent handoff", () => {
  const goodPlan = JSON.stringify({
    stages: [
      { type: "feat", scope: "a", description: "change a", hunks: [{ id: "h1", summary: "A line changed.", needs: [] }] },
      { type: "fix", scope: "b", description: "change b", hunks: [{ id: "h2", summary: "A line changed.", needs: ["h1"] }] },
    ],
  });

  it("indexes hunks by id with their @@ line and first change, without patch bodies", () => {
    const index = buildHunkIndex({ hunks: [hunk("h1", "a.ts", "@@ -3 +3 @@ fn()")], recentCommits: ["feat: x"] }, "/g/diff-boss", "/ext/skill");
    expect(index).toEqual({
      skill: "/ext/skill/SKILL.md",
      planFile: "/g/diff-boss/plan.json",
      resultFile: "/g/diff-boss/result.json",
      recentCommits: ["feat: x"],
      hunks: [{ id: "h1", file: "a.ts", status: "modified", at: "@@ -3 +3 @@ fn()", firstChange: "-x" }],
    });
  });

  it("puts the handoff directory inside the git dir and clears an old plan and result", async () => {
    const repo = tmp();
    await runGitChecked(["init", "-q"], { cwd: repo });
    const dir = await handoffDir(repo);
    expect(dir).toBe(join(repo, ".git", "diff-boss"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PLAN_FILE), "old");
    writeFileSync(join(dir, RESULT_FILE), "old");
    await writeHunkIndex(dir, buildHunkIndex({ hunks: [], recentCommits: [] }, dir, "/s"));
    expect(existsSync(join(dir, PLAN_FILE))).toBe(false);
    expect(existsSync(join(dir, RESULT_FILE))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, HUNKS_FILE), "utf8")).hunks).toEqual([]);
    rmSync(repo, { recursive: true, force: true });
  });

  it("validates the session's plan with no provider call and reports success", async () => {
    const dir = tmp();
    writeFileSync(join(dir, PLAN_FILE), goodPlan);
    const generatePlan = vi.fn();
    const { controller, posted } = setup({ planSource: new FilePlanSource(dir) }, { id: "x", generatePlan });
    await controller.start();
    expect(generatePlan).not.toHaveBeenCalled();
    expect(posted.map((m) => m.type)).toEqual(["loading", "review"]);
    expect(JSON.parse(readFileSync(join(dir, RESULT_FILE), "utf8"))).toEqual({ ok: true, stages: 2 });
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the validator's ✗ lines for the session to fix, then rereads the plan on rerun", async () => {
    const dir = tmp();
    writeFileSync(join(dir, PLAN_FILE), JSON.stringify({ stages: [] }));
    const { controller, posted } = setup({ planSource: new FilePlanSource(dir) });
    await controller.start();
    expect(posted.at(-1)).toMatchObject({ type: "failed" });
    const failed = JSON.parse(readFileSync(join(dir, RESULT_FILE), "utf8"));
    expect(failed.ok).toBe(false);
    expect(failed.problems[0]).toMatch(/^✗ /);
    writeFileSync(join(dir, PLAN_FILE), goodPlan);
    await controller.handleMessage({ type: "rerun" });
    expect(posted.at(-1)).toMatchObject({ type: "review" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a missing plan as a problem", async () => {
    const dir = tmp();
    const { controller } = setup({ planSource: new FilePlanSource(dir) });
    await controller.start();
    const result = JSON.parse(readFileSync(join(dir, RESULT_FILE), "utf8"));
    expect(result).toMatchObject({ ok: false });
    expect(result.problems[0]).toMatch(/No plan at/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("switches an open review to the session's plan", async () => {
    const dir = tmp();
    writeFileSync(join(dir, PLAN_FILE), goodPlan);
    const generatePlan = vi.fn(async () => goodPlan);
    const { controller } = setup({}, { id: "x", generatePlan });
    await controller.start();
    controller.usePlanSource(new FilePlanSource(dir));
    await controller.start();
    expect(generatePlan).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, RESULT_FILE))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
