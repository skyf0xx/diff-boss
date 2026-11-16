# Changelog

## 0.2.0

- The agent session is the only planner. The Claude Agent SDK provider, its settings and the `diffBoss.review` command are gone; the extension activates only on its URI.
- One link, `vscode://diff-boss.diff-boss/review?path=<repo>`, replaces `/prepare` and `/review-plan`. There is no hunk index.
- The plan is `{ stages: [{ header, files }] }`. A `files` key is a path, which claims the file's remaining hunks, or `path#n`, which claims one hunk; the value is the summary. Unclaimed hunks go to a final `chore: unplanned changes` stage.
- Summaries are optional and no longer limited in length. `needs`, "Needs hunk n" labels and the discard dependents warning are removed.
- The planning skill and its references no longer ship in the extension; `agent-skill/SKILL.md` holds the few rules a session needs.

## 0.1.0

- Diff view with old and new line numbers, a coloured change bar in place of `+`/`-`, changed-word highlights and syntax colouring.
- Agent handoff: `vscode://diff-boss.diff-boss/prepare?path=<repo>` writes a hunk index, the agent session writes the plan, and `vscode://diff-boss.diff-boss/review-plan?path=<repo>` validates it and opens the review with no provider call. `agent-skill/SKILL.md` is the Claude Code skill that runs it.

## 0.0.0 (unreleased)

- Collects unstaged Git hunks (modified, added, deleted, renamed and untracked files) with ids that stay the same while the working tree is unchanged.
- Asks a provider for a plan of conventional-commit stages in reading order, with one plain sentence per hunk.
- Validates every plan (hunk coverage, stage headers, summary length, `needs` order, and a scratch-index apply check) and sends the problems back to the provider, up to `diffBoss.maxAttempts` times.
- A summary above reading grade 8 no longer rejects the plan; its card shows a "Hard to read" marker instead.
- Claude Agent SDK provider that uses the local Claude Code login. No API key.
- Provider registry, so a second provider can be added without touching the validator, Git or the review view.
- Review view with stages, hunk cards, "Needs hunk n" labels, Stage, Unstage, Discard (with a dependents warning), Open file, an editable commit message, Commit and Skip.
- "Files changed since this plan was made" banner with Rerun review when the working tree drifts.
- Command `diff-boss: Review unstaged changes` and the `vscode://diff-boss.diff-boss/review?path=<repo>` URI handler.
- Settings `diffBoss.provider`, `diffBoss.model` and `diffBoss.maxAttempts`.
- `pnpm smoke:live` live check and `pnpm package` to build a `.vsix`.
