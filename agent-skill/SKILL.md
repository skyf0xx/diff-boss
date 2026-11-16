---
name: diff-boss
description: Open this session's unstaged changes in diff-boss as reviewable conventional-commit stages, planned from this session's own context. Use when the user says "diff-boss this", "diff boss it", "run diff boss" or "open it in diff-boss".
---

Plan the changes from what you already know, then run the script once. Don't stage, commit or edit code.

Plan: `{"stages":[{"header":"type(scope): description","files":{"path":"summary"}}]}`

- One stage per commit. Types: feat fix refactor perf test docs style build ci chore. Header ≤72 chars, lowercase, imperative; reuse the repo's scopes.
- A `files` key is a repo-relative path (all its hunks not listed elsewhere) or `path#n` (its n-th hunk; `git diff -U0 <path> | grep ^@@` to count). Unlisted hunks land in a final `chore: unplanned changes` stage.
- Summary: one plain sentence on what is different now, about grade 7, no motive the code doesn't show. `""` for none.
- Order: prep (refactor, build, chore) → behaviour → tests → docs → style. Within a stage, definitions before uses; keep a change and its test together.

Run it with your plan in place of `PLAN`:

```bash
D="$(git rev-parse --absolute-git-dir)/diff-boss"; mkdir -p "$D"; rm -f "$D/result.json"
cat > "$D/plan.json" <<'JSON'
PLAN
JSON
code "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"; sleep 1.5
code --open-url "vscode://diff-boss.diff-boss/review?path=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$(git rev-parse --show-toplevel)")"
for i in $(seq 60); do [ -f "$D/result.json" ] && break; sleep 0.5; done; cat "$D/result.json"
```

- `{"ok":true,…}`: tell the user in one line, with the stage headers.
- `{"ok":false,"problems":[…]}`: fix what each `✗` line names and run again. After three tries, show the problems.
- No output: ask the user for the diff-boss notice in VS Code. "unknown link" means the window needs **Developer: Reload Window**; "Refusing to review" means the wrong window got the link; otherwise an "open this URI" prompt is waiting.

Use `cursor` in place of `code` in Cursor.
