import { z } from "zod";

export const STAGE_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "test",
  "docs",
  "style",
  "build",
  "ci",
  "chore",
] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const HEADER_LIMIT = 72;

/**
 * What a planner writes. `files` maps `path` (every hunk of that file not claimed
 * elsewhere) or `path#n` (the file's n-th hunk, from 1) to a summary, which may be empty.
 */
export const PlanSchema = z.object({
  stages: z.array(
    z.object({
      header: z.string(),
      files: z.record(z.string(), z.string()),
    }),
  ),
});
export type Plan = z.infer<typeof PlanSchema>;

/** A plan resolved to hunk ids, in review order. */
export interface ResolvedStage {
  header: string;
  hunks: { id: string; summary: string }[];
}

export const UNPLANNED_HEADER = "chore: unplanned changes";
