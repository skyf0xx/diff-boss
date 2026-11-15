import { describe, expect, it } from "vitest";
import {
  HostToWebviewSchema,
  HunkSchema,
  PlanSchema,
  PlanningInputSchema,
  STAGE_TYPES,
  WebviewToHostSchema,
  describeDependents,
  formatHeader,
  formatProblem,
} from "./index";

const plan = {
  stages: [
    {
      type: "feat",
      scope: "balance",
      description: "validate token ids",
      hunks: [
        { id: "a1", summary: "Token IDs can now be checked.", needs: [] },
        { id: "b2", summary: "A bad ID now fails.", needs: ["a1"] },
      ],
    },
  ],
};

describe("hunk input schemas", () => {
  const hunk = { id: "a1", file: "x.ts", status: "modified", header: "@@ -1 +1 @@", patch: "-a\n+b" };

  it("accepts every status", () => {
    for (const status of ["modified", "added", "deleted", "renamed", "untracked"]) {
      expect(HunkSchema.safeParse({ ...hunk, status }).success).toBe(true);
    }
  });

  it("rejects an unknown status and a missing id", () => {
    expect(HunkSchema.safeParse({ ...hunk, status: "staged" }).success).toBe(false);
    const { id: _id, ...noId } = hunk;
    expect(HunkSchema.safeParse(noId).success).toBe(false);
  });

  it("allows optional context and requires recentCommits", () => {
    expect(PlanningInputSchema.safeParse({ hunks: [hunk], recentCommits: [] }).success).toBe(true);
    expect(
      PlanningInputSchema.safeParse({ hunks: [hunk], context: { a1: "code" }, recentCommits: ["x"] }).success,
    ).toBe(true);
    expect(PlanningInputSchema.safeParse({ hunks: [hunk] }).success).toBe(false);
  });
});

describe("plan schema", () => {
  it("parses a valid plan", () => {
    expect(PlanSchema.parse(plan)).toEqual(plan);
  });

  it("allows an omitted scope", () => {
    const { scope: _s, ...noScope } = plan.stages[0]!;
    expect(PlanSchema.safeParse({ stages: [noScope] }).success).toBe(true);
  });

  it("rejects wrong shapes", () => {
    expect(PlanSchema.safeParse({}).success).toBe(false);
    expect(PlanSchema.safeParse({ stages: "x" }).success).toBe(false);
    const bad = structuredClone(plan);
    delete (bad.stages[0]!.hunks[0] as { needs?: string[] }).needs;
    expect(PlanSchema.safeParse(bad).success).toBe(false);
  });

  it("leaves content rules to the plan layer", () => {
    const odd = { stages: [{ type: "wat", scope: "BAD", description: "Ends.", hunks: [] }] };
    expect(PlanSchema.safeParse(odd).success).toBe(true);
  });

  it("lists the ten commit types", () => {
    expect(STAGE_TYPES).toHaveLength(10);
    expect(STAGE_TYPES).toContain("chore");
  });
});

describe("formatters", () => {
  it("formats a header with and without scope", () => {
    expect(formatHeader({ type: "feat", scope: "balance", description: "validate token ids" })).toBe(
      "feat(balance): validate token ids",
    );
    expect(formatHeader({ type: "fix", description: "stop the crash" })).toBe("fix: stop the crash");
  });

  it("formats the breaking marker after the scope or type", () => {
    expect(formatHeader({ type: "feat", scope: "api", description: "drop v1", breaking: true })).toBe(
      "feat(api)!: drop v1",
    );
    expect(formatHeader({ type: "feat", description: "drop v1", breaking: true })).toBe("feat!: drop v1");
  });

  it("formats a problem line", () => {
    expect(formatProblem({ field: "hunks[abc].summary", message: "22 words, the limit is 20" })).toBe(
      "✗ hunks[abc].summary: 22 words, the limit is 20",
    );
    expect(formatProblem({ field: "order", message: "x doesn't apply" })).toBe("✗ order: x doesn't apply");
  });
});

describe("messages", () => {
  const review = {
    type: "review",
    state: {
      currentStage: 0,
      stages: [
        {
          header: "feat: x",
          commitMessage: "feat: x",
          committed: false,
          hunks: [
            { id: "a", number: 1, file: "f", status: "added", patch: "+", summary: "S.", needs: [], staged: false },
            { id: "b", number: 2, file: "f", status: "added", patch: "+", summary: "S.", needs: [1], staged: true },
          ],
        },
      ],
    },
  };

  it("parses every host message", () => {
    for (const m of [
      { type: "loading" },
      { type: "generating", attempt: 1, maxAttempts: 3 },
      { type: "failed", problems: [{ field: "json", message: "no" }] },
      review,
      { type: "stale" },
      { type: "confirmDiscard", hunkId: "a", dependents: [4, 6] },
    ]) {
      expect(HostToWebviewSchema.safeParse(m).success).toBe(true);
    }
  });

  it("rejects unknown host messages and bad numbers", () => {
    expect(HostToWebviewSchema.safeParse({ type: "nope" }).success).toBe(false);
    expect(HostToWebviewSchema.safeParse({ type: "confirmDiscard", hunkId: "a" }).success).toBe(false);
  });

  it("parses every webview message", () => {
    for (const m of [
      { type: "ready" },
      { type: "stageHunk", hunkId: "a" },
      { type: "unstageHunk", hunkId: "a" },
      { type: "requestDiscard", hunkId: "a" },
      { type: "confirmDiscard", hunkId: "a" },
      { type: "openFile", hunkId: "a" },
      { type: "commit", stageIndex: 0, message: "feat: x" },
      { type: "skip", stageIndex: 0 },
      { type: "rerun" },
    ]) {
      expect(WebviewToHostSchema.safeParse(m).success).toBe(true);
    }
    expect(WebviewToHostSchema.safeParse({ type: "commit", stageIndex: 0 }).success).toBe(false);
  });

  it("words discard dependents", () => {
    expect(describeDependents([])).toBeUndefined();
    expect(describeDependents([4])).toBe("Hunk 4 needs this hunk.");
    expect(describeDependents([4, 6])).toBe("Hunks 4 and 6 need this hunk.");
    expect(describeDependents([2, 4, 6])).toBe("Hunks 2, 4 and 6 need this hunk.");
  });
});
