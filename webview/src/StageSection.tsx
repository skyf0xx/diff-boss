import { useState } from "react";
import type { ReviewStage } from "../../src/contract";
import { HunkCard, type PendingDiscard } from "./HunkCard";

export function commitType(header: string): string | undefined {
  return /^([a-z]+)[(!:]/i.exec(header)?.[1];
}

interface Props {
  stage: ReviewStage;
  index: number;
  current: boolean;
  disabled: boolean;
  pendingDiscard: PendingDiscard | undefined;
  onStage(id: string): void;
  onUnstage(id: string): void;
  onRequestDiscard(id: string): void;
  onConfirmDiscard(id: string): void;
  onCancelDiscard(): void;
  onOpenFile(id: string): void;
  onCommit(index: number, message: string): void;
  onSkip(index: number): void;
}

export function StageSection({ stage, index, current, disabled, onCommit, onSkip, ...card }: Props) {
  const [message, setMessage] = useState(stage.commitMessage);
  const type = commitType(stage.header);
  const fieldId = `commit-message-${index}`;
  const cls = ["stage", current ? "stage-current" : "", stage.committed ? "stage-done" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls} aria-label={`Stage ${index + 1}: ${stage.header}`} aria-current={current ? "step" : undefined}>
      <h2 className="stage-header">
        <code>{stage.header}</code>
        {stage.committed && <span className="badge">✓ Committed</span>}
        {current && !stage.committed && <span className="badge">Current</span>}
      </h2>
      {stage.hunks.map((hunk) => (
        <HunkCard key={hunk.id} hunk={hunk} disabled={disabled || stage.committed} {...card} />
      ))}
      {!stage.committed && (
        <div className="commit-row">
          <label htmlFor={fieldId}>Commit message</label>
          <input
            id={fieldId}
            type="text"
            value={message}
            disabled={disabled}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="actions">
            <button
              type="button"
              disabled={disabled || !current}
              onClick={() => onCommit(index, message)}
            >
              {type ? `Commit ${type}` : "Commit"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled || !current}
              onClick={() => onSkip(index)}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
