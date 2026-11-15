# Description

Turn a set of unstaged Git hunks into a review plan: conventional-commit stages in a fixed reading order, each hunk with a one-sentence outcome. Use whenever you are given hunks from `git diff` and asked to organise, order, summarise or stage them for review, even if the request doesn't mention commits or stages.

## Plan a review of unstaged changes

A developer has unstaged changes, often written by an AI agent. You turn them into a review plan. The plan splits the hunks into stages, each one a conventional commit, and puts the stages and the hunks in the order that makes the change easiest to understand. The developer reads the plan from top to bottom, stages each hunk and commits each stage.

You return one JSON object. The app around you validates it, shows it, and runs the Git commands.

## Input

The app gives you:

- `hunks`: a list of `{ id, file, status, header, patch }`. `id` is stable. `status` is `modified`, `added`, `deleted`, `renamed` or `untracked`. `patch` is the unified diff of that hunk with its surrounding lines.
- `context`: optional extra code around a hunk, keyed by id.
- `recentCommits`: recent commit subjects from the repository, used to match its scopes and style.

Work only from this input. The patch is the evidence for every statement you make.

## Output

Return only the JSON object described in `references/PLAN.md`. Add no prose, no code fences and no keys that file does not list.

## Process

### 1. Read every hunk

Decide what each hunk does when the code runs, from the patch and its context. Note which hunks depend on another: a call to a new function depends on the hunk that adds it, a test depends on the code it tests.

Done when you can say, for every hunk, what behaviour it changes or confirms.

### 2. Assign each hunk to one stage

A stage is a set of hunks that a reviewer could commit together under one conventional commit message. Read `references/STAGES.md` for the types, how to split, and how to order.

- Put each hunk in exactly one stage.
- Keep a change and its tests in the same stage.
- Use few stages. Most diffs need one to four. Use one when the change is one thing.
- Make each stage stand alone: its hunks apply cleanly after the earlier stages, and the code it leaves behind is consistent.

Done when every hunk id from the input is in a stage once.

### 3. Order the stages and the hunks

Follow the ordering rules in `references/STAGES.md`. Inside a stage, put the hunks in the order a reader needs them: definitions before uses.

For each hunk, list in `needs` the ids of earlier hunks it depends on. Leave it empty when none.

Done when no hunk appears before a hunk it needs.

### 4. Write the messages and sentences

For each stage write `type`, optional `scope` and `description`, as `references/STAGES.md` describes. For each hunk write one summary sentence, as `references/WRITING.md` describes.

Done when every stage has a commit header that fits 72 characters and every hunk has one plain sentence about its outcome.

### 5. Check before you return

- Every input hunk id appears once, and no other id appears.
- Every `needs` id is earlier in the order.
- Every stage type is in the list in `references/STAGES.md`.
- Every summary is one sentence about an outcome, in plain words.
- Nothing in a summary or a message goes beyond what the patch shows.

## When the purpose is unclear

State what the code does and leave the reason out. Choose the closest type that makes no claim about intent: `style` for whitespace and formatting, `chore` for housekeeping, `refactor` for restructuring with the same behaviour. Place a hunk like this in the last stage, or with the hunks it clearly belongs with.

Write only what the patch supports. A summary says what is different now; it names a motive only when the code or a comment states it.

## When the validator rejects the plan

The app may reply with lines that start with `✗`. Each line names a field and what to change. Fix every line and return the whole plan again. `references/PLAN.md` lists the messages.

## Quality bar

- A short plan that is right is better than a long plan with padding.
- Each stage header reads like a commit a maintainer would accept.
- A reviewer can follow the stages in order without jumping around.
