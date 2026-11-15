import { describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  formatProblems,
  type Hunk,
  type HunkApplyResult,
  type PlanningInput,
  type Problem,
  type Provider,
  type ScratchIndex,
  type Skill,
} from "../contract";
import {
  buildReviewState,
  countSyllables,
  dependentsOf,
  fleschKincaidGrade,
  runPlanner,
  validatePlan,
} from "./index";

const hunk = (id: string, file = `src/${id}.ts`): Hunk => ({
  id,
  file,
  status: "modified",
  header: "@@ -1 +1 @@",
  patch: `patch-${id}`,
});
const ids = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"];
const input: PlanningInput = { hunks: ids.map((i) => hunk(i)), recentCommits: [] };
const skill: Skill = { body: "skill", references: {} };

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

const ph = (id: string, summary: string, needs: string[] = []) => ({ id, summary, needs });

function workedExample() {
  return {
    stages: [
      {
        type: "feat", scope: "balance", description: "validate token ids",
        hunks: [
          ph("h1", "Token IDs can now be checked for the right format."),
          ph("h2", "A bad token ID is now shown to fail the check.", ["h1"]),
        ],
      },
      {
        type: "feat", scope: "balance", description: "return balances per token",
        hunks: [
          ph("h3", "Balances now have a type with a token ID and an amount."),
          ph("h4", "Asking for a balance now needs a token ID, and bad IDs are refused.", ["h1", "h3"]),
          ph("h5", "The balance hook now passes the chosen token to the service.", ["h4"]),
          ph("h6", "The list now shows one row for each token.", ["h5"]),
          ph("h7", "A test now checks that one token returns its own balance.", ["h4"]),
        ],
      },
      {
        type: "style", scope: "format", description: "remove extra space",
        hunks: [ph("h8", "Numbers are formatted the same way, with one less space.")],
      },
    ],
  };
}

const run = (plan: unknown, idx = fakeIndex()) =>
  validatePlan(typeof plan === "string" ? plan : JSON.stringify(plan), input, idx);
const lines = (r: { problems: Problem[] }) => formatProblems(r.problems);

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

  it("keeps every plan.md and writing.md example summary within grade 8", () => {
    const examples = [
      "Token IDs can now be checked for the right format.",
      "A bad token ID is now shown to fail the check.",
      "Asking for a balance now needs a token ID, and bad IDs are refused.",
      "The list now shows one row for each token.",
      "Numbers are formatted the same way, with one less space.",
      "Extra spaces are removed and nothing else changes.",
      "Bad IDs now cause an error instead of returning zero.",
      "Balances are now looked up for one token at a time.",
      "Empty IDs are now refused instead of returning zero.",
      "The service now picks the right handler for each token.",
      "Balances now have a type with a token ID and an amount.",
      "The balance hook now passes the chosen token to the service.",
      "A test now checks that one token returns its own balance.",
    ];
    for (const s of examples) {
      const g = fleschKincaidGrade(s)!;
      expect(g, s).toBeLessThanOrEqual(8);
    }
  });
});

