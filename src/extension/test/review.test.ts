import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { HostToWebview, ReviewState } from "../../contract/messages";
import type { DiffBossApi, DiffBossTestApi } from "../activate";

const EXTENSION_ID = "diff-boss.diff-boss";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** Twenty leading lines push each change away from line 1. */
const PAD = Array.from({ length: 20 }, (_, i) => `pad ${i + 1}\n`).join("");

/** Two files, each changed once, so the review has two hunks. */
function makeRepo(name?: string): string {
  let dir = realpathSync(mkdtempSync(join(tmpdir(), "diff-boss-it-")));
  if (name) {
    dir = join(dir, name);
    mkdirSync(dir);
  }
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), PAD + "one\ntwo\nthree\n");
  writeFileSync(join(dir, "b.txt"), PAD + "red\ngreen\nblue\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "chore: start");
  writeFileSync(join(dir, "a.txt"), PAD + "one\nTWO\nthree\n");
  writeFileSync(join(dir, "b.txt"), PAD + "red\ngreen\nBLUE\n");
  return dir;
}

const PLAN = {
  stages: [
    { header: "feat(first): change the first file", files: { "a.txt": "One line in the first file changed." } },
    { header: "fix(second): change the second file", files: { "b.txt": "One line in the second file changed." } },
  ],
};

function writePlan(dir: string, plan: unknown = PLAN): void {
  mkdirSync(join(dir, ".git", "diff-boss"), { recursive: true });
  writeFileSync(join(dir, ".git", "diff-boss", "plan.json"), JSON.stringify(plan));
}

let api: DiffBossTestApi;
let seen: HostToWebview[] = [];
let unobserve: () => void = () => {};
const repos: string[] = [];

async function newRepoInWorkspace(name?: string): Promise<string> {
  const dir = makeRepo(name);
  writePlan(dir);
  repos.push(name ? join(dir, "..") : dir);
  api.overrideWorkspaceFolders([dir]);
  return dir;
}

function lastReview(): ReviewState {
  for (let i = seen.length - 1; i >= 0; i--) {
    const m = seen[i]!;
    if (m.type === "review") return m.state;
  }
  throw new Error("no review state was posted");
}

async function startReview(dir: string) {
  const controller = await api.launch(dir);
  assert.ok(controller, "launch returned a controller");
  await controller.idle();
  return controller;
}

