# diff-boss: PRD (compressed)

diff-boss is a VS Code extension. It turns the unstaged changes in a Git working tree into a review plan: conventional-commit stages in reading order, with one plain sentence for each hunk. The developer then stages and commits the plan from inside the editor.

## §3 Glossary

| Term | Meaning |
| --- | --- |
| **Hunk** | One unstaged change from `git diff`: `{ id, file, status, header, patch }`. `status` is `modified`, `added`, `deleted`, `renamed` or `untracked`. The `id` is stable for the hunk's content. |
| **Context** | Optional code around a hunk, keyed by hunk id. |
| **Recent commits** | Recent commit subjects from the repository, used to match its scopes and style. |
| **Plan** | One JSON object: `{ stages: Stage[] }`, 1 to 12 stages in review order (`plan.md`). |
| **Stage** | One conventional commit: `type`, optional `scope`, `description`, and one or more plan hunks. |
| **Plan hunk** | `{ id, summary, needs }`: a hunk's place in the plan, its one-sentence outcome and the ids of hunks that must be applied first. |
| **Problem** | One validator finding, printed as `✗ <field>: <what to change>`. |
| **Provider** | A backend that takes the planning input and returns a plan. The Claude Agent SDK is the first one. |
| **Skill** | The prompt package the provider runs: `SKILL.md` plus `references/PLAN.md`, `STAGES.md` and `WRITING.md`. |
| **Review session** | One run over a working tree: the hunks collected, the accepted plan, and how far the developer has staged and committed. |

Relationships: a review session has one set of hunks and at most one accepted plan. A plan has many stages, and a stage has many plan hunks. Each plan hunk refers to exactly one hunk, and each hunk appears in exactly one stage. A plan hunk's `needs` refers to other plan hunks earlier in the plan. A provider produces plans, and the validator checks them.

## §4 Features

### F1. Collect unstaged hunks

The extension reads the workspace's Git working tree and builds the planning input: every unstaged hunk, context around each hunk and recent commit subjects.

**Consequences (testable)**
- Modified, added, deleted, renamed and untracked files each produce hunks with the matching `status`.
- Each hunk has an id that stays the same between two reads of an unchanged working tree.
- `recentCommits` holds the subjects of the latest commits on the current branch. It is empty on a repository with no commits.
- Changes that are already staged are not reported as hunks.

### F2. Generate a plan through a provider

The extension sends the planning input and the skill to a provider and gets a plan back. The first provider is the Claude Agent SDK. The provider interface lets more backends be added later without changes to the rest of the extension.

**Consequences (testable)**
- The Claude Agent SDK provider returns the model's JSON output as a plan candidate.
- When validation reports problems, the `✗` lines go back to the provider and the full plan is requested again, up to a configured number of attempts.
- When the attempts run out, the session shows the last problems and no plan is accepted.
- A second provider can be registered without any change to the validator, Git or review view code.

**Rules**
- The skill ships inside the extension as `SKILL.md` and `references/`, and the provider loads it from there.
- The Claude Agent SDK provider authenticates through the user's local Claude Code login. The extension asks for no API key and stores none.
- Automated tests use a fake provider. A separate live smoke test runs the real provider against a fixture repository through the local login.
- The extension is not published to the Marketplace before Anthropic approves this login use.

### F3. Validate the plan

The extension checks every plan candidate against `plan.md` and reports each problem as one `✗` line, in the order `plan.md` lists them.

**Consequences (testable)**
- Output that is not one JSON object fails with `✗ json: …`.
- A hunk that is missing, duplicated or not in the input fails with the matching `✗ hunks:` message.
- A bad stage `type`, `scope` or `description`, a header over 72 characters, or a stage with no hunks each fails with the matching `✗ stages[i].…` message.
- A summary over 20 words, or with a Flesch–Kincaid grade above 8, fails with the matching `✗ hunks[<id>].summary:` message.
- A `needs` id that comes later in the plan fails with `✗ hunks[<id>].needs:`.
- The order check applies the hunks in plan order to a scratch copy of the index. A hunk that does not apply fails with `✗ order:`, and the real index is left unchanged.
- A valid plan produces no problems.

### F4. Show the review view

A VS Code panel shows the accepted plan stage by stage, in the layout of the mockup.

**Consequences (testable)**
- Each stage shows its header `type(scope): description`, with its hunks below in plan order.
- Each hunk card shows the file path, the summary sentence and the patch.
- A hunk with `needs` shows "Needs hunk n" labels, numbered by the hunk's final position in the plan.
- "Open file" opens the hunk's file at the hunk's first line.

### F5. Stage, discard and commit from the plan

The developer acts on the plan from the review view. The extension runs the Git commands.

**Consequences (testable)**
- "Stage hunk" adds exactly that hunk to the index, and its card then shows "Staged" with an "Unstage" action.
- "Unstage" removes exactly that hunk from the index.
- "Discard" removes that hunk's change from the working tree after the developer confirms.
- The stage's commit message is pre-filled with its header and can be edited. "Commit" creates one commit from what is staged.
- "Skip" moves to the next stage without committing.

### F6. Launch on command

A developer or an agent starts a review with one command. The extension activates on that command, so it costs nothing until it is used.

**Consequences (testable)**
- The command palette entry "diff-boss: Review unstaged changes" activates the extension and starts a review of the workspace repository.
- Opening the URI `vscode://<publisher>.diff-boss/review` activates the extension and starts the same review. An agent can open it from a terminal with `code --open-url`.
- The URI accepts an optional `path` query parameter that names the repository to review. A path outside the open workspace folders is refused with a message.
- A launch while a review is running brings the open review view to the front instead of starting a second one.
