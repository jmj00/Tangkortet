"""Write the static payload the web app reads (``web/src/types.ts``).

    build/publish/
      manifest.json            species index, risk index, attribution, version
      species/<slug>.json      one doc per published species
      risk/<cell>.json         risk features in one grid cell (pipeline/ingest/risk.py)
      coast/<cell>.json        OpenStreetMap coast features, same grid (pipeline/ingest/coast.py;
                               ODbL, unlike the rest of the payload)

Observations are packed as arrays to keep the files small:
``[lon, lat, year|null, attachment, depth_m|null, dataset_index]`` where
``attachment`` is 0 = attached, 1 = drift, 2 = unknown and ``dataset_index``
points into the doc's ``datasets`` list.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import statistics
from collections import Counter
from typing import Any

from pipeline.geo import cell_key
from pipeline.ingest.gbif import Observation
from pipeline.species import Species

ATTACHMENT_CODE = {"attached": 0, "drift": 1, "unknown": 2}

# Curated photo shortlists, one data/images/<slug>.json per species
# (scripts/pull_species_images.py; see data/images/README.md).
IMAGES_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "images"

ATTRIBUTION = {
    "observations": "Fund via GBIF.org (bl.a. NHMD Phycology Herbarium, Arter.dk, iNaturalist);"
    " licens pr. datasæt",
    "basemap": "© OpenStreetMap-bidragydere / GeoDanmark (CC BY 4.0)",
    "risk": "Miljøstyrelsen, MiljøGIS (vandområdeplaner); Danmarks Miljøportal; DKJord",
    "weather": "Data fra DMI",
    "photos": "Fotos fra iNaturalist-fund (CC BY 4.0 / CC0) – se det enkelte billede",
    # The coast cells are a derivative database of OpenStreetMap: ODbL 1.0
    # (share-alike), not the project's CC BY-NC (docs/data-sources.md).
    "coast": "Kysten her (strande, havne, broer, høfder, skrænter): © OpenStreetMap-bidragydere,"
    " ODbL 1.0 – kan være ufuldstændigt",
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


def species_images(slug: str) -> list[dict[str, Any]]:
    """The species' photos as the app shows them (url, credit, licence, links)."""
    path = IMAGES_DIR / f"{slug}.json"
    if not path.exists():
        return []
    return [
        {
            "url": img["url"],
            "credit": img["credit"],
            "license": img["license"],
            "photo_url": img.get("photo_url"),
            "observation_url": img.get("observation_url"),
            "reviewed": bool(img.get("reviewed")),
        }
        for img in json.loads(path.read_text(encoding="utf-8"))
        if not img.get("rejected")
    ]


_INAT_LARGE = re.compile(r"^(https://[^?#]+/photos/\d+/)large(\.[A-Za-z]+)$")


def thumbnail(images: list[dict[str, Any]]) -> str | None:
    """A small rendition of the first photo, for the list rows and the picker.
    iNaturalist serves fixed size variants under one path (square, small,
    medium, large); from Svampekortet 624fb8b."""
    if not images:
        return None
    url = images[0]["url"]
    match = _INAT_LARGE.match(url)
    return f"{match.group(1)}small{match.group(2)}" if match else url


def finds_by_month(obs: list[Observation]) -> dict[str, list[int]]:
    """Finds per calendar month (index 0 = January), all and attached only.

    When people *recorded* the species, not when it is good to collect: shore
    visits and diving follow the weather, so summer is over-represented. The
    app labels it that way; harvest months are the expert's (``season_months``).
    """
    every, attached = [0] * 12, [0] * 12
    for o in obs:
        month = o.get("month")
        if month is None:
            continue
        every[month - 1] += 1
        if o["attachment"] == "attached":
            attached[month - 1] += 1
    return {"all": every, "attached": attached}


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
    slug = slugify(sp["scientific_name"])
    images = species_images(slug)
    return {
        "slug": slug,
        "images": images,
        "thumbnail": thumbnail(images),
        "danish_name": sp["danish_name"],
        "danish_name_verified": sp["danish_name_verified"],
        "invasive": sp["invasive"],
        "lookalikes": sp["lookalikes"],
        "warnings": sp["warnings"],
        "toxins": sp["toxins"],
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
        "finds_by_month": finds_by_month(obs),
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
        "invasive": doc["invasive"],
        "thumbnail": doc.get("thumbnail"),
        "observation_count": doc["observation_count"],
        "attachment_counts": doc["attachment_counts"],
        "finds_by_month": doc.get("finds_by_month"),
        "season_months": doc["expert"]["season_months"],
        # for the list's species-level risk badges (web/src/season.ts riskFlags)
        "accumulation": doc["expert"]["accumulation"],
        "toxins": doc.get("toxins", []),
        "warnings": doc["warnings"],
        "expert_verified": doc["expert"]["verified"],
        "file": f"species/{doc['slug']}.json",
    }


def write_manifest(
    out: pathlib.Path,
    species: list[dict[str, Any]],
    risk: dict[str, Any] | None,
    version: str | None = None,
    coast: dict[str, Any] | None = None,
) -> dict[str, Any]:
    manifest = {
        "version": version or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "attribution": ATTRIBUTION,
        "species": sorted(
            species, key=lambda s: (s["danish_name"] or s["scientific_name"]).lower()
        ),
        "risk": risk,
        "coast": coast,
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
