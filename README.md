# diff-boss

diff-boss is a VS Code extension for reviewing your unstaged Git changes. It reads the hunks, asks a model to group them into conventional-commit stages in reading order with one plain sentence per hunk, checks the plan, and then lets you stage, discard and commit each stage from one review view.

It is not published to the Marketplace. Install it from a `.vsix` you build yourself (see Development).

## Requirements

- VS Code 1.90 or later.
- `git` on your PATH.
- Claude Code installed and signed in. The extension uses your local Claude Code login. It asks for no API key and stores none.

## Install

```sh
pnpm install
pnpm package
code --install-extension diff-boss.vsix
```

## Start a review

- In VS Code, open the command palette and run **diff-boss: Review unstaged changes**. It reviews the repository in the workspace.
- Or open a URI. An agent or script can run:

  ```sh
  code --open-url "vscode://diff-boss.diff-boss/review?path=/abs/repo"
  ```

  Note for agents: use an absolute path to the repository. The path must be inside a folder that is open in VS Code, or the request is refused. Leave `?path=...` out to use the workspace repository. If a review is already running, the open review view is brought to the front instead of starting another.

Only unstaged changes are reviewed. Changes that are already staged are not shown.

## The review flow

1. diff-boss collects the unstaged hunks and asks the provider for a plan. If the plan fails validation, the problems go back to the provider and the plan is requested again, up to `diffBoss.maxAttempts` times. If the attempts run out, the view shows the last problems and no plan is accepted.
2. The view shows the plan as stages. Each stage has a header, `type(scope): description`, with its hunks below in plan order.
3. Each hunk card shows the file path, a one-sentence summary and the patch. A hunk that depends on earlier hunks shows **Needs hunk n** labels, numbered by position in the plan. **Open file** opens the file at the hunk's first line.
4. Per hunk:
   - **Stage** adds exactly that hunk to the index. The card then shows Staged with an **Unstage** action.
   - **Unstage** removes exactly that hunk from the index.
   - **Discard** removes that hunk's change from the working tree after you confirm. If later hunks need it, the confirmation names them, for example "Hunks 4 and 6 need this hunk". Discard is never blocked.
5. Per stage, the commit message is pre-filled with the stage header and can be edited. **Commit** creates one commit from what is staged. **Skip** moves to the next stage without committing.

If a file changes after the plan was made and a hunk no longer applies, the action is refused and the view shows **Files changed since this plan was made** with a **Rerun review** button. Actions stay disabled until the rerun finishes.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `diffBoss.provider` | `claude` | Plan provider. Only `claude` exists today. |
| `diffBoss.model` | `sonnet` | Model the provider asks for, for example `sonnet` or `opus`. |
| `diffBoss.maxAttempts` | `3` | How many times the plan is requested before the view shows the last problems. Range 1 to 10. |

## Development

```sh
pnpm build             # bundle the host (dist/extension.js) and the webview (dist/webview/)
pnpm test              # unit tests (vitest)
pnpm test:integration  # tests inside a real VS Code instance
pnpm smoke:live        # real provider against a fixture repo, through your Claude Code login
pnpm package           # build and write diff-boss.vsix
node scripts/check-vsix.mjs   # check the .vsix contents
```

Automated tests use a fake provider. `pnpm smoke:live` is manual and needs a signed-in Claude Code.

## License

MIT. See `LICENSE`.
