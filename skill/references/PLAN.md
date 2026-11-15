# Plan format

The plan is one JSON object. Return it as plain text: no code fence, no prose before or after it.

```json
{
  "stages": [
    {
      "type": "feat",
      "scope": "balance",
      "description": "validate token ids",
      "hunks": [
        {
          "id": "3f9a1c7e2b",
          "summary": "Token IDs can now be checked for the right format.",
          "needs": []
        },
        {
          "id": "8d04b6a15c",
          "summary": "A bad token ID is now shown to fail the check.",
          "needs": ["3f9a1c7e2b"]
        }
      ]
    }
  ]
}
```

Hunk ids are the ids from the input, copied exactly. The ids above are examples.

## Fields

| Field | Rule |
| --- | --- |
| `stages` | 1 to 12 stages, in review order. |
| `stages[].type` | One of the types in STAGES.md. |
| `stages[].scope` | Optional. Lowercase letters, digits and hyphens. Leave the key out when no scope fits. Do not use `null` or an empty string. |
| `stages[].description` | Lowercase, imperative, no final period. With the type and scope, the header `type(scope): description` is at most 72 characters. |
| `stages[].hunks` | At least one hunk, in reading order. |
| `hunks[].id` | An id from the input, used once in the whole plan. |
| `hunks[].summary` | One sentence of 20 words or fewer, ending with a period. Reading grade: aim for 7. Above 8 is flagged in the review, not rejected. See WRITING.md. |
| `hunks[].needs` | Ids of hunks that must be applied first. Each one comes earlier in the plan. Empty when none. |

Every key in the example is required except `scope`. Add no other keys.

The app builds the numbered labels (`Needs hunk 3`) from `needs` and the final order.

## What the app checks

The app checks the plan in this order and reports each problem as one line, `✗ <field>: <what to change>`. Later checks run only when the earlier ones pass, so fixing one set of lines can bring up new ones. Fix every line you are given, then return the whole plan again.

| Message | Fix |
| --- | --- |
| `✗ json: output is not valid JSON (…)` | Return one valid JSON object and nothing else: no code fence, no text around it. |
| `✗ json: output is not a JSON object` | Return an object that starts with `{`, not an array or a single value. |
| `✗ json: the plan doesn't match the format at <path> (…)` | Follow the plan format above: `stages` is a list, each stage has `type`, `description` and `hunks`, each hunk has `id`, `summary` and `needs`. |
| `✗ hunks: <id> isn't in any stage …` | Add the hunk to the stage it belongs to. |
| `✗ hunks: <id> appears more than once …` | Keep it in one stage and remove the other entries. |
| `✗ hunks: <id> isn't a hunk in the input …` | Remove it. Use only ids from the input. |
| `✗ stages: <n> stages, use 1 to 12` | Merge stages or split the plan so there are 1 to 12 stages. |
| `✗ stages[i].type: <x> isn't a type …` | Use a type from STAGES.md. |
| `✗ stages[i].scope: …` | Use lowercase letters, digits and hyphens, or leave the scope out. |
| `✗ stages[i].description: …` | Lowercase, imperative, no final period, and not empty. |
| `✗ stages[i].header: <n> characters, the limit is 72 …` | Shorten the description. |
| `✗ stages[i].hunks: the stage has no hunks …` | Give the stage at least one hunk, or remove the stage. |
| `✗ hunks[<id>].summary: <n> words, the limit is 20 …` | Cut it to one shorter sentence. |
| `✗ hunks[<id>].summary: it must be one sentence ending with a period …` | Write one sentence and end it with a period. Do not use `.`, `!` or `?` in the middle of it. |
| `✗ hunks[<id>].needs: <other> isn't a hunk in the plan …` | Remove the id, or add that hunk to the plan. |
| `✗ hunks[<id>].needs: <other> is the hunk itself …` | Remove the hunk's own id from its `needs`. |
| `✗ hunks[<id>].needs: <other> comes later …` | Move the hunk after the one it needs, or remove the dependency. |
| `✗ order: <id> doesn't apply after the hunks before it …` | Move it after the hunk that changes the same lines, or fix its `needs`. |

The order check applies the hunks to a scratch copy of the index in plan order. A hunk fails when an earlier hunk in the plan changes the lines it expects. A `✗ order` line is reported for each hunk that fails.

## Reading grade

The app measures the Flesch–Kincaid grade of each summary. Aim for grade 7. A summary above grade 8 does not reject the plan: the review shows it with a "Hard to read" marker. Still use short, common words, so the marker is rare.
