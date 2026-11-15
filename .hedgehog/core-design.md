# diff-boss core design

This is an authored core, designed from a compressed intake: the root documents plus one batched round of questions (`.hedgehog/BMAD/00-manifest.md`).

## System shape

diff-boss is a VS Code extension. The extension host collects Git hunks, asks a provider for a plan, validates it and runs Git. A webview renders the review. The extension host is the primary system, and the webview is one layer inside it.

## Stack

VS Code extensions have no row in the stack table, so this stack is a judgment call. It is the ecosystem the target users already work in. The mockup's examples are TypeScript.

- TypeScript, pnpm.
- VS Code Extension API. The host is bundled with esbuild into `dist/extension.js`.
- React and Vite for the webview, built into `dist/webview/`.
- Vitest for unit tests. `@vscode/test-cli` with `@vscode/test-electron` for integration tests in a real VS Code instance.
- `@vscode/vsce` for packaging.
- `@anthropic-ai/claude-agent-sdk` for the first provider.
- zod for the plan and settings schemas.
- The `git` CLI, run as a child process. `git apply --cached` stages and unstages hunks, `git apply -R` discards them, and `GIT_INDEX_FILE` pointed at a temporary copy of the index runs the order check.

### Decisions every layer follows

- **Composition.** Dependencies are passed in through constructors. `src/extension/activate.ts` is the only composition root: it constructs the Git adapter, the provider registry, the validator and the planner, and hands them to the panel.
- **Error model.** Expected failures are returned as values: validator problems are `Problem[]`, and a hunk that does not apply is `{ ok: false, reason }`. Unexpected failures are thrown as typed errors (`GitCommandError`, `ProviderError`). The extension layer turns thrown errors into VS Code messages.
- **Config and secrets.** Settings live under `diffBoss.*` (`provider`, `model`, `maxAttempts`), are declared in `package.json` `contributes.configuration`, and are read through a zod schema. No secrets are stored. The Claude Agent SDK provider authenticates through the user's local Claude Code login, with no API key.
- **Entrypoint.** `dist/extension.js` exports `activate` and `deactivate`. Activation events are `onCommand:diffBoss.review` and `onUri`, so the extension loads only when a review is requested.

## Layers

The layers were derived directly from the PRD, with ideas taken from the browser-extension blueprint (a typed message contract between separate runtimes) and the bot/agent blueprint (decision logic kept behind a provider interface).

| # | Layer | Owns | Why it sits here |
| --- | --- | --- | --- |
| 1 | `contract` | `Hunk`, `Plan`, `Stage`, `PlanHunk` and `Problem` types and zod schemas; the `Provider`, `GitPort` and `ScratchIndex` interfaces; the host ↔ webview message types | Every other layer builds against these. It pins the plan format of `plan.md` and the message protocol before anything uses them. |
| 2 | `git` | Hunk collection with stable ids (a hash of path, header and patch), context, recent commits; stage, unstage, discard, commit; scratch-index apply | The riskiest external boundary. Untracked files, renames and the order check all have to work before a plan means anything. |
| 3 | `plan` | The validator for every check in `plan.md`, in that order, including Flesch–Kincaid grade and the order check through `ScratchIndex`; the planner loop that calls a `Provider`, feeds `✗` lines back and stops after `maxAttempts` | The domain. It imports only `contract`, so it is tested with a fake provider and a fake index. |
| 4 | `provider` | The Claude Agent SDK adapter, a provider registry keyed by id, and the shipped skill (`skill/SKILL.md`, `skill/references/PLAN.md`, `STAGES.md`, `WRITING.md`) | An adapter behind the `Provider` interface. Adding a provider later is a new file here plus a registry entry. The skill lives here because only the provider reads it. |
| 5 | `webview` | The review view from the mockup: stages, hunk cards, "Needs hunk n" labels, stage, unstage, discard, open file, commit message, commit and skip | Talks to the host only through `contract` messages, because the webview is a separate runtime and a direct import fails at runtime. |
| 6 | `extension` | Activation, the `diffBoss.review` command, the URI handler for `vscode://<publisher>.diff-boss/review?path=<repo>`, the webview panel, wiring, message handling, Open file, settings and `package.json` contributions | Composes every earlier layer. It is the only layer that imports `vscode`. |
| 7 | `package` | README, CHANGELOG, LICENSE, `.vscodeignore`, and `scripts/check-vsix.mjs`, which checks that the built `.vsix` contains `dist/extension.js`, `dist/webview/` and `skill/` | Last, because it packages the finished extension. |

Every layer's tests sit inside its own scope. Every verify command runs its layer's tests first, then the whole unit suite and the typecheck, so a later layer cannot break an earlier one and still pass. `verify_radius` declares that wider read.

## Module axis

There is no module axis. diff-boss is built once, front to back, and its features do not each walk the same layers. The graph has one task per layer, and the PRD is mined as a single intent, `diff-boss`.

## Pattern

`hexagonal`. `plan` is the domain, and it depends only on `contract`. `git` and `provider` are adapters that implement `contract` interfaces, and `extension` composes them. Nothing in `plan` may import `git`, `providers`, `extension` or `vscode`.

## Source material

- The `provider` layer builds `skill/` from the drafts in `.hedgehog/BMAD/brief/` (`skill.md`, `plan.md`, `stages.md`, `writing.md`). It fixes their differences there: file names become `SKILL.md` and `references/PLAN.md`, `STAGES.md` and `WRITING.md`; the reading grade is "aim for 7, the limit is 8" everywhere; the worked example's style header matches the mockup.
- The `webview` layer follows `.hedgehog/BMAD/brief/Review view (stages).pdf` and `05-ux-spec/EXPERIENCE.md`.

## Fan-in files

- **`package.json`** is owned by the `extension` layer, because `contributes` (commands, activation events, URI handler, settings) is extension wiring. Bootstrap installs every dependency named above up front, so earlier layers do not need to edit `package.json`. A later dependency addition goes through `hedgehog-authored-loop`'s narrow out-of-scope commit.
- **The provider registry** (`src/providers/registry.ts`) receives one entry for each new provider.

## Publishing

No layer publishes. The `package` layer builds and checks the `.vsix` and stops there. Publishing with `vsce publish` is a manual step outside the graph. It waits for Anthropic to approve the extension's use of the local Claude Code login.

Nothing is reached through an arbitrator, so there is no reachability layer.

## Testing the real provider

Automated verify commands use a fake provider, so they need no network and no login. `pnpm smoke:live` runs the Claude Agent SDK provider against a fixture repository through the developer's local Claude Code login. It is a manual check and is not part of any layer's verify.

## Open points

- Whether "Discard" should be blocked, or should warn, when later hunks in the plan need the discarded hunk. The PRD requires a confirmation and does not say more.
- How the planner should handle a working tree that changes during a review. The current design rereads the hunks before every Git action and asks the developer to rerun the review if they changed.
