# 2. Architecture inherited from Svampekortet, with live rain in the browser

Date: 2026-10-23

## Status

Accepted

## Context

Svampekortet (ADR-0002 there) runs a static precompute: a Python pipeline on
GitHub Actions builds DuckDB and static JSON; a vanilla TypeScript + MapLibre
PWA on Cloudflare Pages reads it. There is no backend and almost no running cost.
Tangkortet has the same shape of data: national layers that change weekly to
yearly, plus observations. One input changes by the hour: rainfall in the last
24–72 h (brief §1, §4).

The phase-0 spike found DMI's `metObs` API answers anonymous browser requests
(`access-control-allow-origin: *`) with hourly station precipitation up to the
latest hour.

## Decision

- Same architecture and tooling as Svampekortet, copied into this repo (not
  shared). Separate Cloudflare Pages project, secrets and Sentry project.
- Risk layers are precomputed weekly into static files, clipped to a coastal
  band to keep the payload small.
- **Rain is fetched live by the client** from DMI `metObs` for the stations
  nearest the pin, so the 24/48/72 h numbers are current to the hour without a
  scheduled rebuild. Offline, the rain card says so; it never shows stale
  numbers as current.

## Consequences

- No server, near-zero cost, as in Svampekortet.
- The app depends on DMI's API at view time for one card. A DMI outage
  degrades only that card.
- A backend still arrives only with user submissions (plan phase 5).
