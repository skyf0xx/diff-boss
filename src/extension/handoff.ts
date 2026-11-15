import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { PlanningInput } from "../contract/hunk";
import { formatProblems, type Problem } from "../contract/problem";
import { runGitChecked } from "../git";

export const HUNKS_FILE = "hunks.json";
export const PLAN_FILE = "plan.json";
export const RESULT_FILE = "result.json";

export interface HunkIndexEntry {
  id: string;
  file: string;
  status: string;
  /** The `@@` line, so a session can match the id to the change it made. */
  at: string;
  /** The first added or removed line, trimmed and cut to 80 characters. */
  firstChange: string;
}

export interface HunkIndex {
  /** The installed extension's planning skill; the plan must follow it. */
  skill: string;
  planFile: string;
  resultFile: string;
  recentCommits: string[];
  hunks: HunkIndexEntry[];
}

export type HandoffResult = { ok: true; stages: number } | { ok: false; problems: string[] };

/** `<git-dir>/diff-boss`: inside `.git`, so the handoff files never show as working-tree changes. */
export async function handoffDir(repo: string): Promise<string> {
  const { stdout } = await runGitChecked(["rev-parse", "--absolute-git-dir"], { cwd: repo });
  return path.join(stdout.trim(), "diff-boss");
}

export function buildHunkIndex(input: PlanningInput, dir: string, skillDir: string): HunkIndex {
  return {
    skill: path.join(skillDir, "SKILL.md"),
    planFile: path.join(dir, PLAN_FILE),
    resultFile: path.join(dir, RESULT_FILE),
    recentCommits: input.recentCommits,
    hunks: input.hunks.map((h) => {
      const lines = h.patch.split("\n");
      const atIndex = lines.findIndex((l) => l.startsWith("@@"));
      const change = lines.slice(atIndex + 1).find((l) => /^[+-]/.test(l)) ?? "";
      return {
        id: h.id,
        file: h.file,
        status: h.status,
        at: atIndex === -1 ? "" : lines[atIndex]!,
        firstChange: change.trim().slice(0, 80),
      };
    }),
  };
}

/** Writes through a temp file and a rename, so a polling reader never sees a partial file. */
async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

export async function writeHunkIndex(dir: string, index: HunkIndex): Promise<void> {
  await mkdir(dir, { recursive: true });
  await rm(path.join(dir, PLAN_FILE), { force: true });
  await rm(path.join(dir, RESULT_FILE), { force: true });
  await writeAtomic(path.join(dir, HUNKS_FILE), `${JSON.stringify(index, null, 2)}\n`);
}

export class FilePlanSource {
  constructor(private readonly dir: string) {}

  async readPlan(): Promise<string> {
    await rm(path.join(this.dir, RESULT_FILE), { force: true });
    const file = path.join(this.dir, PLAN_FILE);
    try {
      return await readFile(file, "utf8");
    } catch {
      throw new Error(`No plan at ${file}; write one, then open the review-plan link again`);
    }
  }

  async report(result: { ok: true; stages: number } | { ok: false; problems: readonly Problem[] }): Promise<void> {
    const out: HandoffResult = result.ok ? result : { ok: false, problems: formatProblems(result.problems) };
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(path.join(this.dir, RESULT_FILE), `${JSON.stringify(out, null, 2)}\n`);
  }
}
