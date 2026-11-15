import { z } from "zod";

export const HUNK_STATUSES = ["modified", "added", "deleted", "renamed", "untracked"] as const;

export const HunkStatusSchema = z.enum(HUNK_STATUSES);
export type HunkStatus = z.infer<typeof HunkStatusSchema>;

export const HunkSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  status: HunkStatusSchema,
  header: z.string(),
  patch: z.string(),
});
export type Hunk = z.infer<typeof HunkSchema>;

export const PlanningInputSchema = z.object({
  hunks: z.array(HunkSchema),
  context: z.record(z.string(), z.string()).optional(),
  recentCommits: z.array(z.string()),
});
export type PlanningInput = z.infer<typeof PlanningInputSchema>;
