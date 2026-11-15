<!-- Planning intake archive. Process adapted from BMAD-METHOD (bmad-code-org/BMAD-METHOD, MIT). -->

# Planning intake manifest

- **Source:** BMAD-METHOD, https://github.com/bmad-code-org/BMAD-METHOD, tag `v6.12.2`, commit `10db8f35bba515e4fbf0388c5bd59a6cc7a3e9c8`
- **Mode:** compressed
- **Date:** 2026-11-15
- **Core:** authored

## Brief

The user's brief is the set of documents kept in `.hedgehog/BMAD/brief/`:

- `skill.md`: the model prompt that turns unstaged hunks into a review plan.
- `stages.md`: stage types, how to split stages and how to order them.
- `writing.md`: rules for the sentence on each hunk.
- `plan.md`: the plan JSON contract and the validator's messages.
- `Review view (stages).pdf`: a mockup of the review view.

## Batched round

| Question | Answer |
| --- | --- |
| Where does the review view live? | A VS Code extension. |
| How does the app call the model? | Claude Agent SDK, behind a provider interface. Other backends can be added later, preferably ones that use a login the user already has instead of an API key. |
| Any hard constraint on stack? | None. Core design picks it. |
| Who is it for? | Public release to other developers. |
| How does the Claude provider authenticate? | The user's local Claude Code login, with no API key, in development and tests. Marketplace publishing waits for Anthropic's approval of that use. |
| How is it launched? | On command: from the command palette, or by an agent opening the extension's `vscode://` URI. |

## Inferred from the brief without asking

- Input, plan format, validator checks and messages: `plan.md`.
- Stage rules and the model's process: `stages.md`, `skill.md`, `writing.md`.
- The review flow (stage by stage, per-hunk actions, "Needs hunk n" labels, commit or skip a stage): the mockup.

## Files

| File | Status |
| --- | --- |
| `04-prd.md` | Written: §3 Glossary and §4 Features only. |
| `05-ux-spec/EXPERIENCE.md` | Written: the flows the mockup shows. |
| `01-brainstorming.md` | Not run. |
| `brief/` | The user's source documents, kept as written. |
| `02-brief.md` | Not run. `brief/` is the brief. |
| `03-prfaq.md` | Not run. |
| `05-ux-spec/DESIGN.md` | Not run. The mockup sets the layout. The brief sets no visual identity beyond VS Code's theme. |
| `06-research.md` | Not run. |
