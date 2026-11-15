import { createHash } from "node:crypto";
import type { Hunk, HunkStatus } from "../contract/hunk";

function filePathOf(header: string): string {
  const lines = header.split("\n");
  const find = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);
  const clean = (p: string) => p.replace(/\t$/, "");

  const renamed = find("rename to ");
  if (renamed) return clean(renamed);
  const plus = find("+++ ");
  if (plus && plus !== "/dev/null" && plus.startsWith("b/")) return clean(plus.slice(2));
  const minus = find("--- ");
  if (minus && minus !== "/dev/null" && minus.startsWith("a/")) return clean(minus.slice(2));
  const m = /^diff --git a\/(.+) b\/\1$/.exec(lines[0] ?? "");
  if (m?.[1]) return m[1];
  throw new Error(`Cannot determine file path from diff header: ${lines[0] ?? ""}`);
}

function statusOf(header: string): HunkStatus {
  if (/^rename from /m.test(header)) return "renamed";
  if (/^new file mode /m.test(header)) return "added";
  if (/^deleted file mode /m.test(header)) return "deleted";
  return "modified";
}

export function hunkId(file: string, header: string, body: string): string {
  return createHash("sha1").update([file, header, body].join("\0")).digest("hex").slice(0, 10);
}

/**
 * Splits `git diff` output into one Hunk per `@@` hunk. Each patch is the file
 * header plus that hunk, so it applies on its own. A file change with no `@@`
 * (pure rename, mode change, empty file, binary) becomes one header-only hunk.
 */
export function parseDiff(text: string, forcedStatus?: HunkStatus): Hunk[] {
  const hunks: Hunk[] = [];
  for (const chunk of text.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith("diff --git ")) continue;
    const at = chunk.search(/^@@ /m);
    const header = at === -1 ? chunk : chunk.slice(0, at);
    const bodies = at === -1 ? [""] : chunk.slice(at).split(/^(?=@@ )/m);
    const file = filePathOf(header);
    const status = forcedStatus ?? statusOf(header);
    for (const body of bodies) {
      const normalized = body === "" || body.endsWith("\n") ? body : `${body}\n`;
      hunks.push({
        id: hunkId(file, header, normalized),
        file,
        status,
        header,
        patch: header + normalized,
      });
    }
  }
  return hunks;
}
