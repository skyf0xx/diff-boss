import { formatHeader } from "../contract/plan";
import type { Plan } from "../contract/plan";
import type { Hunk } from "../contract/hunk";
import type { ReviewHunk, ReviewState } from "../contract/messages";

export class ReviewStateError extends Error {
  override readonly name = "ReviewStateError";
}

/**
 * Builds the initial review state from an accepted plan. Hunk numbers are
 * final positions counted from 1 across all stages; `needs` ids become numbers.
 */
export function buildReviewState(plan: Plan, hunks: readonly Hunk[]): ReviewState {
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const numbers = new Map<string, number>();
  let n = 0;
  for (const stage of plan.stages) {
    for (const ph of stage.hunks) {
      if (!numbers.has(ph.id)) numbers.set(ph.id, ++n);
    }
  }

  let counter = 0;
  const stages = plan.stages.map((stage) => {
    const header = formatHeader(stage);
    const reviewHunks: ReviewHunk[] = stage.hunks.map((ph) => {
      const hunk = byId.get(ph.id);
      if (!hunk) throw new ReviewStateError(`hunk ${ph.id} is not in the input hunks`);
      const needs = ph.needs.map((id) => {
        const num = numbers.get(id);
        if (num === undefined) throw new ReviewStateError(`hunk ${ph.id} needs ${id}, which is not in the plan`);
        return num;
      });
      return {
        id: ph.id,
        number: ++counter,
        file: hunk.file,
        status: hunk.status,
        patch: hunk.patch,
        summary: ph.summary,
        needs,
        staged: false,
      };
    });
    return { header, hunks: reviewHunks, commitMessage: header, committed: false };
  });
  return { stages, currentStage: 0 };
}

/** Numbers of the hunks that list `hunkId` in `needs`, ascending. Unknown id gives an empty list. */
export function dependentsOf(state: ReviewState, hunkId: string): number[] {
  const all = state.stages.flatMap((s) => s.hunks);
  const target = all.find((h) => h.id === hunkId);
  if (!target) return [];
  return all.filter((h) => h.needs.includes(target.number)).map((h) => h.number);
}
