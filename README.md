# diff-boss

diff-boss is a VS Code extension for reviewing unstaged Git changes that an AI agent wrote. The agent session that made the changes plans them as conventional-commit stages, with a plain sentence for each change. diff-boss checks the plan and shows a review view where you stage, discard and commit each stage.

It is not published to the Marketplace. Install it from a `.vsix` you build yourself.

## Requirements

- VS Code 1.90 or later.
- `git` on your PATH.
- An agent that can run shell commands, such as Claude Code.

## Install

```sh
pnpm install
pnpm package
code --install-extension diff-boss.vsix --force
cp agent-skill/SKILL.md ~/.claude/skills/diff-boss/SKILL.md
```

Then run **Developer: Reload Window** in VS Code.

## Start a review

In the Claude Code session that made the changes, say "diff-boss this". The session writes its plan to `.git/diff-boss/plan.json` and opens:

```sh
code --open-url "vscode://diff-boss.diff-boss/review?path=/abs/repo"
```

diff-boss validates the plan, opens the review and writes `.git/diff-boss/result.json`: `{ "ok": true, "stages": n }`, or `{ "ok": false, "problems": [...] }` with one `✗` line per problem for the session to fix. The path must be inside a folder open in VS Code. The first time, VS Code asks whether to let diff-boss open the link.

The plan:

```json
{"stages":[
  {"header":"feat(send): show a price chart","files":{
    "src/chart.ts":"The send screen now draws the token's 30-day price.",
    "src/send.tsx#2":"The chart now sits under the amount field."
  }}
]}
```

- A `path` key claims every hunk of that file that no other key claims. A `path#n` key claims the file's n-th hunk.
- The value is the hunk's summary. It may be empty.
- Hunks no key claims go to a final `chore: unplanned changes` stage.

## The review view

- Each stage shows its header, with its hunks below. Each card shows the file, its summary and the patch. A summary above reading grade 8 shows a **Hard to read** marker.
- **Stage** and **Unstage** add or remove exactly that hunk from the index. **Discard** removes it from the working tree after you confirm. **Open file** opens the file at the hunk.
- Each stage's commit message starts as its header and can be edited. **Commit** commits what is staged. **Skip** moves on without committing.
- If a file changes after the plan was made, actions are refused and the view shows **Files changed since this plan was made** with **Rerun review**, which rereads the plan.

Only unstaged changes are reviewed.

## Development

```sh
pnpm build             # bundle the host (dist/extension.js) and the webview (dist/webview/)
pnpm test              # unit tests (vitest)
pnpm test:integration  # tests inside a real VS Code instance
pnpm package           # build and write diff-boss.vsix
node scripts/check-vsix.mjs   # check the .vsix contents
```

## License

MIT. See `LICENSE`.
