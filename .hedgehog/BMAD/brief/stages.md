# Stages

Each stage is one conventional commit: `type(scope): description`.

## Types

| Type | Use it for |
| --- | --- |
| `feat` | New behaviour that users or callers can see. |
| `fix` | A bug fix. |
| `refactor` | Restructuring with the same behaviour. |
| `perf` | A speed or memory improvement with the same behaviour. |
| `test` | Changes that only touch tests. |
| `docs` | Changes that only touch documentation or comments. |
| `style` | Whitespace, formatting, naming of locals. No change in behaviour. |
| `build` | Build scripts, dependencies, packaging. |
| `ci` | Continuous integration configuration. |
| `chore` | Housekeeping that fits no other type. |

Add `!` after the type or scope (`feat(api)!:`) when a stage changes behaviour in a way that breaks existing callers.

## Scope

Use a scope when one is clear: a package, a directory or a feature name. Prefer the scopes in `recentCommits`. Omit the scope when nothing fits.

## Description

Lowercase, imperative, no final period. It says what the commit does: `validate token ids`, `return balances per token`. Keep the whole header within 72 characters.

## Splitting into stages

Make a new stage when the hunks:

- have a different type (a refactor next to a feature),
- could be committed and understood on their own,
- serve a separate purpose that a reviewer would judge separately.

Keep hunks together when one only makes sense with the other: a feature and its tests, a signature change and its callers, a rename and its references.

Stages should leave the code consistent. A stage that calls a function includes that function or comes after the stage that adds it.

A diff that is one change is one stage.

## Ordering the stages

1. Preparatory stages: `refactor`, `build`, `chore`, `ci`. They make room for the main change.
2. Behaviour stages: `feat`, `fix`, `perf`. Put a stage that others rely on before the stages that use it.
3. `test` stages that cover behaviour from earlier stages.
4. `docs`.
5. `style`, and any stage whose purpose is unclear.

## Ordering the hunks in a stage

Put definitions before uses:

1. types and interfaces,
2. implementation,
3. callers, wiring and UI,
4. tests.

When two hunks have no relation, order them by file path.

## Worked example

Input: validation helper with its test, a service that now takes a token ID, a hook and a list view that use it, a test for the service, and a whitespace change.

```json
{
  "stages": [
    {
      "type": "feat", "scope": "balance", "description": "validate token ids",
      "hunks": [
        { "id": "h1", "summary": "Token IDs can now be checked for the right format.", "needs": [] },
        { "id": "h2", "summary": "A bad token ID is now shown to fail the check.", "needs": ["h1"] }
      ]
    },
    {
      "type": "feat", "scope": "balance", "description": "return balances per token",
      "hunks": [
        { "id": "h3", "summary": "Balances now have a type with a token ID and an amount.", "needs": [] },
        { "id": "h4", "summary": "Asking for a balance now needs a token ID, and bad IDs are refused.", "needs": ["h1", "h3"] },
        { "id": "h5", "summary": "The balance hook now passes the chosen token to the service.", "needs": ["h4"] },
        { "id": "h6", "summary": "The list now shows one row for each token.", "needs": ["h5"] },
        { "id": "h7", "summary": "A test now checks that one token returns its own balance.", "needs": ["h4"] }
      ]
    },
    {
      "type": "style", "scope": "format", "description": "remove extra space",
      "hunks": [
        { "id": "h8", "summary": "Numbers are formatted the same way, with one less space.", "needs": [] }
      ]
    }
  ]
}
```
