# diff-boss

diff-boss is a VS Code extension for developers who review unstaged changes, often ones an AI agent wrote. It sends the working tree's hunks to a model provider (the Claude Agent SDK first), validates the returned plan of conventional-commit stages, and shows a stage-by-stage review view where each hunk can be staged, discarded and committed. A developer or an agent starts it from the command palette or the extension's `vscode://` URI.

This project is built with **Hedgehog**: a one-step-at-a-time build
discipline. The rules below aren't project preferences — they're how the
build stays mechanically correct. Follow them exactly.

## How to work here

The build is a loop of small, gated, committed steps. You never hold the
whole plan in context — the plan lives in the structure:

- **The build graph** (`.hedgehog/hedgehog.db`) is the live source of
  truth for what's next. Query it via `hedgehog status`/`hedgehog ready`
  at the start of every session — never re-derive state from prose.
- **The commit log** is the record of what's built and why. Conventional
  commits are how progress is read, not a conversation summary.
- **The architecture is fixed and opinionated for this project's core**
  — the same on every Hedgehog project running that core. Where a piece
  lives, what it may depend on, the build order: all of it is inferable
  from this file and the skills *without reading a line of code*. You
  don't discover the patterns; you already know them.
- **The codebase carries the project-specific instances** — what's
  actually been built, what a given piece's shape is, what's already
  wired. That, you re-read from the code when you need it, rather than
  remembering it.

Because state lives in those places and not in the conversation, a fresh
context loses nothing: the architecture is known a priori, and the
project's specifics are re-read on demand. The `hedgehog-orchestrating`
skill (see **Running the build** below) is what uses that.

**Use only the skills and agents this repo provides**, including its
vendored BMAD shelf — never a general-purpose build-tool skill pack
(e.g. "superpowers") or another project's agent set. Hedgehog's
enforcement (scope boundaries, no self-certification, the commit-gated
loop) is what a generic skill pack has no notion of, and running one
alongside Hedgehog's own skills produces work that bypasses the very
discipline this file describes.

**Build through the loop, including when the work looks too small to need
it.** A task that seems like a quick edit is not a reason to skip the
graph, the step sequence, or the gate — scope grows, and the shortcut is
what turns a small change into debt the next step has to work around.
Don't propose going around the discipline to save a step, and don't treat
a user's impatience as license to: say what the loop's next step is and
take it. Where a rule genuinely conflicts with what the user is asking
for, name the conflict and let them decide — never resolve it by quietly
taking the faster path. When nothing is in flight, `hedgehog-daily`
decides whether a change goes through the loop.

<!-- hedgehog:core-section start -->

## This project's core: authored

This project's core was designed for it by `hedgehog-core-design` at
planning intake, rather than taken from a shipped core. The layer
sequence, the stack, and each layer's file scope and verification live in
two files, and both are locked:

- **`.hedgehog/core.yaml`** — the design authority: `id`, the layer
  order, and per layer its `scope` globs, `verify` command, and commit
  message. `hedgehog plan` compiled the build graph from this.
- **`.hedgehog/core-design.md`** — the rationale: the system shape (what
  this project fundamentally is), the stack and why it was chosen, a line
  per layer on what it owns and why it sits where it does, and the
  module-axis decision.

Read `core-design.md` to know what this project is and what each layer
owns.

**The packet is what actually runs**, not `core.yaml` directly, once
`hedgehog plan` has compiled a task — see `hedgehog-authored-loop`'s
"core.yaml vs. the packet" for the reconciliation mechanic (DRIFT,
`--recompile`) when the two disagree; that skill is the source, not
restated here. Changing either locked file re-shapes every task the
graph compiles *from then on* — a `planner` decision through the
Correction Protocol, never a quiet edit.

### The skills — invoke these, don't improvise

- **`hedgehog-authored-loop`** — every unit of work once bootstrapped:
  `hedgehog claim` reserves the packet for one ready layer (`hedgehog
  next` previews it read-only, without reserving), `layer-eng` builds
  it, `hedgehog verify` gates and commits it. Also holds the Correction
  Protocol and this core's Stop Condition. Invoke it at the start of any
  build session and for "what's next".
- **`conventional-commits`** — when a change spans several layers in one
  working-tree pass and needs splitting back into per-layer commits
  (mainly Correction Protocol cleanups).

### The agents — delegate the judgment calls

`layer-eng` builds one layer per `hedgehog claim`ed packet, working from
the packet's ALLOWED SCOPE and `core-design.md`'s description of what
that layer owns. Reports the work done; never commits it. See
`hedgehog-authored-loop` for exactly which agent runs which part of the
loop, including the Layer Transition Checks' use of `reviewer` and the
Stop Condition's handoff to `tweaker` — that skill is the source, not
restated here.

## The constants (do not deviate)

### Stack (locked)

Named in `.hedgehog/core-design.md`'s stack record — language, package
manager, framework(s), test runner — and realized in the workspace
`hedgehog-bootstrap-authored-core` generated. The stack was chosen
deliberately for this project's system shape; a felt need for a new
library is worth surfacing before adding it, since it usually belongs to
the layer's design rather than to a build step.

### Layout

The layer `scope` globs in `.hedgehog/core.yaml` define where each
layer's code lives — that file is the layout, and it's enforced:
`hedgehog verify` rejects a task that writes outside its own scope.

```text
.hedgehog/
  hedgehog.db         the build graph — intents, compiled tasks, verifications, committed to git
  core.yaml           this core's layer sequence, scope, verification, commit messages — locked
  core-design.md      the design rationale behind core.yaml — write-once, from planner
  BMAD/               vendored BMAD-METHOD shelf's raw output (brief, PR-FAQ, PRD, UX spec, research) —
                       write-once, from planner
```

### Core rules

- **One layer, one commit**, in the exact message `.hedgehog/core.yaml`
  names for that layer.
- **Sequential through the chain.** A layer starts once the one before it
  passes its own verification — `hedgehog next` enforces this.
- **A layer owns one artifact**, reached through the interface
  `core-design.md` named — that boundary is what makes the layer
  independently verifiable.
- **The layer's own `verify` command gates every commit.** Never weaken
  it to clear a gate; a layer whose command passes with no tests
  certifies nothing.
- **Fix wrong layers at the source** via the Correction Protocol — never
  a downstream workaround.
- **The layer sequence itself is locked.** Changing `.hedgehog/core.yaml`
  or `.hedgehog/core-design.md` is a `planner` decision, not a quiet
  edit.

<!-- hedgehog:core-section end -->

## Running the build

The build graph is the source of truth for what's next — never re-derive
build state from prose. The `hedgehog-orchestrating` skill owns the claim →
dispatch → verify cycle, the intent check, debt and decision recording, the
Friction log, the Correction Protocol, the Stop Condition and post-build
handoff, and the context boundaries to clear at. Read it at the start of
every session and follow it.

## Delegating on this host

The agents in `.claude/agents/` are registered automatically — delegate to
one by name (`backend-eng`, `reviewer`, and so on) and it runs in its own
context with its own tool grant. The skills in `.claude/skills/` are
available the same way; invoke one by name rather than reimplementing what
it describes.

Clear context with `/clear` at the unit boundaries the
`hedgehog-orchestrating` skill states.
