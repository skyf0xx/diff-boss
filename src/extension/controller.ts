import { GitCommandError } from "../contract/ports";
import type { GitPort, ScratchIndex } from "../contract/ports";
import type { Hunk } from "../contract/hunk";
import { WebviewToHostSchema } from "../contract/messages";
import type { HostToWebview, ReviewState } from "../contract/messages";
import type { Problem } from "../contract/problem";
import { buildReviewState, validatePlan } from "../plan";
import { firstNewLine } from "./hunk-location";

export interface ControllerHost {
  post(message: HostToWebview): void;
  showError(message: string): void;
  openFile(absolutePath: string, line: number): Promise<void>;
}

/** A plan written by someone else, such as the agent session that made the changes. */
export interface PlanSource {
  readPlan(): Promise<string>;
  report(result: { ok: true; stages: number } | { ok: false; problems: readonly Problem[] }): Promise<void>;
}

export interface ControllerDeps {
  git: GitPort;
  repoRoot(): Promise<string>;
  scratchIndex: ScratchIndex;
  host: ControllerHost;
  planSource: PlanSource;
}

type View = Exclude<HostToWebview, { type: "stale" | "confirmDiscard" }>;

function describe(err: unknown): string {
  if (err instanceof GitCommandError) return `Git failed: ${err.stderr.trim() || err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export class ReviewController {
  private view: View = { type: "loading" };
  private stale = false;
  private state: ReviewState | undefined;
  /** Hunks from the planning read; actions use their stored patches, never a fresh collect. */
  private hunks = new Map<string, Hunk>();
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private pendingDiscard: string | undefined;

  constructor(private readonly deps: ControllerDeps) {}

  /** Starts a fresh session; any run still in flight is abandoned. */
  start(): Promise<void> {
    const run = ++this.generation;
    this.state = undefined;
    this.pendingDiscard = undefined;
    this.hunks = new Map();
    this.stale = false;
    this.emitView({ type: "loading" });
    return this.enqueue(() => this.plan(run));
  }

  /** Resolves when every queued run or action has finished. */
  idle(): Promise<void> {
    return this.queue;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
  }

  /** Validates a raw webview message and handles it. */
  handleMessage(raw: unknown): Promise<void> {
    const parsed = WebviewToHostSchema.safeParse(raw);
    if (!parsed.success) return Promise.resolve();
    const msg = parsed.data;
    switch (msg.type) {
      case "ready":
        this.sendCurrent();
        return Promise.resolve();
      case "rerun":
        return this.start();
      case "stageHunk":
        return this.enqueueAction(() => this.stageOrUnstage(msg.hunkId, "stage"));
      case "unstageHunk":
        return this.enqueueAction(() => this.stageOrUnstage(msg.hunkId, "unstage"));
      case "requestDiscard":
        return this.enqueueAction(async () => this.requestDiscard(msg.hunkId));
      case "confirmDiscard":
        return this.enqueue(() => this.discard(msg.hunkId));
      case "openFile":
        return this.enqueueAction(() => this.openFile(msg.hunkId));
      case "commit":
        return this.enqueueAction(() => this.commit(msg.stageIndex, msg.message));
      case "skip":
        return this.enqueueAction(async () => this.skip(msg.stageIndex));
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task).catch((err: unknown) => this.actionFailed(err));
    this.queue = next;
    return next;
  }

  /** Any action other than confirming a discard withdraws a pending discard request. */
  private enqueueAction(task: () => Promise<void>): Promise<void> {
    return this.enqueue(() => {
      this.pendingDiscard = undefined;
      return task();
    });
  }

  private post(message: HostToWebview): void {
    if (!this.disposed) this.deps.host.post(message);
  }

  private emitView(view: View): void {
    this.view = view;
    this.post(view);
    if (this.stale) this.post({ type: "stale" });
  }

  private sendCurrent(): void {
    this.post(this.view);
    if (this.stale) this.post({ type: "stale" });
  }

  private emitState(): void {
    if (this.state) this.emitView({ type: "review", state: this.state });
  }

  private async plan(run: number): Promise<void> {
    const source = this.deps.planSource;
    try {
      const outcome = await this.validateFrom(source);
      if (run !== this.generation) return;
      if (!outcome.result.ok) {
        await source.report({ ok: false, problems: outcome.result.problems });
        this.emitView({ type: "failed", problems: outcome.result.problems });
        return;
      }
      const { stages, warnings } = outcome.result;
      this.hunks = new Map(outcome.input.hunks.map((h) => [h.id, h]));
      this.state = buildReviewState(stages, outcome.input.hunks, warnings);
      await source.report({ ok: true, stages: stages.length });
      this.emitState();
    } catch (err) {
      if (run !== this.generation) return;
      const message = describe(err);
      const problems = [{ field: "review", message }];
      await source.report({ ok: false, problems }).catch(() => {});
      this.emitView({ type: "failed", problems });
      this.deps.host.showError(`diff-boss: ${message}`);
    }
  }

  private async validateFrom(source: PlanSource) {
    const input = await this.deps.git.collect();
    const raw = await source.readPlan();
    const validation = await validatePlan(raw, input, this.deps.scratchIndex);
    const result = validation.stages
      ? { ok: true as const, stages: validation.stages, warnings: validation.warnings }
      : { ok: false as const, problems: validation.problems };
    return { input, result };
  }

  /** Errors from an action leave the review as it was and tell the developer. */
  private actionFailed(err: unknown): void {
    this.deps.host.showError(`diff-boss: ${describe(err)}`);
    this.emitState();
  }

  private hunkFor(hunkId: string): Hunk | undefined {
    return this.hunks.get(hunkId);
  }

  private setStaged(hunkId: string, staged: boolean): void {
    if (!this.state) return;
    for (const stage of this.state.stages) {
      for (const h of stage.hunks) if (h.id === hunkId) h.staged = staged;
    }
  }

  private async stageOrUnstage(hunkId: string, action: "stage" | "unstage"): Promise<void> {
    const hunk = this.hunkFor(hunkId);
    if (!hunk || this.stale) return;
    if (!(await this.applies(hunk, action))) return;
    if (action === "stage") await this.deps.git.stage(hunk);
    else await this.deps.git.unstage(hunk);
    this.setStaged(hunkId, action === "stage");
    this.emitState();
  }

  private async applies(hunk: Hunk, action: "stage" | "unstage" | "discard"): Promise<boolean> {
    const check = await this.deps.git.checkApplies(hunk, action);
    if (check.ok) return true;
    this.stale = true;
    this.post({ type: "stale" });
    return false;
  }

  private requestDiscard(hunkId: string): void {
    if (!this.state || !this.hunkFor(hunkId) || this.stale) return;
    if (this.isStaged(hunkId)) {
      this.deps.host.showError("diff-boss: unstage this hunk before discarding it");
      return;
    }
    this.pendingDiscard = hunkId;
    this.post({ type: "confirmDiscard", hunkId });
  }

  private isStaged(hunkId: string): boolean {
    return (this.state?.stages ?? []).some((s) => s.hunks.some((h) => h.id === hunkId && h.staged));
  }

  private async discard(hunkId: string): Promise<void> {
    const pending = this.pendingDiscard;
    this.pendingDiscard = undefined;
    const hunk = this.hunkFor(hunkId);
    if (pending !== hunkId || !hunk || !this.state || this.stale) return;
    if (this.isStaged(hunkId)) {
      this.deps.host.showError("diff-boss: unstage this hunk before discarding it");
      return;
    }
    if (!(await this.applies(hunk, "discard"))) return;
    await this.deps.git.discard(hunk);
    // The change is gone from the tree, so the card goes; numbers stay as planned.
    for (const stage of this.state.stages) stage.hunks = stage.hunks.filter((h) => h.id !== hunkId);
    this.hunks.delete(hunkId);
    this.emitState();
  }

  private async openFile(hunkId: string): Promise<void> {
    const hunk = this.hunkFor(hunkId);
    if (!hunk) return;
    const root = await this.deps.repoRoot();
    await this.deps.host.openFile(`${root}/${hunk.file}`, firstNewLine(hunk.patch));
  }

  private async commit(stageIndex: number, message: string): Promise<void> {
    const state = this.state;
    const stage = state?.stages[stageIndex];
    if (!state || !stage || this.stale) return;
    if (stageIndex !== state.currentStage || stage.committed) return;
    await this.deps.git.commit(message);
    stage.committed = true;
    stage.commitMessage = message;
    state.currentStage = Math.min(stageIndex + 1, state.stages.length);
    this.emitState();
  }

  private skip(stageIndex: number): void {
    const state = this.state;
    const stage = state?.stages[stageIndex];
    if (!state || !stage || this.stale) return;
    if (stageIndex !== state.currentStage || stage.committed) return;
    state.currentStage = Math.min(stageIndex + 1, state.stages.length);
    this.emitState();
  }
}