suite("diff-boss extension", () => {
  setup(() => {
    seen = [];
    if (api) unobserve = api.observe((m) => seen.push(m));
  });

  teardown(async () => {
    unobserve();
    api?.closePanel();
    api?.overrideWorkspaceFolders(undefined);
    for (const dir of repos.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the extension contributes nothing and activates on a link", async () => {
    const ext = vscode.extensions.getExtension<DiffBossApi>(EXTENSION_ID);
    assert.ok(ext, "extension is installed in the test host");
    const pkg = ext.packageJSON as { contributes?: unknown; activationEvents: string[] };
    assert.strictEqual(pkg.contributes, undefined);
    assert.deepStrictEqual(pkg.activationEvents, ["onUri"]);
    assert.strictEqual(ext.isActive, false, "extension loads lazily");
    api = (await ext.activate()).test;
    unobserve = api.observe((m) => seen.push(m));
  });

  test("a review of a repo with two changes produces a review state", async () => {
    const dir = await newRepoInWorkspace();
    await startReview(dir);

    assert.strictEqual(seen[0]?.type, "loading");
    const state = lastReview();
    assert.deepStrictEqual(
      state.stages.map((s) => s.header),
      ["feat(first): change the first file", "fix(second): change the second file"],
    );
    assert.deepStrictEqual(
      state.stages.flatMap((s) => s.hunks.map((h) => h.file)).sort(),
      ["a.txt", "b.txt"],
    );
    assert.strictEqual(state.stages[0]!.hunks[0]!.summary, "One line in the first file changed.");
    assert.strictEqual(state.currentStage, 0);
  });

  test("a hard-to-read summary is accepted and carries its reading grade", async () => {
    const dir = await newRepoInWorkspace();
    writePlan(dir, {
      stages: [
        { header: "feat: a", files: { "a.txt": "Configuration initialization necessitates considerable architectural deliberation." } },
        { header: "feat: b", files: { "b.txt": "B changed." } },
      ],
    });
    await startReview(dir);
    assert.ok(!seen.some((m) => m.type === "failed"), "a high grade does not fail the plan");
    const hunks = lastReview().stages.flatMap((s) => s.hunks);
    assert.ok((hunks[0]!.readabilityGrade ?? 0) > 8, "the first hunk carries its grade");
    assert.strictEqual(hunks[1]!.readabilityGrade, undefined);
  });

  test("ready replays the current state", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    seen.length = 0;
    await controller.handleMessage({ type: "ready" });
    assert.strictEqual(seen.at(-1)?.type, "review");
  });

  test("stage and unstage change the index, and commit creates a commit", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    const first = lastReview().stages[0]!.hunks[0]!;

    await controller.handleMessage({ type: "stageHunk", hunkId: first.id });
    assert.strictEqual(git(dir, "diff", "--cached", "--name-only").trim(), first.file);
    assert.strictEqual(lastReview().stages[0]!.hunks[0]!.staged, true);

    await controller.handleMessage({ type: "unstageHunk", hunkId: first.id });
    assert.strictEqual(git(dir, "diff", "--cached", "--name-only").trim(), "");
    assert.strictEqual(lastReview().stages[0]!.hunks[0]!.staged, false);

    await controller.handleMessage({ type: "stageHunk", hunkId: first.id });
    await controller.handleMessage({ type: "commit", stageIndex: 0, message: "feat(first): edited message" });
    assert.strictEqual(git(dir, "log", "-1", "--format=%s").trim(), "feat(first): edited message");
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD").trim(), "2");
    const state = lastReview();
    assert.strictEqual(state.stages[0]!.committed, true);
    assert.strictEqual(state.currentStage, 1);

    // The second hunk still stages from its stored patch after the index moved.
    const second = state.stages[1]!.hunks[0]!;
    await controller.handleMessage({ type: "stageHunk", hunkId: second.id });
    assert.strictEqual(git(dir, "diff", "--cached", "--name-only").trim(), second.file);
  });

  test("skip moves to the next stage without committing", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    await controller.handleMessage({ type: "skip", stageIndex: 0 });
    assert.strictEqual(lastReview().currentStage, 1);
    assert.strictEqual(git(dir, "rev-list", "--count", "HEAD").trim(), "1");
  });

  test("discard asks first and reverts after confirm", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    const first = lastReview().stages[0]!.hunks[0]!;
    const original = first.file === "a.txt" ? PAD + "one\ntwo\nthree\n" : PAD + "red\ngreen\nblue\n";
    const edited = readFileSync(join(dir, first.file), "utf8");
    assert.notStrictEqual(edited, original);

    await controller.handleMessage({ type: "requestDiscard", hunkId: first.id });
    const confirm = seen.at(-1);
    assert.deepStrictEqual(confirm, { type: "confirmDiscard", hunkId: first.id });
    assert.strictEqual(readFileSync(join(dir, first.file), "utf8"), edited, "nothing discarded before confirm");

    await controller.handleMessage({ type: "confirmDiscard", hunkId: first.id });
    assert.strictEqual(readFileSync(join(dir, first.file), "utf8"), original);
    assert.ok(!lastReview().stages.flatMap((s) => s.hunks).some((h) => h.id === first.id));
  });

  test("a file edited after planning makes the next discard post stale", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    const first = lastReview().stages[0]!.hunks[0]!;
    const path = join(dir, first.file);
    writeFileSync(path, readFileSync(path, "utf8").replace(/TWO|BLUE/, "CHANGED AGAIN"));
    const drifted = readFileSync(path, "utf8");

    await controller.handleMessage({ type: "requestDiscard", hunkId: first.id });
    await controller.handleMessage({ type: "confirmDiscard", hunkId: first.id });
    assert.ok(seen.some((m) => m.type === "stale"));
    assert.strictEqual(readFileSync(path, "utf8"), drifted, "a stale discard changes nothing");

    seen.length = 0;
    await controller.handleMessage({ type: "stageHunk", hunkId: first.id });
    assert.strictEqual(git(dir, "diff", "--cached", "--name-only").trim(), "", "actions stay refused until rerun");

    await controller.handleMessage({ type: "rerun" });
    assert.strictEqual(seen[0]?.type, "loading");
    const fresh = lastReview().stages[0]!.hunks[0]!;
    await controller.handleMessage({ type: "stageHunk", hunkId: fresh.id });
    assert.strictEqual(git(dir, "diff", "--cached", "--name-only").trim(), fresh.file, "actions work again after rerun");
  });

  test("a change to the index after planning makes the next stage post stale", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    const first = lastReview().stages[0]!.hunks[0]!;
    git(dir, "add", first.file);

    await controller.handleMessage({ type: "stageHunk", hunkId: first.id });
    assert.ok(seen.some((m) => m.type === "stale"));
  });

  test("rerun starts a fresh session", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    seen.length = 0;
    await controller.handleMessage({ type: "rerun" });
    assert.strictEqual(seen[0]?.type, "loading");
    assert.strictEqual(seen.at(-1)?.type, "review");
  });

  test("a message that is not in the contract is ignored", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    seen.length = 0;
    await controller.handleMessage({ type: "nope" });
    await controller.handleMessage({ type: "commit", stageIndex: -1, message: "x" });
    assert.deepStrictEqual(seen, []);
  });

  test("open file opens the hunk's file at its first changed line", async () => {
    const dir = await newRepoInWorkspace();
    const controller = await startReview(dir);
    const first = lastReview().stages[0]!.hunks[0]!;
    await controller.handleMessage({ type: "openFile", hunkId: first.id });
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "an editor is open");
    assert.strictEqual(editor.document.uri.fsPath, join(dir, first.file));
    // The change is on line 22; the hunk starts three context lines earlier, at line 19.
    assert.strictEqual(editor.selection.active.line, 18);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("a URI whose path is outside the workspace folders is refused", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "diff-boss-outside-")));
    mkdirSync(join(outside, "x"), { recursive: true });
    try {
      const before = api.panelsCreated();
      const uri = vscode.Uri.parse(`vscode://${EXTENSION_ID}/review?path=${encodeURIComponent(outside)}`);
      await api.handleUri(uri);
      assert.strictEqual(api.panelsCreated(), before);
      assert.strictEqual(api.controller(), undefined);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a URI whose path is a workspace folder starts the review", async () => {
    const dir = await newRepoInWorkspace();
    const uri = vscode.Uri.parse(`vscode://${EXTENSION_ID}/review?path=${encodeURIComponent(dir)}`);
    await api.handleUri(uri);
    const controller = api.controller();
    assert.ok(controller);
    await controller.idle();
    assert.strictEqual(lastReview().stages.length, 2);
  });

  test("a URI path with +, %, & and spaces reaches the right repo", async () => {
    const dir = await newRepoInWorkspace("c++ 100% a&b");
    // A clean decoy listed first: if `path` were ignored, the review would run here and fail.
    const decoy = realpathSync(mkdtempSync(join(tmpdir(), "diff-boss-decoy-")));
    repos.push(decoy);
    git(decoy, "init", "-q");
    api.overrideWorkspaceFolders([decoy, dir]);
    const uri = vscode.Uri.parse(`vscode://${EXTENSION_ID}/review?path=${encodeURIComponent(dir)}`);
    await api.handleUri(uri);
    const controller = api.controller();
    assert.ok(controller, "the path was accepted");
    await controller.idle();
    assert.strictEqual(lastReview().stages.length, 2);
  });

  test("a second launch reuses the open panel", async () => {
    const dir = await newRepoInWorkspace();
    const first = await startReview(dir);
    const before = api.panelsCreated();
    const second = await api.launch(dir);
    await api.handleUri(vscode.Uri.parse(`vscode://${EXTENSION_ID}/review`));
    assert.strictEqual(second, first);
    assert.strictEqual(api.panelsCreated(), before);
  });

  test("the review link validates the plan file and reports the result", async () => {
    const dir = await newRepoInWorkspace();
    const result = join(dir, ".git", "diff-boss", "result.json");
    writePlan(dir, { stages: [{ header: "bad", files: {} }] });
    await api.handleUri(vscode.Uri.parse(`vscode://${EXTENSION_ID}/review?path=${encodeURIComponent(dir)}`));
    await api.controller()!.idle();
    assert.strictEqual(JSON.parse(readFileSync(result, "utf8")).ok, false);

    writePlan(dir);
    await api.handleUri(vscode.Uri.parse(`vscode://${EXTENSION_ID}/review?path=${encodeURIComponent(dir)}`));
    await api.controller()!.idle();
    assert.deepStrictEqual(JSON.parse(readFileSync(result, "utf8")), { ok: true, stages: 2 });
  });

  test("an unknown link is refused", async () => {
    const before = api.panelsCreated();
    await api.handleUri(vscode.Uri.parse(`vscode://${EXTENSION_ID}/prepare`));
    assert.strictEqual(api.panelsCreated(), before);
  });
});
