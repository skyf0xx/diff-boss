import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PlanningInput } from "../contract/hunk";
import { ProviderError } from "../contract/ports";
import type { Provider, Skill } from "../contract/ports";
import { formatProblems } from "../contract/problem";
import type { Problem } from "../contract/problem";

export const CLAUDE_PROVIDER_ID = "claude";
export const DEFAULT_CLAUDE_MODEL = "sonnet";

export const NOT_SIGNED_IN_MESSAGE = "Claude Code is not signed in, run `claude` and log in";

/** Variables that would switch the SDK from the local login to key-based auth. */
export const STRIPPED_ENV_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

export type ClaudeQueryFn = (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeAgentProviderOptions {
  model?: string;
  /** Injected in tests; defaults to the SDK's `query`, loaded on first use. */
  query?: ClaudeQueryFn;
  /** Environment the SDK subprocess inherits; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const defaultQuery: ClaudeQueryFn = (params) => {
  async function* run() {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    yield* sdk.query(params);
  }
  return run();
};

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "");
}

export function buildSystemPrompt(skill: Skill): string {
  const parts = [stripFrontmatter(skill.body).trim()];
  for (const name of Object.keys(skill.references).sort()) {
    parts.push(`# references/${name}\n\n${(skill.references[name] ?? "").trim()}`);
  }
  return parts.join("\n\n---\n\n");
}

export function buildUserMessage(input: PlanningInput, previousProblems?: readonly Problem[]): string {
  const lines = ["Plan the review for this input.", "", JSON.stringify(input, null, 2)];
  if (previousProblems && previousProblems.length > 0) {
    lines.push(
      "",
      "The plan you returned last time was rejected with these problems:",
      "",
      ...formatProblems(previousProblems),
      "",
      "Fix every line above and return the whole plan again, as one JSON object and nothing else.",
    );
  }
  return lines.join("\n");
}

export function buildEnv(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source };
  for (const name of STRIPPED_ENV_VARS) delete env[name];
  return env;
}

const AUTH_ERROR_CODES = new Set(["authentication_failed", "oauth_org_not_allowed", "verification_required"]);
const AUTH_TEXT = /not (?:logged|signed) in|\/login|authentication|unauthorized|\b401\b|invalid api key|credential|oauth/i;

export class ClaudeAgentProvider implements Provider {
  readonly id = CLAUDE_PROVIDER_ID;
  readonly model: string;
  private readonly query: ClaudeQueryFn;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string | undefined;

  constructor(options: ClaudeAgentProviderOptions = {}) {
    this.model = options.model?.trim() || DEFAULT_CLAUDE_MODEL;
    this.query = options.query ?? defaultQuery;
    this.env = options.env ?? process.env;
    this.cwd = options.cwd;
  }

  buildOptions(skill: Skill): Options {
    const options: Options = {
      model: this.model,
      systemPrompt: buildSystemPrompt(skill),
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      permissionMode: "dontAsk",
      env: buildEnv(this.env),
    };
    if (this.cwd) options.cwd = this.cwd;
    return options;
  }

  async generatePlan(input: PlanningInput, skill: Skill, previousProblems?: readonly Problem[]): Promise<string> {
    const prompt = buildUserMessage(input, previousProblems);
    let assistantError: string | undefined;
    let result: Extract<SDKMessage, { type: "result" }> | undefined;
    try {
      for await (const message of this.query({ prompt, options: this.buildOptions(skill) })) {
        if (message.type === "assistant" && message.error) assistantError = message.error;
        else if (message.type === "result") result = message;
      }
    } catch (err) {
      throw this.wrap(err);
    }

    if (!result) {
      if (assistantError) throw this.fail(assistantError, assistantError);
      throw new ProviderError("Claude returned no result", this.id);
    }
    if (result.subtype !== "success" || result.is_error) {
      const detail =
        result.subtype === "success" ? result.result : result.errors.join("; ") || result.subtype;
      throw this.fail(assistantError ?? detail, detail);
    }
    return result.result;
  }

  private fail(signal: string, detail: string): ProviderError {
    if (AUTH_ERROR_CODES.has(signal) || AUTH_TEXT.test(detail)) {
      return new ProviderError(`${NOT_SIGNED_IN_MESSAGE} (${detail})`, this.id);
    }
    return new ProviderError(`Claude request failed: ${detail}`, this.id);
  }

  private wrap(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const detail = err instanceof Error ? err.message : String(err);
    const wrapped = this.fail(detail, detail);
    return new ProviderError(wrapped.message, this.id, { cause: err });
  }
}
