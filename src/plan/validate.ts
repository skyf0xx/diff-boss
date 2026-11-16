import { HEADER_LIMIT, PlanSchema, STAGE_TYPES, UNPLANNED_HEADER } from "../contract/plan";
import type { Plan, ResolvedStage } from "../contract/plan";
import type { Hunk, PlanningInput } from "../contract/hunk";
import type { Problem, ReadabilityWarning } from "../contract/problem";
import type { ScratchIndex } from "../contract/ports";
import { fleschKincaidGrade } from "./readability";

export const MAX_GRADE = 8;

export interface ValidationResult {
  stages?: ResolvedStage[];
  problems: Problem[];
  /** Summaries above the reading-grade limit. They never reject a plan. */
  warnings: ReadabilityWarning[];
}

const HEADER_RE = new RegExp(`^(${STAGE_TYPES.join("|")})(\\([a-z0-9-]+\\))?: \\S`);

export async function validatePlan(
  rawText: string,
  input: PlanningInput,
  scratchIndex: ScratchIndex,
): Promise<ValidationResult> {
  const parsed = parseJson(rawText);
  if ("problem" in parsed) return { problems: [parsed.problem], warnings: [] };

  const problems = checkHeaders(parsed.plan);
  const resolved = resolve(parsed.plan, input.hunks);
  problems.push(...resolved.problems);
  if (problems.length > 0) return { problems, warnings: [] };

  const orderProblems = await checkOrder(resolved.stages, input.hunks, scratchIndex);
  if (orderProblems.length > 0) return { problems: orderProblems, warnings: [] };
  return { stages: resolved.stages, problems: [], warnings: gradeWarnings(resolved.stages) };
}

function parseJson(rawText: string): { plan: Plan } | { problem: Problem } {
  const fail = (message: string) => ({ problem: { field: "json", message } });
  let value: unknown;
  try {
    value = JSON.parse(rawText.trim());
  } catch (err) {
    return fail(`not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  const result = PlanSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return fail(`expected {"stages":[{"header":"…","files":{"path":"summary"}}]}, wrong at ${where}`);
  }
  return { plan: result.data };
}

function checkHeaders(plan: Plan): Problem[] {
  const problems: Problem[] = [];
  plan.stages.forEach((stage, i) => {
    const field = `stages[${i}].header`;
    if (!HEADER_RE.test(stage.header)) {
      problems.push({ field, message: `${JSON.stringify(stage.header)} isn't type(scope): description, types: ${STAGE_TYPES.join(", ")}` });
    } else if (stage.header.length > HEADER_LIMIT) {
      problems.push({ field, message: `${stage.header.length} characters, the limit is ${HEADER_LIMIT}` });
    }
  });
  return problems;
}

const KEY_RE = /^(.*)#([1-9]\d*)$/;

/**
 * `path#n` keys claim first wherever they sit, so `a.ts` in one stage and `a.ts#2` in
 * another means hunk 2 goes to the second stage and the rest to the first. Hunks no key
 * claims go to a final unplanned stage.
 */
function resolve(plan: Plan, hunks: readonly Hunk[]): { stages: ResolvedStage[]; problems: Problem[] } {
  const byFile = new Map<string, Hunk[]>();
  for (const h of hunks) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);

  const problems: Problem[] = [];
  const claimed = new Set<string>();
  const wholeFiles = new Set<string>();

  plan.stages.forEach((stage, i) => {
    for (const key of Object.keys(stage.files)) {
      const field = `stages[${i}].files`;
      const m = KEY_RE.exec(key);
      const file = m ? m[1]! : key;
      const list = byFile.get(file);
      if (!list) {
        problems.push({ field, message: `${key}: no unstaged changes in that file` });
        continue;
      }
      if (!m) {
        if (wholeFiles.has(file)) problems.push({ field, message: `${key} is listed twice, use ${key}#n to split it` });
        wholeFiles.add(file);
        continue;
      }
      const hunk = list[Number(m[2]) - 1];
      if (!hunk) problems.push({ field, message: `${key}: the file has ${list.length} hunk${list.length === 1 ? "" : "s"}` });
      else if (claimed.has(hunk.id)) problems.push({ field, message: `${key} is listed twice` });
      else claimed.add(hunk.id);
    }
  });
  if (problems.length > 0) return { stages: [], problems };

  const stages: ResolvedStage[] = plan.stages.map((stage) => {
    const out: ResolvedStage["hunks"] = [];
    for (const [key, summary] of Object.entries(stage.files)) {
      const m = KEY_RE.exec(key);
      const list = byFile.get(m ? m[1]! : key)!;
      if (m) {
        out.push({ id: list[Number(m[2]) - 1]!.id, summary });
        continue;
      }
      for (const h of list) {
        if (claimed.has(h.id)) continue;
        claimed.add(h.id);
        out.push({ id: h.id, summary });
      }
    }
    return { header: stage.header, hunks: out };
  });

  const rest = hunks.filter((h) => !claimed.has(h.id)).map((h) => ({ id: h.id, summary: "" }));
  if (rest.length > 0) stages.push({ header: UNPLANNED_HEADER, hunks: rest });
  return { stages: stages.filter((s) => s.hunks.length > 0), problems: [] };
}

function gradeWarnings(stages: readonly ResolvedStage[]): ReadabilityWarning[] {
  const warnings: ReadabilityWarning[] = [];
  for (const stage of stages) {
    for (const h of stage.hunks) {
      const grade = h.summary.trim() ? fleschKincaidGrade(h.summary.trim()) : undefined;
      if (grade === undefined) continue;
      const shown = Math.round(grade * 10) / 10;
      if (shown > MAX_GRADE) warnings.push({ hunkId: h.id, grade: shown });
    }
  }
  return warnings;
}

async function checkOrder(stages: readonly ResolvedStage[], hunks: readonly Hunk[], scratchIndex: ScratchIndex): Promise<Problem[]> {
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const ordered = stages.flatMap((s) => s.hunks.map((h) => byId.get(h.id)!));
  const results = await scratchIndex.apply(ordered);
  const problems: Problem[] = [];
  ordered.forEach((hunk, i) => {
    const r = results[i];
    if (r?.ok) return;
    const reason = r && !r.ok ? r.reason.trim().split("\n")[0] : "no result";
    problems.push({ field: "order", message: `${hunk.file}: a hunk doesn't apply after the ones before it (${reason})` });
  });
  return problems;
}
