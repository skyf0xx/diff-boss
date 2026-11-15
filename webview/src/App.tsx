import { useCallback, useEffect, useState } from "react";
import {
  HostToWebviewSchema,
  STALE_MESSAGE,
  formatProblems,
  type Problem,
  type ReviewState,
  type WebviewToHost,
} from "../../src/contract";
import type { PendingDiscard } from "./HunkCard";
import { StageSection } from "./StageSection";
import type { VsCodeApi } from "./vscode";

type View =
  | { kind: "loading" }
  | { kind: "generating"; attempt: number; maxAttempts: number }
  | { kind: "failed"; problems: Problem[] }
  | { kind: "review"; state: ReviewState };

/** Seconds since this element mounted, so a long attempt visibly keeps counting. */
function Elapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="elapsed">{Math.floor((now - start) / 1000)} s</span>;
}

export function App({ api }: { api: VsCodeApi }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [stale, setStale] = useState(false);
  const [discard, setDiscard] = useState<PendingDiscard | undefined>();

  const post = useCallback((m: WebviewToHost) => api.postMessage(m), [api]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const parsed = HostToWebviewSchema.safeParse(event.data);
      if (!parsed.success) return;
      const msg = parsed.data;
      switch (msg.type) {
        case "stale":
          setStale(true);
          setDiscard(undefined);
          return;
        case "confirmDiscard":
          setDiscard({ hunkId: msg.hunkId, dependents: msg.dependents });
          return;
        case "review":
          setView({ kind: "review", state: msg.state });
          break;
        case "failed":
          setView({ kind: "failed", problems: msg.problems });
          break;
        case "generating":
          setView({ kind: "generating", attempt: msg.attempt, maxAttempts: msg.maxAttempts });
          break;
        case "loading":
          setView({ kind: "loading" });
          break;
      }
      setStale(false);
      setDiscard(undefined);
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [api]);

  const rerun = () => post({ type: "rerun" });

  return (
    <main className="app">
      <h1>Review unstaged changes</h1>
      {stale && (
        <div className="banner" role="alert">
          <span>{STALE_MESSAGE}</span>
          <button type="button" onClick={rerun}>
            Rerun review
          </button>
        </div>
      )}
      {view.kind === "loading" && <p role="status">Collecting changes…</p>}
      {view.kind === "generating" && (
        <p role="status">
          Generating plan: attempt {view.attempt} of {view.maxAttempts} ·{" "}
          <Elapsed key={view.attempt} />
        </p>
      )}
      {view.kind === "failed" && (
        <section className="failed" aria-label="Plan failed">
          <p>The plan could not be validated.</p>
          <ul className="problems">
            {formatProblems(view.problems).map((line, i) => (
              <li key={i}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
          <button type="button" onClick={rerun}>
            Rerun review
          </button>
        </section>
      )}
      {view.kind === "review" &&
        view.state.stages.map((stage, i) => (
          <StageSection
            key={`${i}:${stage.header}:${stage.commitMessage}`}
            stage={stage}
            index={i}
            current={i === view.state.currentStage}
            disabled={stale}
            pendingDiscard={discard}
            onStage={(hunkId) => post({ type: "stageHunk", hunkId })}
            onUnstage={(hunkId) => post({ type: "unstageHunk", hunkId })}
            onRequestDiscard={(hunkId) => post({ type: "requestDiscard", hunkId })}
            onConfirmDiscard={(hunkId) => {
              setDiscard(undefined);
              post({ type: "confirmDiscard", hunkId });
            }}
            onCancelDiscard={() => setDiscard(undefined)}
            onOpenFile={(hunkId) => post({ type: "openFile", hunkId })}
            onCommit={(stageIndex, message) => post({ type: "commit", stageIndex, message })}
            onSkip={(stageIndex) => post({ type: "skip", stageIndex })}
          />
        ))}
    </main>
  );
}
