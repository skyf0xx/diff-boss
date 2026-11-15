# diff-boss: experience

Source: `Review view (stages).pdf`.

## Review view

- The title is "Review unstaged changes".
- Stages are listed top to bottom in plan order. Each one starts with its commit header, for example `feat(balance): validate token ids`.
- Under each stage, its hunk cards are listed in plan order. A card shows:
  - the file path, for example `src/balance/validation.ts`,
  - the summary sentence,
  - the hunk header and the patch, with added and removed lines,
  - actions: **Stage hunk** and **Discard**, or **✓ Staged** and **Unstage** once staged, plus **Open file ↗**,
  - a **Needs hunk n** label when the hunk has dependencies.
- Each stage ends with a **Commit message** field and **Commit \<type\>** and **Skip** buttons.

## Flow

1. The developer runs "diff-boss: Review unstaged changes", or an agent opens `vscode://<publisher>.diff-boss/review?path=<repo>`.
2. The extension collects the hunks, generates a plan and validates it, retrying on problems.
3. The review view opens with the accepted plan.
4. Stage by stage, the developer stages hunks (or discards them), reviews the commit message and commits or skips the stage.
