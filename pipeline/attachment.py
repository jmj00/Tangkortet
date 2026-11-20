"""Classify a seaweed occurrence as attached (growing on the seabed) or drift.

Source data has no structured field for this (spike 2026-10-23, docs/adr/0003),
so it is inferred from the free-text and depth fields a Darwin Core / GBIF
record carries. Rules, first match wins:

1. Drift words ("opskyl", "drift", "washed", "tørret", ...) in the remarks ->
   ``drift``. Explicit words beat everything else.
2. A depth > 0 m, or attached/diving words ("fastsiddende", "scuba", "dyk",
   "stenrev", ...) -> ``attached``.
3. A beach/strand habitat with no depth -> ``drift``. Weak, but the brief says
   most beach records are cast-up material.
4. Otherwise ``unknown``.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal

Attachment = Literal["attached", "drift", "unknown"]

TEXT_FIELDS = ("occurrenceRemarks", "habitat", "fieldNotes", "eventRemarks", "locality")

DRIFT = re.compile(
    r"opskyl|opskyld|drivtang|drift|washed|cast[ -]?up|t[øo]rret|tangvold|beach[ -]?cast",
    re.IGNORECASE,
)
ATTACHED = re.compile(
    r"fastsidd|vedh[æa]ft|attached|scuba|snorkel|dyk|diving|stenrev|boulder|"
    r"sublittoral|epilithic|on (?:stone|rock)",
    re.IGNORECASE,
)
BEACH = re.compile(r"\bbeach\b|\bstrand\b|\bshore\b", re.IGNORECASE)


def _depth(record: Mapping[str, Any]) -> float | None:
    for key in ("depth", "minimumDepthInMeters", "maximumDepthInMeters"):
        value = record.get(key)
        if value in (None, ""):
            continue
        try:
            return float(str(value).replace(",", "."))
        except ValueError:
            continue
    return None


def classify(record: Mapping[str, Any]) -> Attachment:
    text = " ".join(str(record.get(f) or "") for f in TEXT_FIELDS)
    if DRIFT.search(text):
        return "drift"
    depth = _depth(record)
    if (depth is not None and depth > 0) or ATTACHED.search(text):
        return "attached"
    if BEACH.search(text):
        return "drift"
    return "unknown"
