import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Hunk } from "../contract/hunk";
import type { HunkApplyResult, ScratchIndex } from "../contract/ports";
import { runGit, runGitChecked } from "./exec";
import { applyArgs, toApplyResult } from "./git-port";

export class GitScratchIndex implements ScratchIndex {
  constructor(private readonly cwd: string) {}

  async apply(hunks: readonly Hunk[]): Promise<HunkApplyResult[]> {
    const top = await runGitChecked(["rev-parse", "--show-toplevel"], { cwd: this.cwd });
    const root = top.stdout.trim();
    const where = await runGitChecked(["rev-parse", "--git-path", "index"], { cwd: root });
    const realIndex = resolve(root, where.stdout.trim());

    const dir = await mkdtemp(join(tmpdir(), "diff-boss-index-"));
    try {
      const scratch = join(dir, "index");
      try {
        await copyFile(realIndex, scratch);
      } catch (error) {
        // No index yet: an absent GIT_INDEX_FILE behaves as an empty index.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }

      const args = applyArgs("stage", false);
      const results: HunkApplyResult[] = [];
      for (const hunk of hunks) {
        const result = await runGit(args, {
          cwd: root,
          env: { GIT_INDEX_FILE: scratch },
          input: hunk.patch,
        });
        results.push({ id: hunk.id, ...toApplyResult(args, result) });
      }
      return results;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

