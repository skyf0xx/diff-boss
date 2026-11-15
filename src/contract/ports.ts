import type { Hunk, PlanningInput } from "./hunk";
import type { Problem } from "./problem";

export class GitCommandError extends Error {
  override readonly name = "GitCommandError";
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  constructor(
    message: string,
    readonly providerId: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Expected failure returned as a value; unexpected ones are thrown as typed errors. */
export type ApplyResult = { ok: true } | { ok: false; reason: string };

export type HunkApplyResult = { id: string } & ApplyResult;

export type HunkAction = "stage" | "unstage" | "discard";

export interface Skill {
  body: string;
  references: Record<string, string>;
}

export interface Provider {
  readonly id: string;
  /** Returns raw model text. Parsing and validation belong to the plan layer. */
  generatePlan(
    input: PlanningInput,
    skill: Skill,
    previousProblems?: readonly Problem[],
  ): Promise<string>;
}

export interface ProviderRegistry {
  register(provider: Provider): void;
  get(id: string): Provider | undefined;
  list(): string[];
}

export interface ScratchIndex {
  /**
   * Applies the hunks in the given order to a scratch copy of the index and
   * reports one result per input hunk, in order. A hunk that fails does not
   * stop later hunks from being tried. The real index is never changed.
   */
  apply(hunks: readonly Hunk[]): Promise<HunkApplyResult[]>;
}

export interface GitPort {
  collect(): Promise<PlanningInput>;
  recentCommits(limit?: number): Promise<string[]>;
  /** Checks that the action's `git apply --check` would succeed now. */
  checkApplies(hunk: Hunk, action: HunkAction): Promise<ApplyResult>;
  stage(hunk: Hunk): Promise<void>;
  unstage(hunk: Hunk): Promise<void>;
  discard(hunk: Hunk): Promise<void>;
  /** Creates one commit from what is staged. */
  commit(message: string): Promise<void>;
}
