"""Write the static payload the web app reads (``web/src/types.ts``).

    build/publish/
      manifest.json            species index, risk index, attribution, version
      species/<slug>.json      one doc per published species
      risk/<cell>.json         risk features in one grid cell (pipeline/ingest/risk.py)

Observations are packed as arrays to keep the files small:
``[lon, lat, year|null, attachment, depth_m|null, dataset_index]`` where
``attachment`` is 0 = attached, 1 = drift, 2 = unknown and ``dataset_index``
points into the doc's ``datasets`` list.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import statistics
from collections import Counter
from typing import Any

from pipeline.geo import cell_key
from pipeline.ingest.gbif import Observation
from pipeline.species import Species

ATTACHMENT_CODE = {"attached": 0, "drift": 1, "unknown": 2}

ATTRIBUTION = {
    "observations": "Fund via GBIF.org (bl.a. NHMD Phycology Herbarium, Arter.dk, iNaturalist);"
    " licens pr. datasæt",
    "basemap": "© OpenStreetMap-bidragydere / GeoDanmark (CC BY 4.0)",
    "risk": "Miljøstyrelsen, MiljøGIS (vandområdeplaner); Danmarks Miljøportal; DKJord",
    "weather": "Data fra DMI",
}


def slugify(scientific_name: str) -> str:
    return scientific_name.lower().replace(" ", "-")


def observed_depth(obs: list[Observation]) -> dict[str, float] | None:
    """p10 / median / p90 of the recorded depths, or None below 10 records."""
    depths = sorted(o["depth_m"] for o in obs if o["depth_m"] is not None)
    if len(depths) < 10:
        return None

    def pct(q: float) -> float:
        return depths[min(len(depths) - 1, int(q * len(depths)))]

    return {
        "n": len(depths),
        "p10": pct(0.1),
        "median": round(statistics.median(depths), 1),
        "p90": pct(0.9),
    }


def species_doc(sp: Species, obs: list[Observation]) -> dict[str, Any]:
    datasets: list[dict[str, str]] = []
    index: dict[tuple[str, str], int] = {}
    packed = []
    for o in sorted(obs, key=lambda o: (o["year"] or 0, o["gbif_id"])):
        key = (o["dataset"], o["license"])
        if key not in index:
            index[key] = len(datasets)
            datasets.append({"title": o["dataset"], "license": o["license"]})
        packed.append(
            [
                o["lon"],
                o["lat"],
                o["year"],
                ATTACHMENT_CODE[o["attachment"]],
                o["depth_m"],
                index[key],
            ]
        )
    counts = Counter(o["attachment"] for o in obs)
    return {
        "slug": slugify(sp["scientific_name"]),
        "danish_name": sp["danish_name"],
        "danish_name_verified": sp["danish_name_verified"],
        "scientific_name": sp["scientific_name"],
        "group": sp["group"],
        "gbif_usage_key": sp["gbif_usage_key"],
        "expert": {
            "verified": sp["expert_verified"],
            "depth_m": list(sp["depth_m"]) if sp["depth_m"] else None,
            "harvest_method": sp["harvest_method"],
            "season_months": sp["season_months"],
            "accumulation": sp["accumulation"],
        },
        "observed_depth": observed_depth(obs),
        "attachment_counts": {k: counts.get(k, 0) for k in ATTACHMENT_CODE},
        "observation_count": len(obs),
        "datasets": datasets,
        "observations": packed,
    }


def write_json(path: pathlib.Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def species_summary(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": doc["slug"],
        "danish_name": doc["danish_name"],
        "scientific_name": doc["scientific_name"],
        "group": doc["group"],
        "observation_count": doc["observation_count"],
        "attachment_counts": doc["attachment_counts"],
        "file": f"species/{doc['slug']}.json",
    }


def write_manifest(
    out: pathlib.Path,
    species: list[dict[str, Any]],
    risk: dict[str, Any] | None,
    version: str | None = None,
) -> dict[str, Any]:
    manifest = {
        "version": version or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "attribution": ATTRIBUTION,
        "species": sorted(species, key=lambda s: s["danish_name"]),
        "risk": risk,
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def publish_species(out: pathlib.Path, docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for doc in docs:
        write_json(out / "species" / f"{doc['slug']}.json", doc)
    return [species_summary(d) for d in docs]


def publish_risk(
    out: pathlib.Path,
    layers: list[tuple[Any, list[list[Any]]]],
    cell_deg: float,
    bbox: tuple[float, float, float, float] | None = None,
) -> dict[str, Any]:
    """Split every layer's rows into ``risk/<cell>.json`` files, each
    ``{layer_key: [row, ...]}``; return the manifest's ``risk`` index. A row is
    ``[lon, lat, *layer.fields]``. ``bbox`` keeps only rows inside it (used for
    the small committed dev payload)."""
    cells: dict[str, dict[str, list[list[Any]]]] = {}
    index: dict[str, Any] = {}
    for layer, rows in layers:
        kept = 0
        for row in rows:
            lon, lat = row[0], row[1]
            if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
                continue
            cells.setdefault(cell_key(lon, lat, cell_deg), {}).setdefault(layer.key, []).append(row)
            kept += 1
        index[layer.key] = {
            "label": layer.label,
            "fields": ["lon", "lat", *layer.fields],
            "source": layer.source,
            "count": kept,
        }
    for key, content in cells.items():
        write_json(out / "risk" / f"{key}.json", content)
    return {"cell_deg": cell_deg, "cells": sorted(cells), "layers": index}
