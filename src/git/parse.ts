import { createHash } from "node:crypto";
import type { Hunk, HunkStatus } from "../contract/hunk";

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Decodes git's C-style quoted path (`"we\"ird"`); an unquoted path is returned as is. */
export function unquotePath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = inner[i + 1] ?? "";
    const octal = /^[0-7]{1,3}/.exec(inner.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += octal[0].length;
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next]!);
      i += 1;
    } else {
      bytes.push(...Buffer.from(ch, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const DIFF_GIT_QUOTED = new RegExp(`^diff --git (${QUOTED}|a/.*?) (${QUOTED}|b/.*)$`);

function filePathOf(header: string): string {
  const lines = header.split("\n");
  const find = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length);
  const clean = (p: string) => unquotePath(p.replace(/\t$/, ""));

  const renamed = find("rename to ");
  if (renamed) return clean(renamed);
  const plus = find("+++ ");
  if (plus && plus !== "/dev/null") {
    const p = clean(plus);
    if (p.startsWith("b/")) return p.slice(2);
  }
  const minus = find("--- ");
  if (minus && minus !== "/dev/null") {
    const p = clean(minus);
    if (p.startsWith("a/")) return p.slice(2);
  }
  const first = lines[0] ?? "";
  const m = /^diff --git a\/(.+) b\/\1$/.exec(first);
  if (m?.[1]) return m[1];
  const q = DIFF_GIT_QUOTED.exec(first);
  if (q) {
    const a = unquotePath(q[1]!);
    const b = unquotePath(q[2]!);
    if (a.startsWith("a/") && b.startsWith("b/") && a.slice(2) === b.slice(2)) return b.slice(2);
  }
  throw new Error(`Cannot determine file path from diff header: ${first}`);
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
