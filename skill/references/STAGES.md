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

Do not add `!` to the type or scope. The app does not accept a breaking-change marker. When a hunk breaks existing callers, say so in its summary.

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
        { "id": "3f9a1c7e2b", "summary": "Token IDs can now be checked for the right format.", "needs": [] },
        { "id": "8d04b6a15c", "summary": "A bad token ID is now shown to fail the check.", "needs": ["3f9a1c7e2b"] }
      ]
    },
    {
      "type": "feat", "scope": "balance", "description": "return balances per token",
      "hunks": [
        { "id": "c27e90f4a3", "summary": "Balances now have a type with a token ID and an amount.", "needs": [] },
        { "id": "51b8d3e6f0", "summary": "Asking for a balance now needs a token ID, and bad IDs are refused.", "needs": ["3f9a1c7e2b", "c27e90f4a3"] },
        { "id": "a9c4e17b82", "summary": "The balance hook now passes the chosen token to the service.", "needs": ["51b8d3e6f0"] },
        { "id": "6e2f05d8c1", "summary": "The list now shows one row for each token.", "needs": ["a9c4e17b82"] },
        { "id": "0b7a39c4e5", "summary": "A test now checks that one token returns its own balance.", "needs": ["51b8d3e6f0"] }
      ]
    },
    {
      "type": "style", "scope": "format", "description": "remove extra space",
      "hunks": [
        { "id": "d84f1a62b7", "summary": "Numbers are formatted the same way, with one less space.", "needs": [] }
      ]
    }
  ]
}
```
