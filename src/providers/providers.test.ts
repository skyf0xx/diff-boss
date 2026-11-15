import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PlanningInput } from "../contract/hunk";
import { ProviderError } from "../contract/ports";
import type { Provider, Skill } from "../contract/ports";
import {
  ClaudeAgentProvider,
  DEFAULT_CLAUDE_MODEL,
  InMemoryProviderRegistry,
  NOT_SIGNED_IN_MESSAGE,
  SkillLoadError,
  buildSystemPrompt,
  createDefaultRegistry,
  loadSkill,
  unwrapCodeFence,
} from "./index";
import type { ClaudeQueryFn } from "./index";
import { fleschKincaidGrade } from "../plan/readability";

const SKILL_DIR = join(__dirname, "..", "..", "skill");

const input: PlanningInput = {
  hunks: [{ id: "aaaaaaaaaa", file: "a.ts", status: "modified", header: "@@ -1 +1 @@", patch: "-a\n+b" }],
  recentCommits: ["feat: x"],
};
const skill: Skill = {
  body: "---\nname: n\ndescription: d\n---\n\nBODY TEXT",
  references: { "WRITING.md": "writing text", "PLAN.md": "plan text", "STAGES.md": "stages text" },
};

function result(text: string): SDKMessage {
  return { type: "result", subtype: "success", is_error: false, result: text } as unknown as SDKMessage;
}

interface Call {
  prompt: string;
  options: Options | undefined;
}
function fakeQuery(messages: SDKMessage[] | Error): { query: ClaudeQueryFn; calls: Call[] } {
  const calls: Call[] = [];
  const query: ClaudeQueryFn = (params) => {
    calls.push({ prompt: params.prompt, options: params.options });
    return (async function* () {
      if (messages instanceof Error) throw messages;
      yield* messages;
    })();
  };
  return { query, calls };
}

