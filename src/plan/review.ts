import type { ResolvedStage } from "../contract/plan";
import type { Hunk } from "../contract/hunk";
import type { ReviewHunk, ReviewState } from "../contract/messages";
import type { ReadabilityWarning } from "../contract/problem";

export class ReviewStateError extends Error {
  override readonly name = "ReviewStateError";
}

/** Builds the initial review state. Hunk numbers count from 1 across all stages. */
export function buildReviewState(
  stages: readonly ResolvedStage[],
  hunks: readonly Hunk[],
  warnings: readonly ReadabilityWarning[] = [],
): ReviewState {
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const grades = new Map(warnings.map((w) => [w.hunkId, w.grade]));
  let counter = 0;
  return {
    currentStage: 0,
    stages: stages.map((stage) => {
      const reviewHunks: ReviewHunk[] = stage.hunks.map((ph) => {
        const hunk = byId.get(ph.id);
        if (!hunk) throw new ReviewStateError(`hunk ${ph.id} is not in the input hunks`);
        return {
          id: ph.id,
          number: ++counter,
          file: hunk.file,
          status: hunk.status,
          patch: hunk.patch,
          summary: ph.summary,
          staged: false,
          ...(grades.has(ph.id) ? { readabilityGrade: grades.get(ph.id) } : {}),
        };
      });
      return { header: stage.header, hunks: reviewHunks, commitMessage: stage.header, committed: false };
    }),
  };
}
