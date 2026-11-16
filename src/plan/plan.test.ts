import { describe, expect, it } from "vitest";
import {
  UNPLANNED_HEADER,
  formatProblems,
  type Hunk,
  type HunkApplyResult,
  type PlanningInput,
  type Problem,
  type ScratchIndex,
} from "../contract";
import { buildReviewState, countSyllables, fleschKincaidGrade, validatePlan } from "./index";

const hunk = (id: string, file: string): Hunk => ({
  id,
  file,
  status: "modified",
  header: "@@ -1 +1 @@",
  patch: `patch-${id}`,
});
// a.ts has three hunks, b.ts one, c.ts one.
const input: PlanningInput = {
  hunks: [hunk("a1", "a.ts"), hunk("a2", "a.ts"), hunk("a3", "a.ts"), hunk("b1", "b.ts"), hunk("c1", "c.ts")],
  recentCommits: [],
};

function fakeIndex(failIds: string[] = []): ScratchIndex & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async apply(hunks): Promise<HunkApplyResult[]> {
      calls.push(hunks.map((h) => h.id));
      return hunks.map((h) =>
        failIds.includes(h.id) ? { id: h.id, ok: false, reason: "patch does not apply" } : { id: h.id, ok: true },
      );
    },
  };
}

const run = (plan: unknown, idx = fakeIndex()) =>
  validatePlan(typeof plan === "string" ? plan : JSON.stringify(plan), input, idx);
const lines = (r: { problems: Problem[] }) => formatProblems(r.problems);
const shape = (r: Awaited<ReturnType<typeof run>>) =>
  r.stages?.map((s) => [s.header, s.hunks.map((h) => `${h.id}:${h.summary}`)]);

describe("readability", () => {
  it("counts syllables", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("token")).toBe(2);
    expect(countSyllables("balance")).toBe(2);
    expect(countSyllables("format")).toBe(2);
    expect(countSyllables("formatted")).toBe(3);
    expect(countSyllables("refused")).toBe(2);
    expect(countSyllables("polymorphic")).toBe(4);
  });

  it("computes known grades", () => {
    // 6 words, 6 syllables: 0.39*6 + 11.8*1 - 15.59 = -1.45
    expect(fleschKincaidGrade("The cat sat on the mat.")).toBeCloseTo(0.39 * 6 + 11.8 - 15.59, 5);
    expect(fleschKincaidGrade("Cat.")).toBeCloseTo(0.39 + 11.8 - 15.59, 5);
    expect(fleschKincaidGrade("")).toBeUndefined();
    const hard =
      "Refactoring the service to leverage a polymorphic dispatcher necessitates considerable architectural deliberation.";
    expect(fleschKincaidGrade(hard)!).toBeGreaterThan(8);
  });

});

