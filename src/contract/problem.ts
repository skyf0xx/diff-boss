import { z } from "zod";

export const ProblemSchema = z.object({
  field: z.string(),
  message: z.string(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export function formatProblem(problem: Problem): string {
  return `✗ ${problem.field}: ${problem.message}`;
}

export function formatProblems(problems: readonly Problem[]): string[] {
  return problems.map(formatProblem);
}
