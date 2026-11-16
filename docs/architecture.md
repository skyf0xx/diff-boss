# diff-boss architecture

## System shape

diff-boss is a VS Code extension. The agent session that made the changes writes a plan file and opens the extension's URI. The extension host collects Git hunks, resolves and validates the plan, and runs Git. A webview renders the review. The extension makes no model calls.

## Stack

- TypeScript, pnpm.
- VS Code Extension API. The host is bundled with esbuild into `dist/extension.js`.
- React and Vite for the webview, built into `dist/webview/`. Shiki colours code in the diff view.
- Vitest for unit tests. `@vscode/test-cli` with `@vscode/test-electron` for integration tests in a real VS Code instance.
- `@vscode/vsce` for packaging.
- zod for the plan and message schemas.
- The `git` CLI, run as a child process. `git apply --cached` stages and unstages hunks, `git apply -R` discards them, and `GIT_INDEX_FILE` pointed at a temporary copy of the index runs the order check.

## Modules

| Directory | Owns | Depends on |
| --- | --- | --- |
| `src/contract` | `Hunk`, `Plan`, `ResolvedStage` and `Problem` types and zod schemas; the `GitPort` and `ScratchIndex` interfaces; the host ↔ webview message types | nothing |
| `src/git` | Hunk collection with stable ids (a hash of path, header and patch), recent commits; stage, unstage, discard, commit; scratch-index apply | `contract` |
| `src/plan` | The validator: resolves `path` and `path#n` keys to hunks, checks headers, runs the order check through `ScratchIndex`, and grades summaries | `contract` |
| `agent-skill/` | The Claude Code skill a session follows to write the plan and open the review | — |
| `webview/` | The review view: stages, hunk cards, stage, unstage, discard, open file, commit message, commit and skip | `contract` (messages only) |
| `src/extension` | Activation, the `/review` URI handler, the plan and result files, the webview panel and wiring | everything above; the only module that imports `vscode` |

The pattern is hexagonal. `plan` is the domain and depends only on `contract`. `git` is an adapter that implements `contract` interfaces, and `extension` composes them. Nothing in `plan` imports `git`, `extension` or `vscode`. The webview is a separate runtime, so it talks to the host only through `contract` messages; a direct import fails at runtime.

## Decisions every module follows

- **Composition.** Dependencies are passed in through constructors. `src/extension/activate.ts` is the only composition root.
- **Error model.** Expected failures are returned as values: validator problems are `Problem[]`, and a hunk that does not apply is `{ ok: false, reason }`. Unexpected failures are thrown as typed errors (`GitCommandError`). The extension turns thrown errors into VS Code messages.
- **Config and secrets.** There are no settings and no secrets. `package.json` contributes nothing.
- **Entrypoint.** `dist/extension.js` exports `activate` and `deactivate`. The only activation event is `onUri`, so the extension loads only when a session opens a review.
- **Tests.** Each module's unit tests sit next to its code. Integration tests in `src/extension/test/` run in a real VS Code instance against temporary repositories with a written plan file.

## Agent handoff

1. The session writes `<git-dir>/diff-boss/plan.json` and deletes any old `result.json`.
2. It opens `vscode://diff-boss.diff-boss/review?path=<repo>`. diff-boss collects the hunks, resolves the plan's file keys to them, validates it and opens the review. It writes `result.json`: `{ "ok": true, "stages": n }`, or `{ "ok": false, "problems": [...] }` with the validator's `✗` lines. On failure the session fixes the plan and opens the link again. "Rerun review" in the view rereads `plan.json`.

If a review is already open for the same repository, the link rereads the plan in it; a review open for another repository is closed first. `result.json` is written through a temp file and a rename, so a session polling for it never reads a partial file.

`<git-dir>` is the repository's `.git` directory, so the files never show up as working-tree changes. The plan names files, not hunk ids, so the session needs nothing from diff-boss before writing it.

## Packaging

`.vscodeignore` is an allowlist: `package.json`, `dist/extension.js`, `dist/webview/`, README, CHANGELOG and LICENSE. `scripts/check-vsix.mjs` checks the built `.vsix` contains those and nothing from `src/`, `test/`, `docs/` or `node_modules/`. Publishing with `vsce publish` is a manual step.

## Open points

- How to handle a working tree that changes during a review. The current design checks each hunk before every Git action and asks the developer to rerun the review if it no longer applies.
