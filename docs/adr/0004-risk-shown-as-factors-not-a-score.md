# 4. Contamination risk is shown as factors, not a score

Date: 2026-10-23

## Status

Superseded by [ADR-0005](0005-traffic-light-as-draft-rules-plus-list.md) after the
expert asked for a combined traffic light as a supplement (2026-10-23). The list
of factors described here stays, as the reasoning behind the verdict.

## Context

The expert's brief is explicit that distance alone doesn't decide risk
(currents, water exchange), that good bathing water says nothing about the
tang's chemical safety, and that maps and warnings are "no guarantee". The
phase-0 spike found good national layers for outlets, treatment plants,
harbours, dumping sites, contaminated land, bathing water and coastal water
status, but nothing that models how pollution actually spreads.

## Decision

For a chosen spot the app lists the risk factors found nearby: what it is, how
far, its key attribute (e.g. overflow volume, V1/V2, bathing-water class) and
the source with a link. Next to the list it shows the brief's checklist, with
the items the app could check marked. There is no combined safe/unsafe verdict,
colour or number.

## Consequences

- No false comfort from a green light the data can't back.
- More reading for the user. The list must be short and ordered: nearest
  first, grouped by the factor weights the expert gives on the review page.
- If a combined score is ever added, it needs its own ADR, a backtest against
  real contamination measurements, and expert sign-off.
