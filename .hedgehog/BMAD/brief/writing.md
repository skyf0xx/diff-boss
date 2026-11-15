# Writing the sentence for each hunk

Each hunk gets one sentence. It appears next to the diff, under the file name. The file name is shown by the app, so the sentence leaves it out.

## The job of the sentence

Say what is different for the program or its users once this hunk is applied. Describe the outcome. The reviewer reads the diff for the mechanics.

## Rules

- One sentence, 20 words or fewer, ending with a period.
- Reading grade 7 or lower. Use short, common words and short clauses.
- Present tense. `now` is a good signal that the sentence describes an outcome.
- Name things as a user of the code would: token ID, balance, list. Skip identifiers such as `isValidTokenId` unless the sentence is unclear without one.
- Say only what the patch shows. Give a reason only when the code or a comment states it.
- Write each sentence on its own. A reader may look at one hunk first.

## Pattern

`<Thing> now <does, shows, accepts, refuses or returns> <result>.`

## Examples

| Patch | Sentence |
| --- | --- |
| New function that checks an ID against a pattern | Token IDs can now be checked for the right format. |
| Test asserting a short ID is rejected | A bad token ID is now shown to fail the check. |
| Function gains a parameter and throws on bad input | Asking for a balance now needs a token ID, and bad IDs are refused. |
| List component maps over an array | The list now shows one row for each token. |
| Two spaces become one | Numbers are formatted the same way, with one less space. |

## Avoid

| Avoid | Why | Write instead |
| --- | --- | --- |
| Adds `isValidTokenId` function. | Describes the code. | Token IDs can now be checked for the right format. |
| Updates balance logic. | Says nothing specific. | Balances are now looked up for one token at a time. |
| Fixes the bug users reported. | The patch doesn't show a report. | Empty IDs are now refused instead of returning zero. |
| Refactors the service to leverage a polymorphic dispatcher. | Jargon, long. | The service now picks the right handler for each token. |

## Whitespace and other hunks with no behaviour

State the literal effect: `Extra spaces are removed and nothing else changes.` Add no motive.

## Changed behaviour

When a hunk changes what existing callers get, say it in the sentence: `Bad IDs now cause an error instead of returning zero.`
