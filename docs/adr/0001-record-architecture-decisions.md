# 1. Record architecture decisions

Date: 2026-10-23

## Status

Accepted

## Context

We want a lightweight, durable record of the decisions that shape the project, so
that a future contributor (or the same person in six months) can see not just what
was chosen but why, and what was traded away.

## Decision

We use Architecture Decision Records, one Markdown file per decision in
`docs/adr/`, numbered sequentially, in the format popularised by Michael Nygard:
Context, Decision, Consequences, plus a Status (proposed / accepted / superseded).

A decision is never edited to reverse it; instead a new ADR supersedes it and
updates the old one's status.

## Consequences

- Small ongoing discipline: a non-trivial choice means writing ~15 lines.
- The `docs/adr/` directory becomes the honest history of the design.