describe("validatePlan", () => {
  it("expands a whole file to its hunks, in diff order", async () => {
    const idx = fakeIndex();
    const r = await run({ stages: [{ header: "feat(a): add a", files: { "a.ts": "A now works.", "b.ts": "" } }, { header: "fix: c", files: { "c.ts": "C." } }] }, idx);
    expect(r.problems).toEqual([]);
    expect(shape(r)).toEqual([
      ["feat(a): add a", ["a1:A now works.", "a2:A now works.", "a3:A now works.", "b1:"]],
      ["fix: c", ["c1:C."]],
    ]);
    expect(idx.calls).toEqual([["a1", "a2", "a3", "b1", "c1"]]);
  });

  it("lets path#n claim a hunk before the whole-file key takes the rest", async () => {
    const r = await run({ stages: [{ header: "feat: a", files: { "a.ts": "Most of a." } }, { header: "test: a", files: { "a.ts#2": "The second.", "b.ts": "" } }] });
    expect(shape(r)).toEqual([
      ["feat: a", ["a1:Most of a.", "a3:Most of a."]],
      ["test: a", ["a2:The second.", "b1:"]],
      [UNPLANNED_HEADER, ["c1:"]],
    ]);
  });

  it("puts unclaimed hunks in a final unplanned stage and drops stages left empty", async () => {
    const r = await run({ stages: [{ header: "feat: one", files: { "a.ts#1": "", "a.ts#2": "", "a.ts#3": "" } }, { header: "feat: empty", files: { "a.ts": "" } }] });
    expect(shape(r)).toEqual([
      ["feat: one", ["a1:", "a2:", "a3:"]],
      [UNPLANNED_HEADER, ["b1:", "c1:"]],
    ]);
    expect(shape(await run({ stages: [] }))).toEqual([[UNPLANNED_HEADER, ["a1:", "a2:", "a3:", "b1:", "c1:"]]]);
  });

  it("reports bad JSON and the wrong shape", async () => {
    expect(lines(await run("nope"))[0]).toMatch(/^✗ json: not valid JSON/);
    expect(lines(await run({ stages: [{ header: "feat: x", hunks: [] }] }))[0]).toMatch(/^✗ json: expected .* wrong at stages.0.files/);
  });

  it("reports bad and long headers", async () => {
    const long = `feat: ${"x".repeat(70)}`;
    const r = await run({ stages: [{ header: "added stuff", files: { "a.ts": "" } }, { header: long, files: { "b.ts": "" } }, { header: "feat(A): x", files: {} }] });
    expect(lines(r)).toEqual([
      expect.stringMatching(/^✗ stages\[0\]\.header: "added stuff" isn't type\(scope\): description/),
      `✗ stages[1].header: ${long.length} characters, the limit is 72`,
      expect.stringMatching(/^✗ stages\[2\]\.header/),
    ]);
  });

  it("reports unknown files, out-of-range hunks and double claims", async () => {
    const r = await run({ stages: [{ header: "feat: x", files: { "z.ts": "", "a.ts#4": "", "b.ts#1": "", "c.ts": "" } }, { header: "fix: y", files: { "b.ts#1": "", "c.ts": "" } }] });
    expect(lines(r)).toEqual([
      "✗ stages[0].files: z.ts: no unstaged changes in that file",
      "✗ stages[0].files: a.ts#4: the file has 3 hunks",
      "✗ stages[1].files: b.ts#1 is listed twice",
      "✗ stages[1].files: c.ts is listed twice, use c.ts#n to split it",
    ]);
  });

  it("reports a hunk that doesn't apply in plan order", async () => {
    const r = await run({ stages: [{ header: "feat: x", files: { "a.ts": "" } }] }, fakeIndex(["a2"]));
    expect(lines(r)).toEqual(["✗ order: a.ts: a hunk doesn't apply after the ones before it (patch does not apply)"]);
  });

  it("warns on a hard summary and still accepts the plan", async () => {
    const hard = "Refactoring the service to leverage a polymorphic dispatcher necessitates considerable architectural deliberation.";
    const r = await run({ stages: [{ header: "refactor: x", files: { "b.ts": hard, "c.ts": "C now works." } }] });
    expect(r.stages).toBeDefined();
    expect(r.warnings.map((w) => w.hunkId)).toEqual(["b1"]);
  });
});

describe("review state", () => {
  it("numbers hunks across stages and carries summaries and grades", () => {
    const state = buildReviewState(
      [{ header: "feat: x", hunks: [{ id: "b1", summary: "B." }] }, { header: "fix: y", hunks: [{ id: "a1", summary: "" }] }],
      input.hunks,
      [{ hunkId: "a1", grade: 9.2 }],
    );
    expect(state.currentStage).toBe(0);
    expect(state.stages.map((s) => [s.header, s.commitMessage, s.hunks.map((h) => [h.number, h.file, h.summary, h.readabilityGrade])])).toEqual([
      ["feat: x", "feat: x", [[1, "b.ts", "B.", undefined]]],
      ["fix: y", "fix: y", [[2, "a.ts", "", 9.2]]],
    ]);
  });

  it("throws for an id it cannot resolve", () => {
    expect(() => buildReviewState([{ header: "feat: x", hunks: [{ id: "zz", summary: "" }] }], input.hunks)).toThrow(/zz/);
  });
});
