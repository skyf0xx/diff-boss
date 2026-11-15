import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitCommandError } from "../contract/ports";
import { GitCliPort, GitScratchIndex } from "./index";
import { parseDiff, unquotePath } from "./parse";

const savedEnv: Record<string, string | undefined> = {};
const ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const k of Object.keys(ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

let dir: string;
let git: GitCliPort;
let scratch: GitScratchIndex;

const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
const read = (file: string) => readFileSync(join(dir, file), "utf8");
const lines = (prefix: string, n: number, mark = "") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}${mark && (i + 1) % 10 === 0 ? mark : ""}`).join("\n") + "\n";
const staged = () => sh("diff", "--cached", "--name-only").trim();

function initRepo(): void {
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "Test");
  sh("config", "user.email", "test@example.com");
  sh("config", "commit.gpgsign", "false");
}

function commitAll(msg = "init"): void {
  sh("add", "-A");
  sh("commit", "-q", "-m", msg);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "diff-boss-git-"));
  initRepo();
  git = new GitCliPort(dir);
  scratch = new GitScratchIndex(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A 40-line file where editing lines 2 and 38 yields two separate hunks.
const base = lines("line ", 40);
const twoEdits = base.replace("line 2\n", "line 2 changed\n").replace("line 38\n", "line 38 changed\n");

describe("collect", () => {
  it("reports a modified file with one hunk per @@ and a self-contained patch", async () => {
    write("a.txt", base);
    commitAll();
    write("a.txt", twoEdits);
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(2);
    for (const h of hunks) {
      expect(h.status).toBe("modified");
      expect(h.file).toBe("a.txt");
      expect(h.patch.startsWith("diff --git a/a.txt b/a.txt\n")).toBe(true);
      expect(h.patch.startsWith(h.header)).toBe(true);
      expect(h.patch.match(/^@@ /gm)).toHaveLength(1);
    }
    expect(hunks[0]!.id).not.toBe(hunks[1]!.id);
    expect(hunks[0]!.patch).toContain("+line 2 changed");
    expect(hunks[0]!.patch).toContain(" line 1");
  });

  it("reports an added file (intent-to-add) as added", async () => {
    write("keep.txt", "k\n");
    commitAll();
    write("new.txt", "hello\n");
    sh("add", "-N", "new.txt");
    const { hunks } = await git.collect();
    expect(hunks.map((h) => [h.file, h.status])).toEqual([["new.txt", "added"]]);
  });

  it("reports a deleted file", async () => {
    write("gone.txt", "bye\n");
    commitAll();
    unlinkSync(join(dir, "gone.txt"));
    const { hunks } = await git.collect();
    expect(hunks.map((h) => [h.file, h.status])).toEqual([["gone.txt", "deleted"]]);
    expect(hunks[0]!.patch).toContain("-bye");
  });

  it("reports a renamed file (intent-to-add new path, old path removed)", async () => {
    write("old.txt", lines("row ", 20));
    commitAll();
    unlinkSync(join(dir, "old.txt"));
    write("new.txt", lines("row ", 20).replace("row 5\n", "row five\n"));
    sh("add", "-N", "new.txt");
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ file: "new.txt", status: "renamed" });
    expect(hunks[0]!.patch).toContain("rename from old.txt");
    const stage = await git.checkApplies(hunks[0]!, "stage");
    expect(stage.ok).toBe(true);
  });

  it("reports an untracked file with an applicable new-file patch", async () => {
    write("keep.txt", "k\n");
    commitAll();
    write("fresh.txt", "one\ntwo\n");
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ file: "fresh.txt", status: "untracked" });
    expect(hunks[0]!.patch).toContain("new file mode");
    await git.stage(hunks[0]!);
    expect(staged()).toBe("fresh.txt");
    expect(sh("show", ":fresh.txt")).toBe("one\ntwo\n");
  });

  it("reports an empty untracked file and can stage it", async () => {
    write("keep.txt", "k\n");
    commitAll();
    write("empty.txt", "");
    const { hunks } = await git.collect();
    expect(hunks.map((h) => [h.file, h.status])).toEqual([["empty.txt", "untracked"]]);
    await git.stage(hunks[0]!);
    expect(staged()).toBe("empty.txt");
  });

  it("handles file names with spaces", async () => {
    write("my file.txt", "a\n");
    commitAll();
    write("my file.txt", "b\n");
    write("other file.txt", "x\n");
    const { hunks } = await git.collect();
    expect(hunks.map((h) => [h.file, h.status])).toEqual([
      ["my file.txt", "modified"],
      ["other file.txt", "untracked"],
    ]);
    await git.stage(hunks[0]!);
    await git.stage(hunks[1]!);
    expect(staged().split("\n").sort()).toEqual(["my file.txt", "other file.txt"]);
  });

  it("reports a mode-only change as one header-only hunk", async () => {
    write("run.sh", "echo\n");
    commitAll();
    chmodSync(join(dir, "run.sh"), 0o755);
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.patch).toContain("new mode 100755");
    expect((await git.checkApplies(hunks[0]!, "stage")).ok).toBe(true);
  });

  it("has stable ids across two reads", async () => {
    write("a.txt", base);
    commitAll();
    write("a.txt", twoEdits);
    write("u.txt", "untracked\n");
    const first = await git.collect();
    const second = await git.collect();
    expect(first.hunks.map((h) => h.id)).toEqual(second.hunks.map((h) => h.id));
    expect(first.hunks).toEqual(second.hunks);
    expect(new Set(first.hunks.map((h) => h.id)).size).toBe(first.hunks.length);
  });

  it("excludes staged changes", async () => {
    write("a.txt", base);
    write("b.txt", "b\n");
    commitAll();
    write("a.txt", twoEdits);
    write("b.txt", "b2\n");
    sh("add", "a.txt");
    const { hunks } = await git.collect();
    expect(hunks.map((h) => h.file)).toEqual(["b.txt"]);
  });

  it("reports only the unstaged part of a partially staged file", async () => {
    write("a.txt", base);
    commitAll();
    write("a.txt", base.replace("line 2\n", "line 2 changed\n"));
    sh("add", "a.txt");
    write("a.txt", twoEdits);
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.patch).toContain("+line 38 changed");
  });

  it("works on a repo with no commits", async () => {
    write("first.txt", "x\n");
    const input = await git.collect();
    expect(input.hunks.map((h) => [h.file, h.status])).toEqual([["first.txt", "untracked"]]);
    expect(input.recentCommits).toEqual([]);
  });

  it("respects .gitignore for untracked files", async () => {
    write(".gitignore", "ignored.txt\n");
    commitAll();
    write("ignored.txt", "x\n");
    expect((await git.collect()).hunks).toEqual([]);
  });
});

describe("recentCommits", () => {
  it("returns [] when there are no commits", async () => {
    await expect(git.recentCommits()).resolves.toEqual([]);
  });

  it("returns the latest subjects, newest first, up to the limit", async () => {
    for (const n of [1, 2, 3]) {
      write("f.txt", `${n}\n`);
      commitAll(`feat: change ${n}\n\nbody text`);
    }
    await expect(git.recentCommits(2)).resolves.toEqual(["feat: change 3", "feat: change 2"]);
    await expect(git.recentCommits()).resolves.toHaveLength(3);
  });
});

describe("stage / unstage / discard / checkApplies", () => {
  async function twoHunkRepo() {
    write("a.txt", base);
    commitAll();
    write("a.txt", twoEdits);
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(2);
    return hunks as [(typeof hunks)[number], (typeof hunks)[number]];
  }
  const cachedDiff = () => sh("diff", "--cached");

  it("stages exactly one hunk of several", async () => {
    const [first, second] = await twoHunkRepo();
    await git.stage(second);
    const cached = cachedDiff();
    expect(cached).toContain("+line 38 changed");
    expect(cached).not.toContain("line 2 changed");
    expect(read("a.txt")).toBe(twoEdits);
    const remaining = (await git.collect()).hunks;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.patch).toContain("+line 2 changed");
    expect(first.patch).toContain("+line 2 changed");
  });

  it("stages the second hunk after the first (line offsets differ)", async () => {
    const [first, second] = await twoHunkRepo();
    await git.stage(first);
    await git.stage(second);
    expect(cachedDiff()).toContain("+line 2 changed");
    expect(cachedDiff()).toContain("+line 38 changed");
  });

  it("unstages exactly one hunk of several", async () => {
    const [first, second] = await twoHunkRepo();
    sh("add", "a.txt");
    await git.unstage(first);
    const cached = cachedDiff();
    expect(cached).toContain("+line 38 changed");
    expect(cached).not.toContain("line 2 changed");
    expect(read("a.txt")).toBe(twoEdits);
    expect(second.id).toBeTruthy();
  });

  it("discards one hunk only", async () => {
    const [first] = await twoHunkRepo();
    await git.discard(first);
    expect(read("a.txt")).toBe(base.replace("line 38\n", "line 38 changed\n"));
    expect(staged()).toBe("");
  });

  it("discards an untracked file's patch by removing the file", async () => {
    write("k.txt", "k\n");
    commitAll();
    write("u.txt", "u\n");
    const { hunks } = await git.collect();
    await git.discard(hunks[0]!);
    expect(existsSync(join(dir, "u.txt"))).toBe(false);
  });

  it("checkApplies is ok for all three actions on a fresh hunk where valid", async () => {
    const [first] = await twoHunkRepo();
    expect((await git.checkApplies(first, "stage")).ok).toBe(true);
    expect((await git.checkApplies(first, "discard")).ok).toBe(true);
    expect((await git.checkApplies(first, "unstage")).ok).toBe(false);
    sh("add", "a.txt");
    expect((await git.checkApplies(first, "unstage")).ok).toBe(true);
    expect((await git.checkApplies(first, "stage")).ok).toBe(false);
  });

  it("checkApplies fails after the file changes underneath, and does not change anything", async () => {
    const [first] = await twoHunkRepo();
    write("a.txt", twoEdits.replace("line 2 changed\n", "line 2 edited elsewhere\n"));
    const discard = await git.checkApplies(first, "discard");
    expect(discard.ok).toBe(false);
    if (!discard.ok) expect(discard.reason.length).toBeGreaterThan(0);
    expect(read("a.txt")).toContain("line 2 edited elsewhere");
    expect(staged()).toBe("");
  });

  it("stage throws GitCommandError when the patch does not apply", async () => {
    const [first] = await twoHunkRepo();
    sh("add", "a.txt");
    await expect(git.stage(first)).rejects.toBeInstanceOf(GitCommandError);
  });
});

describe("commit", () => {
  it("creates one commit from what is staged only", async () => {
    write("a.txt", base);
    commitAll();
    write("a.txt", twoEdits);
    write("b.txt", "b\n");
    const { hunks } = await git.collect();
    await git.stage(hunks[0]!);
    await git.commit("feat(a): change line 2\n\nwith a body");
    expect(sh("log", "-1", "--format=%s")).toBe("feat(a): change line 2\n");
    expect(sh("rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(sh("show", "HEAD", "--stat", "--format=")).toContain("a.txt");
    expect(sh("show", "HEAD", "--stat", "--format=")).not.toContain("b.txt");
    expect(read("a.txt")).toBe(twoEdits);
  });

  it("throws GitCommandError when nothing is staged", async () => {
    write("a.txt", base);
    commitAll();
    await expect(git.commit("chore: nothing")).rejects.toBeInstanceOf(GitCommandError);
  });
});

describe("ScratchIndex", () => {
  const indexBytes = () => readFileSync(join(dir, ".git", "index"));

  it("applies hunks in order and leaves the real index byte-identical", async () => {
    write("a.txt", base);
    write("b.txt", "b\n");
    commitAll();
    write("a.txt", twoEdits);
    write("b.txt", "b2\n");
    write("c.txt", "new\n");
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(4);
    const before = indexBytes();
    const results = await scratch.apply(hunks);
    expect(results).toEqual(hunks.map((h) => ({ id: h.id, ok: true })));
    expect(indexBytes().equals(before)).toBe(true);
    expect(staged()).toBe("");
  });

  it("reports a failed hunk and keeps trying later ones", async () => {
    write("a.txt", base);
    commitAll();
    write("a.txt", twoEdits);
    const { hunks } = await git.collect();
    const conflicting = {
      ...hunks[0]!,
      id: "conflict0001",
      patch: hunks[0]!.patch.replace("+line 2 changed", "+line 2 different"),
    };
    const before = indexBytes();
    const results = await scratch.apply([hunks[0]!, conflicting, hunks[1]!]);
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      [hunks[0]!.id, true],
      ["conflict0001", false],
      [hunks[1]!.id, true],
    ]);
    const failed = results[1]!;
    if (!failed.ok) expect(failed.reason).toBeTruthy();
    expect(indexBytes().equals(before)).toBe(true);
  });

  it("fails a hunk that depends on an earlier one that is not applied, and passes in plan order", async () => {
    write("k.txt", "k\n");
    commitAll();
    write("n.txt", "one\n");
    const create = (await git.collect()).hunks.find((h) => h.file === "n.txt")!;
    commitAll("add n");
    write("n.txt", "one\ntwo\n");
    const modify = (await git.collect()).hunks[0]!;
    // Index no longer knows n.txt, so `modify` builds on `create`.
    sh("rm", "-q", "--cached", "-f", "n.txt");

    const before = indexBytes();
    const bad = await scratch.apply([modify, create]);
    expect(bad.map((r) => r.ok)).toEqual([false, true]);
    const good = await scratch.apply([create, modify]);
    expect(good.map((r) => r.ok)).toEqual([true, true]);
    expect(indexBytes().equals(before)).toBe(true);
  });

  it("works when there is no index file yet", async () => {
    write("n.txt", "one\n");
    const { hunks } = await git.collect();
    expect(existsSync(join(dir, ".git", "index"))).toBe(false);
    const results = await scratch.apply(hunks);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(existsSync(join(dir, ".git", "index"))).toBe(false);
  });

  it("removes its temp files", async () => {
    write("n.txt", "one\n");
    const { hunks } = await git.collect();
    const { readdirSync } = await import("node:fs");
    const count = () => readdirSync(tmpdir()).filter((n) => n.startsWith("diff-boss-index-")).length;
    const before = count();
    await scratch.apply(hunks);
    expect(count()).toBe(before);
  });
});

describe("outside a repository", () => {
  it("throws GitCommandError", async () => {
    const bare = mkdtempSync(join(tmpdir(), "diff-boss-norepo-"));
    try {
      const prev = process.env.GIT_CEILING_DIRECTORIES;
      process.env.GIT_CEILING_DIRECTORIES = tmpdir();
      try {
        await expect(new GitCliPort(bare).collect()).rejects.toBeInstanceOf(GitCommandError);
      } finally {
        if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
        else process.env.GIT_CEILING_DIRECTORIES = prev;
      }
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("untracked nested repositories", () => {
  it("collects the other hunks and never reports a directory", async () => {
    write("a.txt", base);
    commitAll();
    write("a.txt", twoEdits);
    write("new.txt", "new\n");
    mkdirSync(join(dir, "nested"));
    execFileSync("git", ["init", "-q"], { cwd: join(dir, "nested") });
    writeFileSync(join(dir, "nested", "inner.txt"), "inner\n");
    const { hunks } = await git.collect();
    expect(hunks.length).toBeGreaterThanOrEqual(3);
    expect(hunks.some((h) => h.file === "new.txt")).toBe(true);
    expect(hunks.some((h) => h.file === "a.txt")).toBe(true);
    for (const h of hunks) expect(h.file.endsWith("/")).toBe(false);
  });
});

describe("quoted paths", () => {
  it("unquotes C-style escapes", () => {
    expect(unquotePath('"we\\"ird"')).toBe('we"ird');
    expect(unquotePath('"a\\\\b\\tc\\nd"')).toBe("a\\b\tc\nd");
    expect(unquotePath('"caf\\303\\251"')).toBe("caf\u00e9");
    expect(unquotePath("plain")).toBe("plain");
  });

  it("reads the path from a quoted diff --git line with no ---/+++ lines", () => {
    const hunks = parseDiff('diff --git "a/we\\"ird" "b/we\\"ird"\nnew file mode 100644\nindex 0000000..e69de29\n');
    expect(hunks[0]!.file).toBe('we"ird');
  });

  it("collects, stages and unstages a file named with a double quote", async () => {
    write('we"ird', "one\ntwo\nthree\n");
    commitAll();
    write('we"ird', "one\nTWO\nthree\n");
    const { hunks } = await git.collect();
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.file).toBe('we"ird');
    await git.stage(hunks[0]!);
    expect(sh("diff", "--cached", "--name-only", "-z")).toBe('we"ird\0');
    await git.unstage(hunks[0]!);
    expect(staged()).toBe("");
  });

  it("collects an untracked file named with a double quote", async () => {
    write("k.txt", "k\n");
    commitAll();
    write('we"ird', "x\n");
    const { hunks } = await git.collect();
    expect(hunks.map((h) => h.file)).toEqual(['we"ird']);
    await git.stage(hunks[0]!);
    expect(sh("diff", "--cached", "--name-only", "-z")).toBe('we"ird\0');
  });

  it("renames of quoted paths report the new name", async () => {
    write('we"ird', "one\ntwo\nthree\nfour\nfive\n");
    commitAll();
    sh("mv", 'we"ird', 'we"ird2');
    sh("add", "-A");
    const text = sh("-c", "core.quotepath=false", "diff", "--cached", "-M", "--src-prefix=a/", "--dst-prefix=b/");
    expect(parseDiff(text)[0]!.file).toBe('we"ird2');
  });
});
