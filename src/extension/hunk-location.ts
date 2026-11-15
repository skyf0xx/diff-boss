/** First new-side line of the first `@@ -a,b +c,d @@` header in a hunk patch; at least 1. */
export function firstNewLine(patch: string): number {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m.exec(patch);
  const line = m ? Number(m[1]) : 1;
  return Math.max(1, line);
}
