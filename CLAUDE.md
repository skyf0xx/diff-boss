# diff-boss

diff-boss is a VS Code extension for developers who review unstaged changes, often ones an AI agent wrote. The agent session that wrote the changes plans them as conventional-commit stages and opens the extension's `vscode://` URI; diff-boss validates the plan and shows a stage-by-stage review view where each hunk can be staged, discarded and committed. The extension makes no model calls and has no commands or settings.

Read [docs/architecture.md](docs/architecture.md) for the module boundaries, stack and the agent handoff. Product intent is in [docs/product/](docs/product/).

## Commands

```bash
pnpm test                     # unit tests (src/ and webview/)
pnpm typecheck
pnpm build                    # extension host + webview into dist/
pnpm test:integration         # builds, then runs tests in a real VS Code
pnpm package                  # builds diff-boss.vsix
node scripts/check-vsix.mjs   # checks the .vsix contents
code --install-extension diff-boss.vsix --force   # install locally, then Reload Window
cp agent-skill/SKILL.md ~/.claude/skills/diff-boss/SKILL.md   # install the session skill
```

## Rules

- **Module boundaries.** `src/plan` imports only `src/contract`. Only `src/extension` imports `vscode`. The webview talks to the host only through the message types in `src/contract/messages.ts`.
- **Tests.** Each change comes with tests next to the code it changes. Run `pnpm test` and `pnpm typecheck` before calling work done; run `pnpm test:integration` when `src/extension` or `package.json` changes.
- **The validator is the gate.** Every plan, whatever wrote it, goes through `src/plan/validate.ts`. Don't loosen a check to make a plan pass; fix the session's instructions in `agent-skill/SKILL.md` instead. Keep that skill short: every line costs tokens on every run.
- **Dependencies.** Ask before adding one. Pin new versions that are at least two weeks old.
- **Comments.** Follow the `code-comment-discipline` skill: no comment unless the code can't say it.
- **Docs.** `CLAUDE.md`, `docs/` and `README.md` describe the project as it is now, not how it got there. Follow the `no-history-in-output` skill on every edit; history belongs in commits and `CHANGELOG.md`.
- **Commits.** Conventional Commits, one logical change per commit, only when asked.
