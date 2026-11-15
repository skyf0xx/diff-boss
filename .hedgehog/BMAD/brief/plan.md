# Plan format

The plan is one JSON object.

```json
{
  "stages": [
    {
      "type": "feat",
      "scope": "balance",
      "description": "validate token ids",
      "hunks": [
        {
          "id": "a1b2c3d4",
          "summary": "Token IDs can now be checked for the right format.",
          "needs": []
        },
        {
          "id": "e5f6a7b8",
          "summary": "A bad token ID is now shown to fail the check.",
          "needs": ["a1b2c3d4"]
        }
      ]
    }
  ]
}
```

## Fields

| Field | Rule |
| --- | --- |
| `stages` | 1 to 12 stages, in review order. |
| `stages[].type` | One of the types in STAGES.md. |
| `stages[].scope` | Optional. Lowercase letters, digits and hyphens. Omit it when no scope fits. |
| `stages[].description` | Lowercase, imperative, no final period. With the type and scope, the header `type(scope): description` is at most 72 characters. |
| `stages[].hunks` | At least one hunk, in reading order. |
| `hunks[].id` | An id from the input, used once in the whole plan. |
| `hunks[].summary` | One sentence of 20 words or fewer, ending with a period. Reading grade 7 or lower. See WRITING.md. |
| `hunks[].needs` | Ids of hunks that must be applied first. Each one comes earlier in the plan. Empty when none. |

The app builds the numbered labels (`Needs hunk 3`) from `needs` and the final order.

## What the app checks

The app checks the plan in this order and reports each problem as one line, `✗ <field>: <what to change>`.

| Message | Fix |
| --- | --- |
| `✗ json: …` | Return one valid JSON object and nothing else. |
| `✗ hunks: <id> isn't in any stage …` | Add the hunk to the stage it belongs to. |
| `✗ hunks: <id> appears more than once …` | Keep it in one stage and remove the other entries. |
| `✗ hunks: <id> isn't a hunk in the input …` | Remove it. |
| `✗ stages[i].type: <x> isn't a type …` | Use a type from STAGES.md. |
| `✗ stages[i].scope: …` | Use lowercase letters, digits and hyphens, or omit the scope. |
| `✗ stages[i].description: …` | Lowercase, imperative, no final period. |
| `✗ stages[i].header: <n> characters, the limit is 72 …` | Shorten the description. |
| `✗ stages[i].hunks: …` | Give the stage at least one hunk, or remove the stage. |
| `✗ hunks[<id>].summary: <n> words, the limit is 20 …` | Cut it to one shorter sentence. |
| `✗ hunks[<id>].summary: reading grade <n>, the limit is 8 …` | Use shorter words and shorter sentences. |
| `✗ hunks[<id>].needs: <other> comes later …` | Move the hunk after the one it needs, or remove the dependency. |
| `✗ order: <id> doesn't apply after the hunks before it …` | Move it after the hunk that changes the same lines, or fix its `needs`. |

The order check applies the hunks to a scratch copy of the index in plan order. A hunk fails when an earlier hunk in the plan changes the lines it expects.

## Reading grade

The app measures the Flesch–Kincaid grade of each summary. Aim for grade 7. The limit is 8.