describe("loadSkill", () => {
  it("loads the shipped skill files", async () => {
    const s = await loadSkill(SKILL_DIR);
    expect(s.body).toContain("name: diff-boss-plan");
    expect(Object.keys(s.references).sort()).toEqual(["PLAN.md", "STAGES.md", "WRITING.md"]);
    for (const text of Object.values(s.references)) expect(text.length).toBeGreaterThan(100);
  });

  it("throws a typed error for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-"));
    try {
      await writeFile(join(dir, "SKILL.md"), "body");
      await mkdir(join(dir, "references"));
      await writeFile(join(dir, "references", "PLAN.md"), "p");
      const err = await loadSkill(dir).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SkillLoadError);
      expect((err as SkillLoadError).path).toBe(join(dir, "references", "STAGES.md"));
      expect((err as SkillLoadError).message).toContain("is missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws for a missing directory and for an empty file", async () => {
    await expect(loadSkill(join(tmpdir(), "no-such-skill-dir"))).rejects.toBeInstanceOf(SkillLoadError);
    const dir = await mkdtemp(join(tmpdir(), "skill-"));
    try {
      await writeFile(join(dir, "SKILL.md"), "  \n");
      await expect(loadSkill(dir)).rejects.toThrow(/is empty/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("skill content", () => {
  it("uses the corrected grade wording everywhere", async () => {
    const s = await loadSkill(SKILL_DIR);
    const all = [s.body, ...Object.values(s.references)].join("\n");
    expect(all).not.toMatch(/7 or lower/i);
    expect(s.references["PLAN.md"]).toMatch(/aim for 7, the limit is 8/);
    expect(s.references["WRITING.md"]).toMatch(/aim for 7, the limit is 8/);
    expect(s.body).toMatch(/limit is 8/);
  });

  it("references files that exist and has frontmatter", async () => {
    const s = await loadSkill(SKILL_DIR);
    expect(s.body).toMatch(/^---\nname: diff-boss-plan\ndescription: ".+"\n---\n/);
    for (const m of s.body.matchAll(/references\/([A-Z]+\.md)/g)) {
      expect(s.references).toHaveProperty(m[1] as string);
    }
    expect(s.references["STAGES.md"]).toMatch(/"type": "style", "scope": "format", "description": "remove extra space"/);
    expect(s.references["STAGES.md"]).not.toMatch(/"h\d"/);
  });

  it("lists every validator message in PLAN.md", async () => {
    const plan = (await loadSkill(SKILL_DIR)).references["PLAN.md"] ?? "";
    const messages = [
      "✗ json: output is not valid JSON",
      "✗ json: output is not a JSON object",
      "✗ json: the plan doesn't match the format",
      "✗ hunks: <id> isn't in any stage",
      "✗ hunks: <id> appears more than once",
      "✗ hunks: <id> isn't a hunk in the input",
      "✗ stages: <n> stages, use 1 to 12",
      "✗ stages[i].type:",
      "✗ stages[i].scope:",
      "✗ stages[i].description:",
      "✗ stages[i].header: <n> characters, the limit is 72",
      "✗ stages[i].hunks: the stage has no hunks",
      "✗ hunks[<id>].summary: <n> words, the limit is 20",
      "✗ hunks[<id>].summary: it must be one sentence",
      "✗ hunks[<id>].summary: reading grade <n>, the limit is 8",
      "✗ hunks[<id>].needs: <other> isn't a hunk in the plan",
      "✗ hunks[<id>].needs: <other> is the hunk itself",
      "✗ hunks[<id>].needs: <other> comes later",
      "✗ order: <id> doesn't apply after the hunks before it",
    ];
    for (const m of messages) expect(plan, m).toContain(m);
  });

  it("keeps every example summary inside the validator limits", async () => {
    const s = await loadSkill(SKILL_DIR);
    const all = [...Object.values(s.references)].join("\n");
    const summaries = [...all.matchAll(/"summary": "([^"]+)"/g)].map((m) => m[1] as string);
    expect(summaries.length).toBeGreaterThan(5);
    for (const t of summaries) {
      expect(t.split(/\s+/).length).toBeLessThanOrEqual(20);
      expect(fleschKincaidGrade(t) ?? 0, t).toBeLessThanOrEqual(8);
    }
  });
});

describe("InMemoryProviderRegistry", () => {
  const fake = (id: string): Provider => ({ id, generatePlan: async () => id });

  it("registers, gets and lists", () => {
    const r = new InMemoryProviderRegistry();
    expect(r.get("x")).toBeUndefined();
    r.register(fake("x"));
    expect(r.get("x")?.id).toBe("x");
    expect(r.list()).toEqual(["x"]);
  });

  it("rejects a duplicate id", () => {
    const r = new InMemoryProviderRegistry();
    r.register(fake("x"));
    expect(() => r.register(fake("x"))).toThrow(ProviderError);
  });

  it("default registry has claude and accepts a second provider without other changes", async () => {
    const r = createDefaultRegistry({ claude: { model: "opus" } });
    expect(r.list()).toEqual(["claude"]);
    r.register(fake("second"));
    expect(r.list()).toEqual(["claude", "second"]);
    expect(await r.get("second")?.generatePlan(input, skill)).toBe("second");
  });
});

describe("ClaudeAgentProvider", () => {
  it("unwraps one code fence around the whole reply", async () => {
    const { query } = fakeQuery([result('```json\n{"stages":[]}\n```\n')]);
    expect(await new ClaudeAgentProvider({ query }).generatePlan(input, skill)).toBe('{"stages":[]}');
    expect(unwrapCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrapCodeFence('Here it is:\n```json\n{}\n```')).toBe('Here it is:\n```json\n{}\n```');
    expect(unwrapCodeFence('{"a":"```"}')).toBe('{"a":"```"}');
  });

  it("returns the raw final text untouched", async () => {
    const { query } = fakeQuery([result('  {"stages":[]}\n')]);
    const p = new ClaudeAgentProvider({ query });
    expect(await p.generatePlan(input, skill)).toBe('  {"stages":[]}\n');
  });

  it("builds the system prompt from the skill and the user message from the input", async () => {
    const { query, calls } = fakeQuery([result("{}")]);
    await new ClaudeAgentProvider({ query }).generatePlan(input, skill);
    const call = calls[0] as Call;
    const sys = call.options?.systemPrompt as string;
    expect(sys).toBe(buildSystemPrompt(skill));
    expect(sys).toContain("BODY TEXT");
    expect(sys).not.toContain("name: n");
    expect(sys.indexOf("plan text")).toBeLessThan(sys.indexOf("stages text"));
    expect(sys.indexOf("stages text")).toBeLessThan(sys.indexOf("writing text"));
    expect(call.prompt).toContain(JSON.stringify(input, null, 2));
    expect(call.prompt).not.toContain("✗");
  });

  it("adds the problems and the fix instruction on retry", async () => {
    const { query, calls } = fakeQuery([result("{}")]);
    await new ClaudeAgentProvider({ query }).generatePlan(input, skill, [
      { field: "hunks", message: "aaaaaaaaaa isn't in any stage, add it" },
      { field: "order", message: "bbb doesn't apply" },
    ]);
    const prompt = (calls[0] as Call).prompt;
    expect(prompt).toContain(JSON.stringify(input, null, 2));
    expect(prompt).toContain("✗ hunks: aaaaaaaaaa isn't in any stage, add it\n✗ order: bbb doesn't apply");
    expect(prompt).toMatch(/Fix every line above and return the whole plan again/);
  });

  it("disables tools and one-shots the session", async () => {
    const { query, calls } = fakeQuery([result("{}")]);
    await new ClaudeAgentProvider({ query }).generatePlan(input, skill);
    const o = (calls[0] as Call).options as Options;
    expect(o.tools).toEqual([]);
    expect(o.maxTurns).toBe(1);
    expect(o.settingSources).toEqual([]);
    expect(o.persistSession).toBe(false);
    expect(o.thinking).toEqual({ type: "disabled" });
    expect(o.abortController).toBeInstanceOf(AbortController);
  });

  it("aborts an attempt that runs past the timeout and reports it", async () => {
    let signal: AbortSignal | undefined;
    const query: ClaudeQueryFn = (params) => {
      signal = params.options?.abortController?.signal;
      return (async function* () {
        await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      })();
    };
    const err = await new ClaudeAgentProvider({ query, timeoutMs: 20 })
      .generatePlan(input, skill)
      .catch((e: unknown) => e);
    expect(signal?.aborted).toBe(true);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toBe("Claude did not answer within 1 s");
  });

  it("uses the default model and honours the constructor option", async () => {
    const a = fakeQuery([result("{}")]);
    await new ClaudeAgentProvider({ query: a.query }).generatePlan(input, skill);
    expect((a.calls[0] as Call).options?.model).toBe(DEFAULT_CLAUDE_MODEL);
    const b = fakeQuery([result("{}")]);
    await new ClaudeAgentProvider({ query: b.query, model: "claude-opus-x" }).generatePlan(input, skill);
    expect((b.calls[0] as Call).options?.model).toBe("claude-opus-x");
    expect(new ClaudeAgentProvider({ model: "  " }).model).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("passes no API key in options or env, even when the environment has one", async () => {
    const { query, calls } = fakeQuery([result("{}")]);
    const env = { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "sk-secret", ANTHROPIC_AUTH_TOKEN: "tok" };
    await new ClaudeAgentProvider({ query, env }).generatePlan(input, skill);
    const o = (calls[0] as Call).options as Options;
    expect(o.env).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(JSON.stringify(o)).not.toMatch(/sk-secret|apiKey|api_key/i);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-secret");
  });

  it("maps a thrown auth failure to the not-signed-in ProviderError", async () => {
    const { query } = fakeQuery(new Error("Invalid API key · Please run /login"));
    const err = await new ClaudeAgentProvider({ query }).generatePlan(input, skill).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).providerId).toBe("claude");
    expect((err as ProviderError).message).toContain(NOT_SIGNED_IN_MESSAGE);
    expect((err as ProviderError).cause).toBeInstanceOf(Error);
  });

  it("maps an assistant authentication_failed result to the not-signed-in error", async () => {
    const { query } = fakeQuery([
      { type: "assistant", error: "authentication_failed", message: {} } as unknown as SDKMessage,
      { type: "result", subtype: "success", is_error: true, result: "Not logged in" } as unknown as SDKMessage,
    ]);
    await expect(new ClaudeAgentProvider({ query }).generatePlan(input, skill)).rejects.toThrow(
      NOT_SIGNED_IN_MESSAGE,
    );
  });

  it("wraps other SDK failures, error results and a missing result", async () => {
    const boom = fakeQuery(new Error("spawn ENOENT"));
    const e1 = await new ClaudeAgentProvider({ query: boom.query }).generatePlan(input, skill).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ProviderError);
    expect((e1 as Error).message).toContain("spawn ENOENT");
    expect((e1 as Error).message).not.toContain(NOT_SIGNED_IN_MESSAGE);

    const err = fakeQuery([
      { type: "result", subtype: "error_max_turns", is_error: true, errors: ["too many"] } as unknown as SDKMessage,
    ]);
    await expect(new ClaudeAgentProvider({ query: err.query }).generatePlan(input, skill)).rejects.toThrow(
      /too many/,
    );

    const none = fakeQuery([]);
    await expect(new ClaudeAgentProvider({ query: none.query }).generatePlan(input, skill)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});
