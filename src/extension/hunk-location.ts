/** First new-side line of a `@@ -a,b +c,d @@` header; at least 1. */
export function firstNewLine(header: string): number {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  const line = m ? Number(m[1]) : 1;
  return Math.max(1, line);
}
