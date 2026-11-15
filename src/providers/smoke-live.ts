/**
 * Manual check, not part of any verify: runs the real Claude provider through
 * the local Claude Code login on a hand-built input and prints the raw plan.
 * Usage: node dist/smoke-live.mjs [skill-dir]   (skill-dir defaults to ./skill)
 */
import { join, resolve } from "node:path";
import type { PlanningInput } from "../contract/hunk";
import type { HunkApplyResult, ScratchIndex } from "../contract/ports";
import { formatProblems } from "../contract/problem";
import { validatePlan } from "../plan/validate";
import { ClaudeAgentProvider } from "./claude";
import { loadSkill } from "./skill";

export const FIXTURE_INPUT: PlanningInput = {
  recentCommits: ["feat(balance): return balance for an address", "test(balance): cover empty address"],
  hunks: [
    {
      id: "3f9a1c7e2b",
      file: "src/balance/token.ts",
      status: "added",
      header: "@@ -0,0 +1,5 @@",
      patch: [
        "@@ -0,0 +1,5 @@",
        "+const TOKEN_ID = /^[a-z0-9]{8}$/;",
        "+",
        "+export function isValidTokenId(id: string): boolean {",
        "+  return TOKEN_ID.test(id);",
        "+}",
      ].join("\n"),
    },
    {
      id: "8d04b6a15c",
      file: "src/balance/token.test.ts",
      status: "added",
      header: "@@ -0,0 +1,6 @@",
      patch: [
        "@@ -0,0 +1,6 @@",
        '+import { isValidTokenId } from "./token";',
        "+",
        '+test("rejects a short id", () => {',
        '+  expect(isValidTokenId("abc")).toBe(false);',
        "+});",
        "+",
      ].join("\n"),
    },
    {
      id: "c27e90f4a3",
      file: "src/format.ts",
      status: "modified",
      header: "@@ -3,3 +3,3 @@ export function formatAmount",
      patch: [
        "@@ -3,3 +3,3 @@ export function formatAmount",
        " export function formatAmount(n: number): string {",
        "-  return  n.toFixed(2);",
        "+  return n.toFixed(2);",
        " }",
      ].join("\n"),
    },
  ],
};

// The smoke run has no repository, so every hunk is treated as applying.
const acceptAll: ScratchIndex = {
  async apply(hunks): Promise<HunkApplyResult[]> {
    return hunks.map((h) => ({ id: h.id, ok: true as const }));
  },
};

async function main(): Promise<void> {
  const skillDir = resolve(process.argv[2] ?? join(process.cwd(), "skill"));
  const skill = await loadSkill(skillDir);
  const provider = new ClaudeAgentProvider({ model: process.env.DIFF_BOSS_MODEL });
  console.log(`provider=${provider.id} model=${provider.model} skill=${skillDir}`);
  const raw = await provider.generatePlan(FIXTURE_INPUT, skill);
  console.log("--- raw plan ---");
  console.log(raw);
  const { problems } = await validatePlan(raw, FIXTURE_INPUT, acceptAll);
  console.log("--- validation (order check skipped) ---");
  console.log(problems.length === 0 ? "no problems" : formatProblems(problems).join("\n"));
  if (problems.length > 0) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] !== undefined && /smoke-live\.(mjs|ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  });
}
