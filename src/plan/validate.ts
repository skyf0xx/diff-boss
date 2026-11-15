import { HEADER_LIMIT, PlanSchema, STAGE_TYPES, formatHeader } from "../contract/plan";
import type { Plan } from "../contract/plan";
import type { Hunk, PlanningInput } from "../contract/hunk";
import type { Problem, ReadabilityWarning } from "../contract/problem";
import type { ScratchIndex } from "../contract/ports";
import { countWords, fleschKincaidGrade } from "./readability";

export const MIN_STAGES = 1;
export const MAX_STAGES = 12;
export const MAX_SUMMARY_WORDS = 20;
export const MAX_GRADE = 8;

export interface ValidationResult {
  plan?: Plan;
  problems: Problem[];
  /** Summaries above the reading-grade limit. They never reject a plan. */
  warnings: ReadabilityWarning[];
}

const SCOPE_RE = /^[a-z0-9-]+$/;

/**
 * Checks run in plan.md order: json, hunks, stage count, stages[i], summaries,
 * needs, order. The order check applies hunks to the scratch index, so it runs
 * only when every earlier check passed.
 */
export async function validatePlan(
  rawText: string,
  input: PlanningInput,
  scratchIndex: ScratchIndex,
): Promise<ValidationResult> {
  const parsed = parseJson(rawText);
  if ("problem" in parsed) return { problems: [parsed.problem], warnings: [] };
  const plan = parsed.plan;

  const summaries = checkSummaries(plan);
  const warnings = summaries.warnings;
  const problems: Problem[] = [
    ...checkHunkCoverage(plan, input),
    ...checkStageCount(plan),
    ...checkStages(plan),
    ...summaries.problems,
    ...checkNeeds(plan),
  ];
  if (problems.length > 0) return { problems, warnings };

  const orderProblems = await checkOrder(plan, input, scratchIndex);
  if (orderProblems.length > 0) return { problems: orderProblems, warnings };
  return { plan, problems: [], warnings };
}

function parseJson(rawText: string): { plan: Plan } | { problem: Problem } {
  const fail = (message: string) => ({ problem: { field: "json", message } });
  let value: unknown;
  try {
    value = JSON.parse(rawText.trim());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail(`output is not valid JSON (${detail}), return one JSON object and nothing else`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("output is not a JSON object, return one JSON object and nothing else");
  }
  const result = PlanSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return fail(`the plan doesn't match the format at ${where} (${issue?.message ?? "invalid"}), follow the plan format`);
  }
  return { plan: result.data };
}

function checkHunkCoverage(plan: Plan, input: PlanningInput): Problem[] {
  const known = new Set(input.hunks.map((h) => h.id));
  const counts = new Map<string, number>();
  for (const stage of plan.stages) {
    for (const h of stage.hunks) counts.set(h.id, (counts.get(h.id) ?? 0) + 1);
  }
  const problems: Problem[] = [];
  for (const h of input.hunks) {
    if (!counts.has(h.id)) {
      problems.push({ field: "hunks", message: `${h.id} isn't in any stage, add it to the stage it belongs to` });
    }
  }
  for (const [id, count] of counts) {
    if (!known.has(id)) {
      problems.push({ field: "hunks", message: `${id} isn't a hunk in the input, remove it` });
    } else if (count > 1) {
      problems.push({
        field: "hunks",
        message: `${id} appears more than once (${count} times), keep it in one stage and remove the other entries`,
      });
    }
  }
  return problems;
}

function checkStageCount(plan: Plan): Problem[] {
  const n = plan.stages.length;
  if (n >= MIN_STAGES && n <= MAX_STAGES) return [];
  return [{ field: "stages", message: `${n} stages, use ${MIN_STAGES} to ${MAX_STAGES}` }];
}

