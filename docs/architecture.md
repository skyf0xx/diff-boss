# diff-boss architecture

## System shape

diff-boss is a VS Code extension. The extension host collects Git hunks, gets a plan, validates it and runs Git. A webview renders the review. The extension host is the primary system, and the webview is a separate runtime inside it.

A plan comes from one of two sources:

- **A provider.** The extension sends the hunks to a model (the Claude Agent SDK provider) and retries with the validator's problems until the plan passes or `diffBoss.maxAttempts` runs out.
- **An agent session.** The session that wrote the changes asks diff-boss for the hunk index, writes the plan itself, and opens the review with it. No model call is made by the extension. See [Agent handoff](#agent-handoff).

Both paths go through the same validator.

## Stack

- TypeScript, pnpm.
- VS Code Extension API. The host is bundled with esbuild into `dist/extension.js`.
- React and Vite for the webview, built into `dist/webview/`. Shiki colours code in the diff view.
- Vitest for unit tests. `@vscode/test-cli` with `@vscode/test-electron` for integration tests in a real VS Code instance.
- `@vscode/vsce` for packaging.
- `@anthropic-ai/claude-agent-sdk` for the first provider.
- zod for the plan and settings schemas.
- The `git` CLI, run as a child process. `git apply --cached` stages and unstages hunks, `git apply -R` discards them, and `GIT_INDEX_FILE` pointed at a temporary copy of the index runs the order check.

## Modules

| Directory | Owns | Depends on |
| --- | --- | --- |
| `src/contract` | `Hunk`, `Plan`, `Stage`, `PlanHunk` and `Problem` types and zod schemas; the `Provider`, `GitPort` and `ScratchIndex` interfaces; the host ↔ webview message types | nothing |
| `src/git` | Hunk collection with stable ids (a hash of path, header and patch), context, recent commits; stage, unstage, discard, commit; scratch-index apply | `contract` |
| `src/plan` | The validator for every check in `skill/references/PLAN.md`, including Flesch–Kincaid grade and the order check through `ScratchIndex`; the planner loop that calls a `Provider`, feeds `✗` lines back and stops after `maxAttempts` | `contract` |
| `src/providers` | The Claude Agent SDK adapter and a provider registry keyed by id | `contract` |
| `skill/` | The planning skill every planner follows, whether a provider or an agent session | — |
| `agent-skill/` | The Claude Code skill that runs the agent handoff from a session | — |
| `webview/` | The review view: stages, hunk cards, "Needs hunk n" labels, stage, unstage, discard, open file, commit message, commit and skip | `contract` (messages only) |
| `src/extension` | Activation, the `diffBoss.review` command, the URI handler (`/review`, `/prepare`, `/review-plan`), the agent handoff files, the webview panel, wiring, settings and `package.json` contributions | everything above; the only module that imports `vscode` |

The pattern is hexagonal. `plan` is the domain and depends only on `contract`. `git` and `providers` are adapters that implement `contract` interfaces, and `extension` composes them. Nothing in `plan` imports `git`, `providers`, `extension` or `vscode`. The webview is a separate runtime, so it talks to the host only through `contract` messages; a direct import fails at runtime.

## Decisions every module follows

- **Composition.** Dependencies are passed in through constructors. `src/extension/activate.ts` is the only composition root.
- **Error model.** Expected failures are returned as values: validator problems are `Problem[]`, and a hunk that does not apply is `{ ok: false, reason }`. Unexpected failures are thrown as typed errors (`GitCommandError`, `ProviderError`). The extension turns thrown errors into VS Code messages.
- **Config and secrets.** Settings live under `diffBoss.*` (`provider`, `model`, `maxAttempts`), are declared in `package.json` `contributes.configuration`, and are read through a zod schema. No secrets are stored. The Claude provider authenticates through the user's local Claude Code login, with no API key.
- **Entrypoint.** `dist/extension.js` exports `activate` and `deactivate`. Activation events are `onCommand:diffBoss.review` and `onUri`, so the extension loads only when a review is requested.
- **Tests.** Each module's unit tests sit next to its code. Integration tests in `src/extension/test/` run in a real VS Code instance with a fake provider, so they need no network and no login. `pnpm smoke:live` runs the real Claude provider against a fixture repository; it is a manual check.

## Agent handoff

An agent session that made the changes can plan the review itself:

1. It opens `vscode://diff-boss.diff-boss/prepare?path=<repo>`. diff-boss writes `<git-dir>/diff-boss/hunks.json`: each hunk's id, file, status, `@@` line and first changed line, without patch bodies, plus recent commit subjects and the path of the installed planning skill. It also deletes any old `plan.json` and `result.json`.
2. It writes a plan that follows that skill to `<git-dir>/diff-boss/plan.json`.
3. It opens `vscode://diff-boss.diff-boss/review-plan?path=<repo>`. diff-boss validates the plan and opens the review with no model call, then writes `result.json`: `{ "ok": true, "stages": n }`, or `{ "ok": false, "problems": [...] }` with the validator's `✗` lines. On failure the session fixes the plan and opens the link again. "Rerun review" in the view rereads `plan.json`.

If a review is already open for the same repository, `review-plan` switches it to the session's plan; a review open for another repository is closed first. Files are written through a temp file and a rename, so a session polling for them never reads a partial file. If `prepare` fails, it writes the error to `result.json`.

`<git-dir>` is the repository's `.git` directory, so the files never show up as working-tree changes. The hunk ids are hashes of the exact diff diff-boss reads, which is why the session reads them from `hunks.json` instead of computing them. If the working tree changes between `prepare` and `review`, the validator reports the unknown or missing ids.

`agent-skill/SKILL.md` is the Claude Code skill that runs these steps. Install it by copying it to `~/.claude/skills/diff-boss/SKILL.md`.

## Packaging

`.vscodeignore` is an allowlist: `package.json`, `dist/extension.js`, `dist/webview/`, `skill/`, README, CHANGELOG and LICENSE. `scripts/check-vsix.mjs` checks the built `.vsix` contains those and nothing from `src/`, `test/`, `docs/` or `node_modules/`. Publishing with `vsce publish` is a manual step.

## Open points

- Whether "Discard" should be blocked, or should warn, when later hunks in the plan need the discarded hunk. The current behaviour asks for confirmation.
- How to handle a working tree that changes during a review. The current design rereads the hunks before every Git action and asks the developer to rerun the review if they changed.
