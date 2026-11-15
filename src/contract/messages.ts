import { z } from "zod";
import { HunkStatusSchema } from "./hunk";
import { ProblemSchema } from "./problem";

export const ReviewHunkSchema = z.object({
  id: z.string(),
  /** 1-based position in the whole plan, across stages. */
  number: z.number().int().min(1),
  file: z.string(),
  status: HunkStatusSchema,
  patch: z.string(),
  summary: z.string(),
  /** "Needs hunk n" numbers, from `needs` and the final order. */
  needs: z.array(z.number().int().min(1)),
  staged: z.boolean(),
  /** Set when the summary's reading grade is above the limit; the summary is still shown. */
  readabilityGrade: z.number().optional(),
});
export type ReviewHunk = z.infer<typeof ReviewHunkSchema>;

export const ReviewStageSchema = z.object({
  /** Rendered `type(scope): description`. */
  header: z.string(),
  hunks: z.array(ReviewHunkSchema),
  /** Pre-filled commit message; the developer may edit it. */
  commitMessage: z.string(),
  committed: z.boolean(),
});
export type ReviewStage = z.infer<typeof ReviewStageSchema>;

export const ReviewStateSchema = z.object({
  stages: z.array(ReviewStageSchema),
  currentStage: z.number().int().min(0),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const HostToWebviewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loading") }),
  z.object({
    type: z.literal("generating"),
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
  }),
  z.object({ type: z.literal("failed"), problems: z.array(ProblemSchema) }),
  z.object({ type: z.literal("review"), state: ReviewStateSchema }),
  /** Working tree drifted: actions are refused until a rerun completes. */
  z.object({ type: z.literal("stale") }),
  /**
   * Discard warns, then discards; it is never blocked. `dependents` holds the
   * numbers of later hunks that list this hunk in `needs`; empty means a plain
   * confirmation.
   */
  z.object({
    type: z.literal("confirmDiscard"),
    hunkId: z.string(),
    dependents: z.array(z.number().int().min(1)),
  }),
]);
export type HostToWebview = z.infer<typeof HostToWebviewSchema>;

export const WebviewToHostSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("stageHunk"), hunkId: z.string() }),
  z.object({ type: z.literal("unstageHunk"), hunkId: z.string() }),
  z.object({ type: z.literal("requestDiscard"), hunkId: z.string() }),
  z.object({ type: z.literal("confirmDiscard"), hunkId: z.string() }),
  z.object({ type: z.literal("openFile"), hunkId: z.string() }),
  z.object({
    type: z.literal("commit"),
    stageIndex: z.number().int().min(0),
    message: z.string(),
  }),
  z.object({ type: z.literal("skip"), stageIndex: z.number().int().min(0) }),
  /** Collects the hunks again and replans. */
  z.object({ type: z.literal("rerun") }),
]);
export type WebviewToHost = z.infer<typeof WebviewToHostSchema>;

/** The text the webview shows for a discard confirmation, e.g. "Hunks 4 and 6 need this hunk." */
export function describeDependents(dependents: readonly number[]): string | undefined {
  if (dependents.length === 0) return undefined;
  const nums = dependents.map(String);
  const list =
    nums.length === 1
      ? nums[0]
      : `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
  return dependents.length === 1 ? `Hunk ${list} needs this hunk.` : `Hunks ${list} need this hunk.`;
}

export const STALE_MESSAGE = "Files changed since this plan was made";
