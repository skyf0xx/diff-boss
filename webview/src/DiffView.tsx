import { useMemo, type ReactNode } from "react";
import { highlightLines, type Segment } from "./highlight";

/** Shows the hunk header and body; the file-level diff header is dropped, the card already names the file. */
export function hunkLines(patch: string): string[] {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const start = lines.findIndex((l) => l.startsWith("@@"));
  return start === -1 ? lines : lines.slice(start);
}

type Kind = "added" | "removed" | "context";

export type DiffRow =
  | { type: "header"; line: number | null; context: string }
  | { type: "line"; kind: Kind; oldNo: number | null; newNo: number | null; text: string; changed?: [number, number] };

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

export function diffRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of hunkLines(patch)) {
    if (raw.startsWith("@@")) {
      const m = HEADER.exec(raw);
      oldNo = m ? Number(m[1]) : 0;
      newNo = m ? Number(m[2]) : 0;
      rows.push({ type: "header", line: m ? newNo : null, context: m ? m[3].trim() : raw });
      continue;
    }
    if (raw.startsWith("\\")) continue;
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") rows.push({ type: "line", kind: "added", oldNo: null, newNo: newNo++, text });
    else if (sign === "-") rows.push({ type: "line", kind: "removed", oldNo: oldNo++, newNo: null, text });
    else rows.push({ type: "line", kind: "context", oldNo: oldNo++, newNo: newNo++, text });
  }
  markChangedWords(rows);
  return rows;
}

/** Pairs each removed run with the added run after it and marks the span between their common prefix and suffix. */
function markChangedWords(rows: DiffRow[]): void {
  let i = 0;
  while (i < rows.length) {
    const removed = run(rows, i, "removed");
    const added = run(rows, i + removed.length, "added");
    if (removed.length === 0 || added.length === 0) {
      i += Math.max(1, removed.length);
      continue;
    }
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      const spans = changedSpans(removed[k].text, added[k].text);
      if (spans) [removed[k].changed, added[k].changed] = spans;
    }
    i += removed.length + added.length;
  }
}

type LineRow = Extract<DiffRow, { type: "line" }>;

function run(rows: DiffRow[], from: number, kind: Kind): LineRow[] {
  const out: LineRow[] = [];
  for (let j = from; j < rows.length; j++) {
    const r = rows[j];
    if (r.type !== "line" || r.kind !== kind) break;
    out.push(r);
  }
  return out;
}

function changedSpans(a: string, b: string): [[number, number], [number, number]] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const shared = pre + suf;
  // A line that shares almost nothing reads better as a whole-line change than as one giant highlight.
  if (shared === 0 || shared < Math.min(a.length, b.length) * 0.3) return null;
  return [
    [pre, a.length - suf],
    [pre, b.length - suf],
  ];
}

/** Per-row token segments: old side (context + removed) and new side (context + added) are each one stream. */
export function rowSegments(rows: readonly DiffRow[], file: string): (Segment[] | undefined)[] {
  const out: (Segment[] | undefined)[] = rows.map(() => undefined);
  for (const side of ["old", "new"] as const) {
    const skip: Kind = side === "old" ? "added" : "removed";
    const idx: number[] = [];
    rows.forEach((r, i) => {
      if (r.type === "line" && r.kind !== skip) idx.push(i);
    });
    const lines = idx.map((i) => (rows[i] as LineRow).text);
    const tokens = highlightLines(lines, file);
    if (!tokens) continue;
    idx.forEach((rowIndex, k) => {
      const row = rows[rowIndex] as LineRow;
      if (side === "old" && row.kind === "context") return;
      out[rowIndex] = tokens[k];
    });
  }
  return out;
}

function code(text: string, segments: Segment[] | undefined, changed?: [number, number]): ReactNode {
  if (text === "") return " ";
  const parts = segments ?? [{ text }];
  const [from, to] = changed && changed[0] !== changed[1] ? changed : [-1, -1];
  const out: ReactNode[] = [];
  let pos = 0;
  parts.forEach((seg, s) => {
    const end = pos + seg.text.length;
    const cuts = [pos, ...[from, to].filter((c) => c > pos && c < end), end];
    for (let c = 0; c < cuts.length - 1; c++) {
      const piece = seg.text.slice(cuts[c]! - pos, cuts[c + 1]! - pos);
      const inWord = cuts[c]! >= from && cuts[c + 1]! <= to;
      const key = `${s}-${c}`;
      if (!seg.style && !inWord) out.push(piece);
      else
        out.push(
          <span key={key} className={inWord ? "diff-word" : undefined} style={seg.style}>
            {piece}
          </span>,
        );
    }
    pos = end;
  });
  return out;
}

const SR_LABEL: Record<Kind, string> = { added: "added: ", removed: "removed: ", context: "" };

export function DiffView({ patch, file }: { patch: string; file: string }) {
  const rows = useMemo(() => diffRows(patch), [patch]);
  const segments = useMemo(() => rowSegments(rows, file), [rows, file]);
  return (
    <div className="diff" tabIndex={0}>
      {rows.map((row, i) =>
        row.type === "header" ? (
          <div key={i} className="diff-hunk-header">
            {row.line !== null && <span className="diff-hunk-line">Line {row.line}</span>}
            {row.context && <span className="diff-hunk-context">{row.context}</span>}
          </div>
        ) : (
          <div key={i} className={`diff-line diff-${row.kind}`}>
            <span className="diff-no" aria-hidden="true">{row.oldNo ?? ""}</span>
            <span className="diff-no" aria-hidden="true">{row.newNo ?? ""}</span>
            <span className="diff-bar" aria-hidden="true" />
            <span className="diff-code">
              {SR_LABEL[row.kind] && <span className="sr-only">{SR_LABEL[row.kind]}</span>}
              {code(row.text, segments[i], row.changed)}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
