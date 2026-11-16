import type { ReviewHunk } from "../../src/contract";
import { DiffView } from "./DiffView";

export interface PendingDiscard {
  hunkId: string;
}

interface Props {
  hunk: ReviewHunk;
  disabled: boolean;
  pendingDiscard: PendingDiscard | undefined;
  onStage(id: string): void;
  onUnstage(id: string): void;
  onRequestDiscard(id: string): void;
  onConfirmDiscard(id: string): void;
  onCancelDiscard(): void;
  onOpenFile(id: string): void;
}

export function HunkCard({ hunk, disabled, pendingDiscard, ...on }: Props) {
  const confirming = pendingDiscard?.hunkId === hunk.id ? pendingDiscard : undefined;
  return (
    <article className="card" aria-label={`Hunk ${hunk.number}: ${hunk.file}`}>
      <header className="card-header">
        <span className="card-number">{hunk.number}</span>
        <span className="card-file">{hunk.file}</span>
        <span className="card-status">{hunk.status}</span>
      </header>
      {hunk.summary && <p className="card-summary">{hunk.summary}</p>}
      {hunk.readabilityGrade !== undefined && (
        <p className="readability" title="Reading grade above 8. The summary may use long or uncommon words.">
          Hard to read · grade {hunk.readabilityGrade.toFixed(1)}
        </p>
      )}
      <DiffView patch={hunk.patch} file={hunk.file} />
      <div className="actions">
        {hunk.staged ? (
          <>
            <span className="staged-label">✓ Staged</span>
            <button type="button" disabled={disabled} onClick={() => on.onUnstage(hunk.id)}>
              Unstage
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={disabled} onClick={() => on.onStage(hunk.id)}>
              Stage hunk
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => on.onRequestDiscard(hunk.id)}
            >
              Discard
            </button>
          </>
        )}
        <button
          type="button"
          className="link"
          disabled={disabled}
          onClick={() => on.onOpenFile(hunk.id)}
        >
          Open file ↗
        </button>
      </div>
      {confirming && (
        <div className="confirm" role="alertdialog" aria-label={`Confirm discard of hunk ${hunk.number}`}>
          <p>Discard this hunk? Its change is removed from the working tree.</p>
          <button type="button" disabled={disabled} onClick={() => on.onConfirmDiscard(hunk.id)}>
            Confirm discard
          </button>
          <button type="button" className="secondary" onClick={on.onCancelDiscard}>
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}