describe("validatePlan", () => {
  it("accepts the worked example and returns the plan", async () => {
    const idx = fakeIndex();
    const r = await run(workedExample(), idx);
    expect(r.problems).toEqual([]);
    expect(r.plan?.stages).toHaveLength(3);
    expect(idx.calls).toEqual([ids]);
  });

  it("tolerates surrounding whitespace", async () => {
    expect((await run(`\n  ${JSON.stringify(workedExample())}\n`)).problems).toEqual([]);
  });

  it("reports ✗ json for invalid JSON, non-objects, fenced output and wrong shape", async () => {
    for (const raw of ["not json", "[]", "null", "```json\n{}\n```", '{"stages": "x"}', "{}"]) {
      const r = await run(raw);
      expect(r.plan).toBeUndefined();
      expect(r.problems).toHaveLength(1);
      expect(lines(r)[0]).toMatch(/^✗ json: /);
    }
  });

  it("reports missing, duplicated and unknown hunks", async () => {
    const p = workedExample();
    p.stages[2]!.hunks = [ph("h8", "Numbers are formatted the same way, with one less space."), ph("h1", "Token IDs can now be checked for the right format."), ph("zz", "A new hunk exists now.")];
    p.stages[1]!.hunks.pop();
    const out = lines(await run(p));
    expect(out).toContain("✗ hunks: h7 isn't in any stage, add it to the stage it belongs to");
    expect(out).toContain("✗ hunks: zz isn't a hunk in the input, remove it");
    expect(out.some((l) => l.startsWith("✗ hunks: h1 appears more than once"))).toBe(true);
  });

  it("reports the stage count", async () => {
    const r = await run({ stages: [] });
    expect(lines(r)).toContain("✗ stages: 0 stages, use 1 to 12");
    const many = {
      stages: Array.from({ length: 13 }, (_, i) => ({
        type: "chore", description: "tidy", hunks: i === 0 ? ids.map((id) => ph(id, "It is done now.")) : [],
      })),
    };
    expect(lines(await run(many))).toContain("✗ stages: 13 stages, use 1 to 12");
  });

  it("reports bad stage type, scope, description, header and empty stage", async () => {
    const p = workedExample();
    p.stages[0]!.type = "feature";
    p.stages[0]!.scope = "Bad_Scope";
    p.stages[0]!.description = "Validate token ids.";
    p.stages[1]!.description = "x".repeat(70);
    p.stages.push({ type: "chore", scope: "x", description: "empty", hunks: [] } as never);
    const out = lines(await run(p));
    expect(out.some((l) => l.startsWith("✗ stages[0].type: "))).toBe(true);
    expect(out.some((l) => l.startsWith("✗ stages[0].scope: "))).toBe(true);
    expect(out.some((l) => l.startsWith("✗ stages[0].description: "))).toBe(true);
    expect(out.some((l) => /^✗ stages\[1\]\.header: \d+ characters, the limit is 72/.test(l))).toBe(true);
    expect(out.some((l) => l.startsWith("✗ stages[3].hunks: "))).toBe(true);
  });

  it("distinguishes uppercase and final period in descriptions", async () => {
    const p = workedExample();
    p.stages[0]!.description = "validate token ids.";
    expect(lines(await run(p)).join("\n")).toMatch(/stages\[0\]\.description: .*ends with a period/);
    p.stages[0]!.description = "Validate token ids";
    expect(lines(await run(p)).join("\n")).toMatch(/stages\[0\]\.description: .*isn't lowercase/);
  });

  it("accepts a stage without a scope and a header of exactly 72 characters", async () => {
    const p = workedExample();
    delete (p.stages[2] as { scope?: string }).scope;
    p.stages[0]!.description = "a".repeat(72 - "feat(balance): ".length);
    expect((await run(p)).problems).toEqual([]);
    p.stages[0]!.description += "a";
    expect(lines(await run(p))).toContain("✗ stages[0].header: 73 characters, the limit is 72, shorten the description");
  });

  it("reports long, grade-heavy and malformed summaries", async () => {
    const p = workedExample();
    p.stages[0]!.hunks[0]!.summary = Array(21).fill("word").join(" ") + ".";
    p.stages[0]!.hunks[1]!.summary =
      "Refactoring necessitates considerable architectural deliberation regarding polymorphic dispatchers.";
    p.stages[1]!.hunks[0]!.summary = "No period here";
    p.stages[1]!.hunks[1]!.summary = "It is done. It is done again.";
    const out = lines(await run(p));
    expect(out).toContain("✗ hunks[h1].summary: 21 words, the limit is 20, cut it to one shorter sentence");
    expect(out.some((l) => l.includes("hunks[h2].summary"))).toBe(false);
    expect(out.some((l) => l.startsWith("✗ hunks[h3].summary: it must be one sentence"))).toBe(true);
    expect(out.some((l) => l.startsWith("✗ hunks[h4].summary: it must be one sentence"))).toBe(true);
  });

  it("reports a high reading grade as a warning and still accepts the plan", async () => {
    const p = workedExample();
    p.stages[0]!.hunks[1]!.summary =
      "Refactoring necessitates considerable architectural deliberation regarding polymorphic dispatchers.";
    const r = await run(p);
    expect(r.problems).toEqual([]);
    expect(r.plan).toBeDefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.hunkId).toBe("h2");
    expect(r.warnings[0]!.grade).toBeGreaterThan(8);
    expect((await run(workedExample())).warnings).toEqual([]);
  });

  it("reports a needs id that comes later, is unknown or is itself", async () => {
    const p = workedExample();
    p.stages[0]!.hunks[0]!.needs = ["h3"];
    p.stages[0]!.hunks[1]!.needs = ["nope"];
    p.stages[2]!.hunks[0]!.needs = ["h8"];
    const out = lines(await run(p));
    expect(out).toContain("✗ hunks[h1].needs: h3 comes later, move the hunk after the one it needs or remove the dependency");
    expect(out).toContain("✗ hunks[h2].needs: nope isn't a hunk in the plan, remove it");
    expect(out).toContain("✗ hunks[h8].needs: h8 is the hunk itself, remove the dependency");
  });

  it("reports one ✗ order line per failed hunk", async () => {
    const idx = fakeIndex(["h3", "h6"]);
    const r = await run(workedExample(), idx);
    const out = lines(r);
    expect(r.plan).toBeUndefined();
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^✗ order: h3 doesn't apply after the hunks before it \(patch does not apply\)/);
    expect(out[1]).toMatch(/^✗ order: h6 /);
  });

  it("skips the order check when structural problems exist", async () => {
    const idx = fakeIndex();
    const p = workedExample();
    p.stages[0]!.type = "nope";
    await run(p, idx);
    expect(idx.calls).toEqual([]);
  });

  it("orders the checks as plan.md lists them", async () => {
    const p = workedExample();
    p.stages[0]!.type = "nope";
    p.stages[0]!.hunks[0]!.summary = "No period";
    p.stages[0]!.hunks[0]!.needs = ["h3"];
    p.stages[2]!.hunks = [];
    const fields = (await run(p)).problems.map((x) => x.field);
    expect(fields).toEqual([
      "hunks",
      "stages[0].type",
      "stages[2].hunks",
      "hunks[h1].summary",
      "hunks[h1].needs",
    ]);
  });
});

