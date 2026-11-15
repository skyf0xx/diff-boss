import { describe, expect, it } from "vitest";
import { diffRows, rowSegments } from "./DiffView";

const PATCH = [
  "diff --git a/f.ts b/f.ts",
  "--- a/f.ts",
  "+++ b/f.ts",
  "@@ -10,3 +10,4 @@ function total()",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " return a;",
  "\\ No newline at end of file",
  "",
].join("\n");

describe("diffRows", () => {
  const rows = diffRows(PATCH);

  it("turns the hunk header into a line number and its function context", () => {
    expect(rows[0]).toEqual({ type: "header", line: 10, context: "function total()" });
  });

  it("strips the sign and numbers old and new lines separately", () => {
    expect(rows.slice(1).map((r) => r.type === "line" && [r.kind, r.oldNo, r.newNo, r.text])).toEqual([
      ["context", 10, 10, "const a = 1;"],
      ["removed", 11, null, "const b = 2;"],
      ["added", null, 11, "const b = 3;"],
      ["added", null, 12, "const c = 4;"],
      ["context", 12, 13, "return a;"],
    ]);
  });

  it("marks only the changed characters of a paired edit", () => {
    const [removed, added, extra] = rows.slice(2) as Extract<(typeof rows)[number], { type: "line" }>[];
    expect(removed.changed).toEqual([10, 11]);
    expect(added.changed).toEqual([10, 11]);
    expect(extra.changed).toBeUndefined();
  });

  it("leaves wholly different lines unmarked", () => {
    const [, removed, added] = diffRows("@@ -1 +1 @@\n-alpha\n+zulu\n") as Extract<(typeof rows)[number], { type: "line" }>[];
    expect(removed.changed).toBeUndefined();
    expect(added.changed).toBeUndefined();
  });
});

describe("syntax highlighting", () => {
  it("splits a TypeScript line into coloured tokens that rebuild the line", () => {
    const rows = diffRows(PATCH);
    const segments = rowSegments(rows, "f.ts");
    const removed = segments[2]!;
    expect(removed.map((s) => s.text).join("")).toBe("const b = 2;");
    expect(removed.length).toBeGreaterThan(1);
    expect(removed[0]!.style).toHaveProperty("--shiki-dark");
  });

  it("renders unknown file types as plain text", () => {
    expect(rowSegments(diffRows(PATCH), "notes.unknownext").every((s) => s === undefined)).toBe(true);
  });
});
