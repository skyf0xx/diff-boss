import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { formatProblems, type Problem } from "../contract/problem";
import { runGitChecked } from "../git";

export const PLAN_FILE = "plan.json";
export const RESULT_FILE = "result.json";

export type HandoffResult = { ok: true; stages: number } | { ok: false; problems: string[] };

/** `<git-dir>/diff-boss`: inside `.git`, so the handoff files never show as working-tree changes. */
export async function handoffDir(repo: string): Promise<string> {
  const { stdout } = await runGitChecked(["rev-parse", "--absolute-git-dir"], { cwd: repo });
  return path.join(stdout.trim(), "diff-boss");
}

/** Writes through a temp file and a rename, so a polling reader never sees a partial file. */
async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

export class FilePlanSource {
  constructor(private readonly dir: string) {}

  async readPlan(): Promise<string> {
    await rm(path.join(this.dir, RESULT_FILE), { force: true });
    const file = path.join(this.dir, PLAN_FILE);
    try {
      return await readFile(file, "utf8");
    } catch {
      throw new Error(`No plan at ${file}; write one, then open the review link again`);
    }
  }

  async report(result: { ok: true; stages: number } | { ok: false; problems: readonly Problem[] }): Promise<void> {
    const out: HandoffResult = result.ok ? result : { ok: false, problems: formatProblems(result.problems) };
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(path.join(this.dir, RESULT_FILE), `${JSON.stringify(out, null, 2)}\n`);
  }
}
