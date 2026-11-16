# diff-boss: PRD (compressed)

diff-boss is a VS Code extension. The agent session that wrote a set of unstaged changes plans them as conventional-commit stages in reading order, with a plain sentence for each change. diff-boss checks the plan and the developer stages and commits it from inside the editor.

## §3 Glossary

| Term | Meaning |
| --- | --- |
| **Hunk** | One unstaged change from `git diff`: `{ id, file, status, header, patch }`. `status` is `modified`, `added`, `deleted`, `renamed` or `untracked`. |
| **Plan** | `{ stages: [{ header, files }] }`, written by the agent session to `<git-dir>/diff-boss/plan.json`. |
| **Stage** | One conventional commit: a `type(scope): description` header and the files or hunks it claims. |
| **File key** | A key in a stage's `files`. `path` claims every hunk of the file not claimed elsewhere; `path#n` claims the file's n-th hunk. Its value is the summary, which may be empty. |
| **Problem** | One validator finding, printed as `✗ <field>: <what to change>`. |
| **Review session** | One run over a working tree: the hunks collected, the accepted plan, and how far the developer has staged and committed. |

## §4 Features

### F1. Collect unstaged hunks

**Consequences (testable)**
- Modified, added, deleted, renamed and untracked files each produce hunks with the matching `status`.
- Each hunk has an id that stays the same between two reads of an unchanged working tree.
- Changes that are already staged are not reported as hunks.

### F2. Resolve and validate the plan

**Consequences (testable)**
- Output that is not `{ stages: [{ header, files }] }` fails with `✗ json: …`.
- A header that is not `type(scope): description` with a known type, or is over 72 characters, fails with `✗ stages[i].header: …`.
- A key naming a file with no unstaged changes, a hunk number past the file's last hunk, a hunk listed twice or a whole file listed twice fails with `✗ stages[i].files: …`.
- `path#n` keys claim their hunk first; a `path` key then takes the file's remaining hunks.
- Hunks no key claims go to a final `chore: unplanned changes` stage. A stage left with no hunks is dropped.
- The order check applies the hunks in plan order to a scratch copy of the index. A hunk that does not apply fails with `✗ order:`, and the real index is left unchanged.
- A summary above Flesch–Kincaid grade 8 is accepted and marked "Hard to read".

### F3. Show the review view

**Consequences (testable)**
- Each stage shows its header, with its hunks below in plan order.
- Each hunk card shows the file path, its summary when there is one, and the patch.
- "Open file" opens the hunk's file at the hunk's first line.

### F4. Stage, discard and commit from the plan

**Consequences (testable)**
- "Stage hunk" adds exactly that hunk to the index, and its card then shows "Staged" with an "Unstage" action.
- "Unstage" removes exactly that hunk from the index.
- "Discard" removes that hunk's change from the working tree after the developer confirms.
- The stage's commit message is pre-filled with its header and can be edited. "Commit" creates one commit from what is staged.
- "Skip" moves to the next stage without committing.

### F5. Launch from an agent session

**Consequences (testable)**
- The extension contributes no commands or settings and activates only on its URI.
- Opening `vscode://diff-boss.diff-boss/review?path=<repo>` reads `plan.json`, validates it, opens the review and writes `result.json`: `{ ok: true, stages }` or `{ ok: false, problems }`.
- A path outside the open workspace folders is refused with a message.
- A launch while a review of the same repository is open rereads the plan in that view.
