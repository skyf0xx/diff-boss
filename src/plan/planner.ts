import type { Plan } from "../contract/plan";
import type { PlanningInput } from "../contract/hunk";
import type { Problem, ReadabilityWarning } from "../contract/problem";
import type { Provider, ScratchIndex, Skill } from "../contract/ports";
import { validatePlan } from "./validate";

export interface RunPlannerOptions {
  provider: Provider;
  skill: Skill;
  input: PlanningInput;
  scratchIndex: ScratchIndex;
  maxAttempts: number;
  onProgress?: (attempt: number, maxAttempts: number) => void;
}

export type PlannerResult =
  | { ok: true; plan: Plan; attempts: number; warnings: ReadabilityWarning[] }
  | { ok: false; problems: Problem[]; attempts: number };

/**
 * A ProviderError (or any other thrown error) from the provider propagates
 * unchanged; only validator problems are fed back to the next attempt.
 */
export async function runPlanner(options: RunPlannerOptions): Promise<PlannerResult> {
  const { provider, skill, input, scratchIndex, maxAttempts, onProgress } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer of at least 1, got ${maxAttempts}`);
  }
  let problems: Problem[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(attempt, maxAttempts);
    const raw =
      attempt === 1
        ? await provider.generatePlan(input, skill)
        : await provider.generatePlan(input, skill, problems);
    const result = await validatePlan(raw, input, scratchIndex);
    if (result.plan) return { ok: true, plan: result.plan, attempts: attempt, warnings: result.warnings };
    problems = result.problems;
  }
  return { ok: false, problems, attempts: maxAttempts };
}
