---
name: diff-boss
description: Open this session's uncommitted changes in diff-boss for review, with the review plan written from this session's own context and no second model call. Use when the user says "diff-boss this", "diff boss it", "open it in diff-boss", "review these changes in diff-boss", or asks to stage and commit the changes this session made as reviewable conventional commits.
---

# Review this session's changes in diff-boss

diff-boss is a VS Code extension that shows unstaged changes as a stage-by-stage review. You know why each change was made, so you write the plan; diff-boss validates it and opens the review. Do not stage, commit or edit any code yourself.

## 1. Ask diff-boss for the hunk index

```bash
REPO=$(git rev-parse --show-toplevel)
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
DIR="$(git rev-parse --absolute-git-dir)/diff-boss"
ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$REPO")
rm -rf "$DIR"
code "$MAIN"   # brings the window that has this repository open to the front; links go to the last active window
sleep 1.5
code --open-url "vscode://diff-boss.diff-boss/prepare?path=$ENC"
for i in $(seq 60); do [ -f "$DIR/hunks.json" ] || [ -f "$DIR/result.json" ] && break; sleep 0.5; done
ls "$DIR"
```

Use `cursor` in place of `code` if the user's editor is Cursor. If neither file appears, ask the user for the diff-boss notification in VS Code:

- "unknown link /prepare": that window runs an older diff-boss. Ask the user to run **Developer: Reload Window** there, then retry.
- "Refusing to review …": the link reached a window without this repository. Ask the user to click into the window that has it open, then retry.
- No notification: an "open this URI" prompt may be waiting for a click. If `result.json` appears instead of `hunks.json`, report its `problems` and stop.

## 2. Read the index and the rules

`hunks.json` has:

- `hunks`: `{ id, file, status, at, firstChange }` for every unstaged hunk. `at` is the `@@` line and `firstChange` the first changed line, so you can tell which of your changes each id is.
- `recentCommits`: recent commit subjects, to match the repository's scopes and style.
- `skill`: the planning skill installed with the extension. Read it and every file in the `references/` directory next to it. These are the rules the validator enforces, and they define the plan's JSON shape.
- `planFile` and `resultFile`: where to write the plan and where the result appears.

Plan from what you already know about the changes. Run `git diff -- <file>` only for a hunk you can't place. Every id in `hunks` goes in the plan exactly once, including hunks you didn't write.

## 3. Write the plan and open the review

Write the plan to `planFile` as one JSON object and nothing else. Then:

```bash
rm -f "$DIR/result.json"
code "$MAIN"; sleep 1.5
code --open-url "vscode://diff-boss.diff-boss/review-plan?path=$ENC"
for i in $(seq 60); do [ -f "$DIR/result.json" ] && break; sleep 0.5; done
cat "$DIR/result.json"
```

- `{ "ok": true, "stages": n }`: the review is open. Tell the user in one line, with the stage headers.
- `{ "ok": false, "problems": [...] }`: each line names what is wrong. Change only what the lines name, rewrite `planFile`, and open the `review-plan` link again. After three failed tries, show the user the last problems and stop.

If the working tree changed since step 1, the problems name unknown or missing ids; start again from step 1.