describe("runPlanner", () => {
  const providerOf = (outputs: string[]) => {
    const generatePlan = vi.fn(async (_i: PlanningInput, _s: Skill, _p?: readonly Problem[]) => {
      return outputs[Math.min(generatePlan.mock.calls.length - 1, outputs.length - 1)]!;
    });
    return { provider: { id: "fake", generatePlan } satisfies Provider, generatePlan };
  };
  const good = JSON.stringify(workedExample());

  it("accepts on the first attempt without previousProblems", async () => {
    const { provider, generatePlan } = providerOf([good]);
    const r = await runPlanner({ provider, skill, input, scratchIndex: fakeIndex(), maxAttempts: 3 });
    expect(r).toMatchObject({ ok: true, attempts: 1, warnings: [] });
    expect(generatePlan.mock.calls[0]![2]).toBeUndefined();
  });

  it("retries with the problems and succeeds on the second attempt", async () => {
    const { provider, generatePlan } = providerOf(["nope", good]);
    const progress: Array<[number, number]> = [];
    const r = await runPlanner({
      provider, skill, input, scratchIndex: fakeIndex(), maxAttempts: 3,
      onProgress: (a, m) => progress.push([a, m]),
    });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(formatProblems(generatePlan.mock.calls[1]![2]!)[0]).toMatch(/^✗ json: /);
    expect(progress).toEqual([[1, 3], [2, 3]]);
  });

  it("fails with the last problems after maxAttempts", async () => {
    const { provider, generatePlan } = providerOf(["nope", JSON.stringify({ stages: [] })]);
    const r = await runPlanner({ provider, skill, input, scratchIndex: fakeIndex(), maxAttempts: 2 });
    expect(generatePlan).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attempts).toBe(2);
      expect(lines(r)).toContain("✗ stages: 0 stages, use 1 to 12");
    }
  });

  it("propagates ProviderError", async () => {
    const err = new ProviderError("login expired", "fake");
    const provider: Provider = { id: "fake", generatePlan: async () => { throw err; } };
    await expect(
      runPlanner({ provider, skill, input, scratchIndex: fakeIndex(), maxAttempts: 3 }),
    ).rejects.toBe(err);
  });

  it("rejects an invalid maxAttempts", async () => {
    const { provider } = providerOf([good]);
    await expect(
      runPlanner({ provider, skill, input, scratchIndex: fakeIndex(), maxAttempts: 0 }),
    ).rejects.toThrow(RangeError);
  });
});

describe("review state", () => {
  const plan = workedExample();

  it("numbers hunks by final position and maps needs to numbers", () => {
    const state = buildReviewState(plan, input.hunks);
    expect(state.currentStage).toBe(0);
    expect(state.stages.map((s) => s.header)).toEqual([
      "feat(balance): validate token ids",
      "feat(balance): return balances per token",
      "style(format): remove extra space",
    ]);
    const all = state.stages.flatMap((s) => s.hunks);
    expect(all.map((h) => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(all.find((h) => h.id === "h4")!.needs).toEqual([1, 3]);
    expect(all.find((h) => h.id === "h7")!.needs).toEqual([4]);
    expect(all[0]).toMatchObject({ file: "src/h1.ts", status: "modified", patch: "patch-h1", staged: false });
    expect(state.stages[1]).toMatchObject({ commitMessage: "feat(balance): return balances per token", committed: false });
  });

  it("carries a warned hunk's reading grade and leaves the others without one", () => {
    const state = buildReviewState(plan, input.hunks, [{ hunkId: "h3", grade: 8.9 }]);
    const all = state.stages.flatMap((s) => s.hunks);
    expect(all.find((h) => h.id === "h3")!.readabilityGrade).toBe(8.9);
    expect(all.filter((h) => h.readabilityGrade !== undefined).map((h) => h.id)).toEqual(["h3"]);
  });

  it("numbers by plan position, not input order", () => {
    const reversed = { stages: [{ type: "chore", description: "x", hunks: [ph("h2", "It is.", []), ph("h1", "It is.", ["h2"])] }] };
    const state = buildReviewState(reversed, [hunk("h1"), hunk("h2")]);
    expect(state.stages[0]!.hunks.map((h) => [h.id, h.number, h.needs])).toEqual([
      ["h2", 1, []],
      ["h1", 2, [1]],
    ]);
  });

  it("finds dependents", () => {
    const state = buildReviewState(plan, input.hunks);
    expect(dependentsOf(state, "h1")).toEqual([2, 4]);
    expect(dependentsOf(state, "h4")).toEqual([5, 7]);
    expect(dependentsOf(state, "h8")).toEqual([]);
    expect(dependentsOf(state, "missing")).toEqual([]);
  });

  it("throws a typed error for ids it cannot resolve", () => {
    expect(() => buildReviewState(plan, [hunk("h1")])).toThrow(/not in the input hunks/);
  });
});
