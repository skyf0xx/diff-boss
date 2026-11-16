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
  z.object({ type: z.literal("failed"), problems: z.array(ProblemSchema) }),
  z.object({ type: z.literal("review"), state: ReviewStateSchema }),
  /** Working tree drifted: actions are refused until a rerun completes. */
  z.object({ type: z.literal("stale") }),
  z.object({ type: z.literal("confirmDiscard"), hunkId: z.string() }),
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
  /** Collects the hunks again and rereads the plan. */
  z.object({ type: z.literal("rerun") }),
]);
export type WebviewToHost = z.infer<typeof WebviewToHostSchema>;

export const STALE_MESSAGE = "Files changed since this plan was made";
