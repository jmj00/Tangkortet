# 3. Attached vs. drift is inferred from free text and depth

Date: 2026-10-23

## Status

Accepted

## Context

The expert asked to tell attached (on the seabed) observations apart from drift
(washed ashore, possibly from far away). No source has a structured field for
it. The GBIF spike found the signal only in `depth`, `fieldNotes` ("Scuba
diving;"), `habitat` ("Beach") and remarks ("Tørret sukkertang i opskyl").

## Decision

Every observation gets `attachment: attached | drift | unknown` from the
rules in `pipeline/attachment.py`, first match wins:

1. drift words in the text → `drift` (explicit beats implicit);
2. depth > 0 m, or attached/diving words → `attached`;
3. beach/strand/shore with no depth → `drift`;
4. otherwise `unknown`.

The rules are unit-tested and the UI labels inferred values as such. `unknown`
records are shown, never dropped. User submissions (plan phase 5) will ask the
question explicitly.

## Consequences

- Old survey records come out mostly `attached`, recent shore photos mostly
  `unknown`. That's honest, but the map will look sparse for "attached" near
  popular beaches.
- Depth 0 is treated as unknown because it means "shore" or "not recorded"
  depending on the dataset.
- Keyword lists will need tuning as more Danish free text turns up. Each change
  gets a test case.
