"""Danish occurrences per species from the GBIF occurrence API.

GBIF already aggregates every source we want (NHMD herbarium, arter.dk,
iNaturalist, observation.org, ...), so there is no per-source ingest. Each
record is normalised to an :class:`Observation`, with ``attachment`` inferred by
:func:`pipeline.attachment.classify` (ADR-0003).
"""

from __future__ import annotations

import functools
from collections.abc import Iterator, Mapping
from typing import Any, TypedDict

from pipeline.attachment import Attachment, classify
from pipeline.config import COORD_DECIMALS, MAX_UNCERTAINTY_M
from pipeline.http import get_json

API = "https://api.gbif.org/v1"
PAGE = 300


class Observation(TypedDict):
    lon: float
    lat: float
    year: int | None
    attachment: Attachment
    depth_m: float | None
    dataset: str
    license: str
    gbif_id: int


def _depth(record: Mapping[str, Any]) -> float | None:
    value = record.get("depth")
    return round(float(value), 1) if isinstance(value, (int, float)) and value > 0 else None


def normalise(record: Mapping[str, Any], dataset_title: str) -> Observation | None:
    """One GBIF occurrence -> an Observation, or None if it should be dropped."""
    lon, lat = record.get("decimalLongitude"), record.get("decimalLatitude")
    if lon is None or lat is None:
        return None
    uncertainty = record.get("coordinateUncertaintyInMeters")
    if isinstance(uncertainty, (int, float)) and uncertainty > MAX_UNCERTAINTY_M:
        return None
    year = record.get("year")
    return {
        "lon": round(float(lon), COORD_DECIMALS),
        "lat": round(float(lat), COORD_DECIMALS),
        "year": year if isinstance(year, int) else None,
        "attachment": classify(record),
        "depth_m": _depth(record),
        "dataset": dataset_title,
        "license": str(record.get("license") or ""),
        "gbif_id": int(record["key"]),
    }


@functools.cache
def dataset_title(key: str) -> str:
    return get_json(f"{API}/dataset/{key}")["title"]


def raw_records(taxon_key: int) -> Iterator[dict[str, Any]]:
    offset = 0
    while True:
        page = get_json(
            f"{API}/occurrence/search",
            {
                "country": "DK",
                "taxonKey": taxon_key,
                "hasCoordinate": "true",
                "hasGeospatialIssue": "false",
                "occurrenceStatus": "PRESENT",
                "limit": PAGE,
                "offset": offset,
            },
        )
        yield from page["results"]
        offset += PAGE
        if page["endOfRecords"]:
            return


def observations_for(taxon_keys: list[int]) -> list[Observation]:
    """Records for several GBIF keys (e.g. a species plus an outdated name whose
    Danish records belong to it), each record once."""
    seen: set[int] = set()
    out = []
    for key in taxon_keys:
        for obs in observations(key):
            if obs["gbif_id"] not in seen:
                seen.add(obs["gbif_id"])
                out.append(obs)
    return out


def observations(taxon_key: int) -> list[Observation]:
    out = []
    for record in raw_records(taxon_key):
        obs = normalise(record, dataset_title(record["datasetKey"]))
        if obs is not None:
            out.append(obs)
    return out
