import { describe, expect, it } from "vitest";
import {
  HostToWebviewSchema,
  HunkSchema,
  PlanSchema,
  PlanningInputSchema,
  ReadabilityWarningSchema,
  ReviewStateSchema,
  STAGE_TYPES,
  WebviewToHostSchema,
  formatProblem,
} from "./index";

const plan = {
  stages: [{ header: "feat(balance): validate token ids", files: { "a.ts": "Token IDs can now be checked.", "b.ts#2": "" } }],
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

  it("rejects wrong shapes", () => {
    expect(PlanSchema.safeParse({}).success).toBe(false);
    expect(PlanSchema.safeParse({ stages: "x" }).success).toBe(false);
    expect(PlanSchema.safeParse({ stages: [{ header: "feat: x", files: { "a.ts": 1 } }] }).success).toBe(false);
  });

  it("leaves content rules to the plan layer", () => {
    expect(PlanSchema.safeParse({ stages: [{ header: "wat", files: {} }] }).success).toBe(true);
  });

  it("lists the ten commit types", () => {
    expect(STAGE_TYPES).toHaveLength(10);
    expect(STAGE_TYPES).toContain("chore");
  });
});

describe("formatters", () => {
  it("formats a problem line", () => {
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
            { id: "a", number: 1, file: "f", status: "added", patch: "+", summary: "S.", staged: false },
            { id: "b", number: 2, file: "f", status: "added", patch: "+", summary: "S.", staged: true },
          ],
        },
      ],
    },
  };

  it("parses every host message", () => {
    for (const m of [
      { type: "loading" },
      { type: "failed", problems: [{ field: "json", message: "no" }] },
      review,
      { type: "stale" },
      { type: "confirmDiscard", hunkId: "a" },
    ]) {
      expect(HostToWebviewSchema.safeParse(m).success).toBe(true);
    }
  });

  it("rejects unknown host messages and bad numbers", () => {
    expect(HostToWebviewSchema.safeParse({ type: "nope" }).success).toBe(false);
    expect(HostToWebviewSchema.safeParse({ type: "confirmDiscard" }).success).toBe(false);
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

});

describe("readability warnings", () => {
  it("parses a warning and an optional grade on a review hunk", () => {
    expect(ReadabilityWarningSchema.parse({ hunkId: "a1", grade: 8.9 })).toEqual({ hunkId: "a1", grade: 8.9 });
    expect(ReadabilityWarningSchema.safeParse({ hunkId: "a1" }).success).toBe(false);
    const hunk = { id: "a1", number: 1, file: "a.ts", status: "modified", patch: "p", summary: "S.", staged: false };
    const state = (h: object) => ({ currentStage: 0, stages: [{ header: "h", commitMessage: "h", committed: false, hunks: [h] }] });
    expect(ReviewStateSchema.safeParse(state(hunk)).success).toBe(true);
    expect(ReviewStateSchema.parse(state({ ...hunk, readabilityGrade: 8.9 })).stages[0]!.hunks[0]!.readabilityGrade).toBe(8.9);
    expect(ReviewStateSchema.safeParse(state({ ...hunk, readabilityGrade: "high" })).success).toBe(false);
  });
});
