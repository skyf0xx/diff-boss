/** Shows the hunk header and body; the file-level diff header is dropped, the card already names the file. */
export function hunkLines(patch: string): string[] {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const start = lines.findIndex((l) => l.startsWith("@@"));
  return start === -1 ? lines : lines.slice(start);
}

function lineClass(line: string): string {
  if (line.startsWith("@@")) return "diff-line diff-hunk-header";
  if (line.startsWith("+")) return "diff-line diff-added";
  if (line.startsWith("-")) return "diff-line diff-removed";
  return "diff-line diff-context";
}

export function DiffView({ patch }: { patch: string }) {
  return (
    <pre className="diff" tabIndex={0}>
      {hunkLines(patch).map((line, i) => (
        <span key={i} className={lineClass(line)}>
          {line === "" ? " " : line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