function checkStages(plan: Plan): Problem[] {
  const problems: Problem[] = [];
  plan.stages.forEach((stage, i) => {
    const field = (name: string) => `stages[${i}].${name}`;
    if (!(STAGE_TYPES as readonly string[]).includes(stage.type)) {
      problems.push({
        field: field("type"),
        message: `${JSON.stringify(stage.type)} isn't a type, use one of ${STAGE_TYPES.join(", ")}`,
      });
    }
    if (stage.scope !== undefined && !SCOPE_RE.test(stage.scope)) {
      problems.push({
        field: field("scope"),
        message: `${JSON.stringify(stage.scope)} isn't valid, use lowercase letters, digits and hyphens, or omit the scope`,
      });
    }
    const d = stage.description;
    if (d.trim().length === 0) {
      problems.push({ field: field("description"), message: "it is empty, write a lowercase, imperative description with no final period" });
    } else if (d !== d.toLowerCase()) {
      problems.push({ field: field("description"), message: `${JSON.stringify(d)} isn't lowercase, use lowercase, imperative, no final period` });
    } else if (d.trimEnd().endsWith(".")) {
      problems.push({ field: field("description"), message: `${JSON.stringify(d)} ends with a period, use lowercase, imperative, no final period` });
    }
    const header = formatHeader(stage);
    if (header.length > HEADER_LIMIT) {
      problems.push({
        field: field("header"),
        message: `${header.length} characters, the limit is ${HEADER_LIMIT}, shorten the description`,
      });
    }
    if (stage.hunks.length === 0) {
      problems.push({ field: field("hunks"), message: "the stage has no hunks, give it at least one hunk or remove the stage" });
    }
  });
  return problems;
}

function checkSummaries(plan: Plan): { problems: Problem[]; warnings: ReadabilityWarning[] } {
  const problems: Problem[] = [];
  const warnings: ReadabilityWarning[] = [];
  for (const stage of plan.stages) {
    for (const h of stage.hunks) {
      const field = `hunks[${h.id}].summary`;
      const text = h.summary.trim();
      const words = countWords(text);
      if (words > MAX_SUMMARY_WORDS) {
        problems.push({ field, message: `${words} words, the limit is ${MAX_SUMMARY_WORDS}, cut it to one shorter sentence` });
      }
      if (!isOneSentence(text)) {
        problems.push({ field, message: "it must be one sentence ending with a period, write one sentence and end it with a period" });
        continue;
      }
      const grade = fleschKincaidGrade(text);
      if (grade === undefined) continue;
      const shown = Math.round(grade * 10) / 10;
      if (shown > MAX_GRADE) warnings.push({ hunkId: h.id, grade: shown });
    }
  }
  return { problems, warnings };
}

function isOneSentence(text: string): boolean {
  if (!/[A-Za-z0-9]/.test(text)) return false;
  if (!text.endsWith(".")) return false;
  const body = text.slice(0, -1);
  return !/[.!?](\s|$)/.test(body);
}

function checkNeeds(plan: Plan): Problem[] {
  const position = new Map<string, number>();
  let n = 0;
  for (const stage of plan.stages) {
    for (const h of stage.hunks) if (!position.has(h.id)) position.set(h.id, n++);
  }
  const problems: Problem[] = [];
  for (const stage of plan.stages) {
    for (const h of stage.hunks) {
      const field = `hunks[${h.id}].needs`;
      const mine = position.get(h.id) ?? 0;
      for (const other of h.needs) {
        const theirs = position.get(other);
        if (theirs === undefined) {
          problems.push({ field, message: `${other} isn't a hunk in the plan, remove it` });
        } else if (other === h.id) {
          problems.push({ field, message: `${other} is the hunk itself, remove the dependency` });
        } else if (theirs > mine) {
          problems.push({
            field,
            message: `${other} comes later, move the hunk after the one it needs or remove the dependency`,
          });
        }
      }
    }
  }
  return problems;
}

async function checkOrder(plan: Plan, input: PlanningInput, scratchIndex: ScratchIndex): Promise<Problem[]> {
  const byId = new Map(input.hunks.map((h) => [h.id, h]));
  const ordered: Hunk[] = plan.stages.flatMap((s) => s.hunks.map((h) => byId.get(h.id) as Hunk));
  const results = await scratchIndex.apply(ordered);
  const problems: Problem[] = [];
  ordered.forEach((hunk, i) => {
    const r = results[i];
    if (r && r.ok) return;
    const reason = r && !r.ok ? r.reason.trim().split("\n")[0] : "no result was returned";
    problems.push({
      field: "order",
      message: `${hunk.id} doesn't apply after the hunks before it (${reason}), move it after the hunk that changes the same lines or fix its needs`,
    });
  });
  return problems;
}
