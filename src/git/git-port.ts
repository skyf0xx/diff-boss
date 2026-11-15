import { stat } from "node:fs/promises";
import type { Hunk, PlanningInput } from "../contract/hunk";
import type { ApplyResult, GitPort, HunkAction } from "../contract/ports";
import { commandError, runGit, runGitChecked, type RunResult } from "./exec";
import { parseDiff } from "./parse";

const DEFAULT_RECENT_COMMITS = 10;

const READ = ["--no-optional-locks", "-c", "core.quotepath=false"] as const;
const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--binary",
  "-M",
  "-U3",
  "--src-prefix=a/",
  "--dst-prefix=b/",
] as const;

export function applyArgs(action: HunkAction, check: boolean): string[] {
  const args = ["apply"];
  if (check) args.push("--check");
  if (action === "stage") args.push("--cached");
  else if (action === "unstage") args.push("--cached", "-R");
  else args.push("-R");
  args.push("-");
  return args;
}

/** `git apply` reports a patch that does not apply with exit 1; anything else is unexpected. */
export function toApplyResult(args: readonly string[], result: RunResult): ApplyResult {
  if (result.code === 0) return { ok: true };
  if (result.code === 1) {
    return { ok: false, reason: result.stderr.trim() || "patch does not apply" };
  }
  throw commandError(args, result);
}

export class GitCliPort implements GitPort {
  private rootPromise: Promise<string> | undefined;

  constructor(private readonly cwd: string) {}

  /** Repository top level; every command runs from here. */
  root(): Promise<string> {
    this.rootPromise ??= runGitChecked(["rev-parse", "--show-toplevel"], { cwd: this.cwd }).then((r) =>
      r.stdout.trim(),
    );
    this.rootPromise.catch(() => {
      this.rootPromise = undefined;
    });
    return this.rootPromise;
  }

  async collect(): Promise<PlanningInput> {
    const cwd = await this.root();
    const tracked = await runGitChecked([...READ, ...DIFF_FLAGS], { cwd });
    const hunks = parseDiff(tracked.stdout);

    const listed = await runGitChecked([...READ, "ls-files", "--others", "--exclude-standard", "-z"], { cwd });
    for (const file of listed.stdout.split("\0").filter(Boolean)) {
      // A nested repository is listed as `dir/`; it has no patch of its own.
      if (file.endsWith("/")) continue;
      hunks.push(...(await this.untrackedHunks(cwd, file)));
    }
    return { hunks, recentCommits: await this.recentCommits() };
  }

  private async untrackedHunks(cwd: string, file: string): Promise<Hunk[]> {
    const args = [...READ, ...DIFF_FLAGS, "--no-index", "--", "/dev/null", file];
    const result = await runGitChecked(args, { cwd }, [1]);
    if (result.stdout) return parseDiff(result.stdout, "untracked");

    // git prints nothing for an empty file, but it must still be stageable.
    const info = await stat(`${cwd}/${file}`);
    if (!info.isFile()) return [];
    const mode = info.mode & 0o111 ? "100755" : "100644";
    const header =
      `diff --git a/${file} b/${file}\nnew file mode ${mode}\nindex 0000000..e69de29\n`;
    return parseDiff(header, "untracked");
  }

  async recentCommits(limit: number = DEFAULT_RECENT_COMMITS): Promise<string[]> {
    const cwd = await this.root();
    const head = await runGit([...READ, "rev-parse", "--verify", "--quiet", "HEAD"], { cwd });
    if (head.code !== 0) return [];
    const log = await runGitChecked([...READ, "log", "-n", String(Math.max(0, Math.floor(limit))), "--format=%s"], {
      cwd,
    });
    return log.stdout.split("\n").filter((line) => line !== "");
  }

  async checkApplies(hunk: Hunk, action: HunkAction): Promise<ApplyResult> {
    const args = applyArgs(action, true);
    const result = await runGit(args, { cwd: await this.root(), input: hunk.patch });
    return toApplyResult(args, result);
  }

  stage(hunk: Hunk): Promise<void> {
    return this.apply(hunk, "stage");
  }

  unstage(hunk: Hunk): Promise<void> {
    return this.apply(hunk, "unstage");
  }

  discard(hunk: Hunk): Promise<void> {
    return this.apply(hunk, "discard");
  }

  private async apply(hunk: Hunk, action: HunkAction): Promise<void> {
    await runGitChecked(applyArgs(action, false), { cwd: await this.root(), input: hunk.patch });
  }

  async commit(message: string): Promise<void> {
    await runGitChecked(["commit", "-F", "-"], { cwd: await this.root(), input: message });
  }
}
