# 5. A rule-based traffic light on top of the list of factors

Date: 2026-10-23

## Status

Accepted. Supersedes [ADR-0004](0004-risk-shown-as-factors-not-a-score.md).
The expert reviewed every rule in round 2 (2026-11-20): all kept, the yellow
overflow rule widened to 2 km, the active dumping site to 500 m, and a
stream-mouth rule added (yellow within 200 m, red after ≥ 10 mm rain in 48 h).
`status` in `web/src/verdict-rules.json` is now `"gennemgaaet"`.

## Context

ADR-0004 showed contamination risk only as a list of factors and deferred any
combined verdict to the expert. The expert answered "both" (review page,
round 1): a combined traffic light is a useful supplement, because inexperienced
foragers can't weigh the factors against each other, while experienced ones
want to see the reasoning behind the verdict.

There is still no data on actual contamination in seaweed to fit or backtest a
score against.

## Decision

- Above the list, show green / yellow / red from **explicit, human-readable
  rules** (a source type within a distance; rain over 48 h; V2 soil within
  1 km). Red if any red rule matches, yellow if any yellow rule matches,
  otherwise green. There are no weights or numeric scores, so the expert can
  approve or change each rule on its own.
- Every verdict lists the rules that matched, with the nearest source and its
  distance. All rules are visible under "Sådan vurderer vi". Rules that could
  not be checked (a live source failed) are named, never silently skipped.
- Green is worded "few known risk sources", never "safe". The general
  disclaimer stays.
- Coastal-water chemical status is **not** a rule: 121 of 123 Danish coastal
  waters are "ikke-god", so it would not tell spots apart. Currents and water
  exchange are not modelled and say so.
- One source of truth: `web/src/verdict-rules.json` drives both the app
  (`verdict.ts`) and the expert review page.

## Consequences

- The verdict is only as good as the mapped data and the draft thresholds. The
  "Udkast" badge stays until the expert signs off, and then `status` changes.
- Changing a threshold is a JSON edit plus a test run. No code change.
- Not a predictive model. If contamination measurements become available, a
  calibrated score would need its own ADR.
