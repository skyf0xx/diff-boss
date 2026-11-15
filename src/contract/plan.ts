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

// Shape only: type, scope and description stay plain strings so the plan
// layer can report the specific `✗ stages[i].…` message for each.
export const PlanHunkSchema = z.object({
  id: z.string(),
  summary: z.string(),
  needs: z.array(z.string()),
});
export type PlanHunk = z.infer<typeof PlanHunkSchema>;

export const StageSchema = z.object({
  type: z.string(),
  scope: z.string().optional(),
  description: z.string(),
  hunks: z.array(PlanHunkSchema),
});
export type Stage = z.infer<typeof StageSchema>;

export const PlanSchema = z.object({
  stages: z.array(StageSchema),
});
export type Plan = z.infer<typeof PlanSchema>;

export interface HeaderParts {
  type: string;
  scope?: string | undefined;
  description: string;
  breaking?: boolean;
}

export function formatHeader(parts: HeaderParts): string {
  const scope = parts.scope ? `(${parts.scope})` : "";
  const bang = parts.breaking ? "!" : "";
  return `${parts.type}${scope}${bang}: ${parts.description}`;
}
