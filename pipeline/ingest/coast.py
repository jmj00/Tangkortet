"""The coast at the pin, from OpenStreetMap: beaches, harbours, piers, cliffs...

Reads a Denmark extract (``denmark-latest.osm.pbf`` from Geofabrik) and keeps
the features that say what the shore is like and how to get to the water:

* areas: ``natural=beach`` (with its ``surface``), ``natural=sand``, salt marsh
  and tidal flat (``natural=wetland`` + ``wetland=saltmarsh|tidalflat``),
  harbours (``landuse=harbour`` or ``harbour=yes``) and marinas
  (``leisure=marina``); beaches, harbours and marinas mapped as a node become
  points;
* lines: the coastline (``natural=coastline``, land on its left), piers
  (``man_made=pier``: bathing jetties, boat jetties and harbour piers alike),
  groynes (``man_made=groyne``), breakwaters (``man_made=breakwater``) and
  cliffs (``natural=cliff``).

Sand, cliffs, piers, groynes and breakwaters are kept only within
:data:`NEAR_COAST_M` of the coastline: inland they are sand pits, gravel-pit
edges and lake jetties, which say nothing about the coast.

The C++ side of pyosmium does the heavy lifting: a tag filter drops every
object we don't want before Python sees it, and the area assembler builds the
(multi)polygons. Python then simplifies (Douglas-Peucker, a few metres) and
splits everything into the risk cells' grid (``pipeline.geo.cell_key``).

Licence: OpenStreetMap data is ODbL 1.0. The published coast cells are a
derivative database under the ODbL (share-alike), unlike the project's own
CC BY-NC data; see docs/data-sources.md.
"""

from __future__ import annotations

import math
import pathlib
import shutil
import time
import urllib.request
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from pipeline.geo import simplify
from pipeline.http import USER_AGENT
from pipeline.publish import write_json

GEOFABRIK_URL = "https://download.geofabrik.de/europe/denmark-latest.osm.pbf"

AREA_KINDS = ("beach", "sand", "saltmarsh", "tidalflat", "harbour", "marina")
LINE_KINDS = ("coastline", "pier", "groyne", "breakwater", "cliff")
#: Kinds a single node can stand for (a beach or a harbour mapped as a point).
POINT_KINDS = ("beach", "harbour", "marina")
#: Kinds dropped unless within NEAR_COAST_M of the coastline.
COASTAL_ONLY = ("sand", "cliff", "pier", "groyne", "breakwater")
NEAR_COAST_M = 500.0

#: Douglas-Peucker tolerance in metres. Short structures (a groyne is often
#: 30-60 m) keep more detail than beaches and the coastline.
TOLERANCE_M = {"pier": 3.0, "groyne": 3.0, "breakwater": 4.0}
DEFAULT_TOLERANCE_M = 8.0

#: Published coordinates are integers in 1e-5 degrees (about 1.1 m north,
#: 0.6 m east at 56 N), delta-encoded along each line or ring.
SCALE = 100_000

#: The tags the C++ filter lets through (any one of them).
FILTER_TAGS: tuple[tuple[str, str], ...] = (
    ("natural", "beach"),
    ("natural", "sand"),
    ("natural", "cliff"),
    ("natural", "coastline"),
    ("wetland", "saltmarsh"),
    ("wetland", "tidalflat"),
    ("landuse", "harbour"),
    ("harbour", "yes"),
    ("leisure", "marina"),
    ("man_made", "pier"),
    ("man_made", "groyne"),
    ("man_made", "breakwater"),
)

_M_PER_DEG_LAT = 111_320.0

Point = tuple[float, float]


def classify(tags: Mapping[str, str]) -> str | None:
    """The coast kind an object's tags describe, or None. A marina inside a
    harbour often carries ``harbour=yes`` too, so ``leisure=marina`` wins."""
    natural = tags.get("natural")
    if natural in ("coastline", "beach", "sand", "cliff"):
        return natural
    if natural == "wetland" and tags.get("wetland") in ("saltmarsh", "tidalflat"):
        return tags["wetland"]
    man_made = tags.get("man_made")
    if man_made in ("pier", "groyne", "breakwater"):
        return man_made
    if tags.get("leisure") == "marina":
        return "marina"
    if tags.get("landuse") == "harbour" or tags.get("harbour") == "yes":
        return "harbour"
    return None


def detail(kind: str, tags: Mapping[str, str]) -> str | None:
    """The one extra fact kept per kind: a beach's ``surface`` (as tagged,
    lower case); ``"bade"`` for a pier that is evidently a bathing jetty (its
    name says "badebro"/"badebroen", or it is tagged as a bathing place)."""
    if kind == "beach":
        surface = (tags.get("surface") or "").strip().lower()
        return surface[:20] or None
    if kind == "pier":
        name = (tags.get("name") or "").lower()
        bathing = tags.get("leisure") in ("bathing_place", "swimming_area")
        if bathing or "badebro" in name or tags.get("bathing") == "yes":
            return "bade"
    return None


def name_of(tags: Mapping[str, str]) -> str | None:
    name = (tags.get("name") or "").strip()
    return name[:80] or None


@dataclass
class Feature:
    """One coast feature: ``geom`` is a point, a line or a closed outer ring,
    as (lon, lat) pairs."""

    id: str
    kind: str
    type: str  # "p" point, "l" line, "a" area (outer ring)
    geom: list[Point]
    name: str | None = None
    detail: str | None = None


@dataclass
class Extract:
    features: list[Feature] = field(default_factory=list)
    counts: Counter[str] = field(default_factory=Counter)
    dropped_inland: Counter[str] = field(default_factory=Counter)
    seconds: float = 0.0
    timestamp: str | None = None


# --- geometry (a local flat grid in metres; fine at a beach's scale) ---


def _kx(lat: float) -> float:
    return _M_PER_DEG_LAT * math.cos(math.radians(lat))


def simplify_lonlat(points: Sequence[Point], tolerance_m: float) -> list[Point]:
    """Douglas-Peucker in metres, then rounded to the published precision with
    repeated points dropped."""
    if not points:
        return []
    kx = _kx(points[0][1])
    metres = [(lon * kx, lat * _M_PER_DEG_LAT) for lon, lat in points]
    kept = simplify(metres, tolerance_m)
    out: list[Point] = []
    for x, y in kept:
        p = (round(x / kx, 5), round(y / _M_PER_DEG_LAT, 5))
        if not out or out[-1] != p:
            out.append(p)
    return out


def _area_m2(ring: Sequence[Point]) -> float:
    kx = _kx(ring[0][1])
    total = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:], strict=False):
        total += (x0 * kx) * (y1 * _M_PER_DEG_LAT) - (x1 * kx) * (y0 * _M_PER_DEG_LAT)
    return abs(total) / 2


def simplify_ring(ring: Sequence[Point], tolerance_m: float) -> list[Point]:
    """A closed ring simplified like a line, but a thin strip (a beach is often
    a few metres wide and a hundred long) must not collapse: the tolerance is
    halved until the ring keeps at least half its area, else it stays as it
    was (rounded)."""
    area = _area_m2(ring)
    tolerance = tolerance_m
    for _ in range(4):
        out = simplify_lonlat(ring, tolerance)
        if len(out) >= 4 and _area_m2(out) >= area / 2:
            return out
        tolerance /= 2
    return simplify_lonlat(ring, 0.0)


def _seg_dist_m(p: Point, a: Point, b: Point) -> float:
    kx = _kx(p[1])
    px, py = p[0] * kx, p[1] * _M_PER_DEG_LAT
    ax, ay = a[0] * kx, a[1] * _M_PER_DEG_LAT
    bx, by = b[0] * kx, b[1] * _M_PER_DEG_LAT
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class CoastIndex:
    """Coastline segments bucketed in a 0.01 degree grid, for "is this within
    NEAR_COAST_M of the coast" (a bucket is at least 620 m wide in Denmark, so
    the 3x3 neighbourhood covers 500 m)."""

    STEP = 0.01

    def __init__(self, lines: Iterable[Sequence[Point]]) -> None:
        self.buckets: dict[tuple[int, int], list[tuple[Point, Point]]] = {}
        for line in lines:
            for a, b in zip(line, line[1:], strict=False):
                x0, x1 = sorted((math.floor(a[0] / self.STEP), math.floor(b[0] / self.STEP)))
                y0, y1 = sorted((math.floor(a[1] / self.STEP), math.floor(b[1] / self.STEP)))
                for x in range(x0, x1 + 1):
                    for y in range(y0, y1 + 1):
                        self.buckets.setdefault((x, y), []).append((a, b))

    def near(self, p: Point, limit_m: float = NEAR_COAST_M) -> bool:
        bx, by = math.floor(p[0] / self.STEP), math.floor(p[1] / self.STEP)
        for x in (bx - 1, bx, bx + 1):
            for y in (by - 1, by, by + 1):
                for a, b in self.buckets.get((x, y), ()):
                    if _seg_dist_m(p, a, b) <= limit_m:
                        return True
        return False

    def any_near(self, points: Sequence[Point], limit_m: float = NEAR_COAST_M) -> bool:
        # every vertex of a long feature is plenty; most hit on the first few
        return any(self.near(p, limit_m) for p in points)


# --- reading the extract ---


def _locations(nodes: Iterable[Any]) -> list[Point] | None:
    out: list[Point] = []
    try:
        for n in nodes:
            out.append((n.lon, n.lat))
    except Exception:  # a node outside the extract has no location
        return None
    return out


def read_pbf(path: str | pathlib.Path) -> Extract:
    """Every coast feature in the file, unsimplified, with no coast filter."""
    import osmium  # the only non-stdlib dependency; imported here so the rest
    # of the pipeline (and its tests) never needs it

    start = time.monotonic()
    result = Extract()
    tag_filter = osmium.filter.TagFilter(*FILTER_TAGS)
    processor = (
        osmium.FileProcessor(str(path))
        .with_areas(osmium.filter.TagFilter(*FILTER_TAGS))
        .with_filter(tag_filter)
    )
    try:
        stamp = processor.header.get("osmosis_replication_timestamp")
        result.timestamp = stamp or None
    except Exception:
        result.timestamp = None

    for obj in processor:
        tags = {t.k: t.v for t in obj.tags}
        kind = classify(tags)
        if kind is None:
            continue
        if obj.is_node():
            if kind in POINT_KINDS and obj.location.valid():
                result.features.append(
                    Feature(
                        f"n{obj.id}",
                        kind,
                        "p",
                        [(obj.lon, obj.lat)],
                        name_of(tags),
                        detail(kind, tags),
                    )
                )
        elif obj.is_way():
            if kind not in LINE_KINDS:
                continue  # areas come from the area assembler
            geom = _locations(obj.nodes)
            if geom and len(geom) >= 2:
                result.features.append(
                    Feature(f"w{obj.id}", kind, "l", geom, name_of(tags), detail(kind, tags))
                )
        elif obj.is_area():
            if kind not in AREA_KINDS:
                continue  # a closed pier or coastline way is drawn as its line
            prefix = "w" if obj.from_way() else "r"
            for i, ring in enumerate(obj.outer_rings()):
                geom = _locations(ring)
                if geom and len(geom) >= 4:
                    fid = f"{prefix}{obj.orig_id()}" + (f".{i}" if i else "")
                    result.features.append(
                        Feature(fid, kind, "a", geom, name_of(tags), detail(kind, tags))
                    )
        else:
            continue
        result.counts[kind] += 1
    result.seconds = time.monotonic() - start
    return result


def _point(f: Feature, lon: float, lat: float) -> Feature:
    return Feature(f.id, f.kind, "p", [(round(lon, 5), round(lat, 5))], f.name, f.detail)


def prepare(extract: Extract) -> list[Feature]:
    """Simplify every feature and drop the inland ones of COASTAL_ONLY kinds.
    A ring that simplifies to less than a triangle becomes a point."""
    coastline = [
        simplify_lonlat(f.geom, TOLERANCE_M.get(f.kind, DEFAULT_TOLERANCE_M))
        for f in extract.features
        if f.kind == "coastline"
    ]
    index = CoastIndex(coastline)
    out: list[Feature] = []
    coast_iter = iter(coastline)
    for f in extract.features:
        if f.kind == "coastline":
            geom = next(coast_iter)
            if len(geom) >= 2:
                out.append(Feature(f.id, f.kind, "l", geom))
            continue
        if f.kind in COASTAL_ONLY and not index.any_near(f.geom):
            extract.dropped_inland[f.kind] += 1
            continue
        if f.type == "p":
            out.append(_point(f, *f.geom[0]))
            continue
        tolerance = TOLERANCE_M.get(f.kind, DEFAULT_TOLERANCE_M)
        if f.type == "a":
            geom = simplify_ring(f.geom, tolerance)
        else:
            geom = simplify_lonlat(f.geom, tolerance)
        if f.type == "a" and len(geom) < 4:
            lon = sum(p[0] for p in f.geom) / len(f.geom)
            lat = sum(p[1] for p in f.geom) / len(f.geom)
            out.append(_point(f, lon, lat))
            continue
        if len(geom) < 2:
            continue
        out.append(Feature(f.id, f.kind, f.type, geom, f.name, f.detail))
    return out


# --- publishing: grid cells of delta-encoded integer coordinates ---


def encode(points: Sequence[Point]) -> list[int]:
    """``[x0, y0, dx1, dy1, ...]`` in 1e-5 degrees (web/src/coast.ts decode)."""
    out: list[int] = []
    px = py = 0
    for i, (lon, lat) in enumerate(points):
        x, y = round(lon * SCALE), round(lat * SCALE)
        if i == 0:
            out += [x, y]
        else:
            out += [x - px, y - py]
        px, py = x, y
    return out


def _cells_of_bbox(points: Sequence[Point], deg: float) -> list[str]:
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    keys = []
    for x in range(math.floor(min(lons) / deg), math.floor(max(lons) / deg) + 1):
        for y in range(math.floor(min(lats) / deg), math.floor(max(lats) / deg) + 1):
            keys.append(f"{x}_{y}")
    return keys


def _line_runs(points: Sequence[Point], deg: float) -> dict[str, list[list[Point]]]:
    """A long line split into the runs of consecutive segments that touch each
    cell (a segment crossing a border goes to both cells), so the client only
    loads the cells around the pin and still finds every nearby segment."""
    runs: dict[str, list[list[Point]]] = {}
    last_index: dict[str, int] = {}
    for i, (a, b) in enumerate(zip(points, points[1:], strict=False)):
        for key in _cells_of_bbox([a, b], deg):
            if last_index.get(key) == i - 1:
                runs[key][-1].append(b)
            else:
                runs.setdefault(key, []).append([a, b])
            last_index[key] = i
    return runs


def cell_files(
    features: Sequence[Feature], deg: float, keep: Iterable[str] | None = None
) -> dict[str, dict[str, Any]]:
    """``{cell: {"coastline": [[deltas], ...], "features": [row, ...]}}`` where a
    row is ``[id, kind, type, deltas, name?, detail?]`` (trailing nulls cut).
    Areas and points go whole into every cell their bbox touches (the client
    de-duplicates by id); lines are split per cell. ``keep``: only these cells
    (the committed sample)."""
    wanted = set(keep) if keep is not None else None
    cells: dict[str, dict[str, Any]] = {}

    def cell(key: str) -> dict[str, Any] | None:
        if wanted is not None and key not in wanted:
            return None
        return cells.setdefault(key, {"coastline": [], "features": []})

    for f in features:
        if f.kind == "coastline":
            for key, runs in _line_runs(f.geom, deg).items():
                c = cell(key)
                if c is not None:
                    c["coastline"] += [encode(r) for r in runs]
            continue
        row: list[Any] = [f.id, f.kind, f.type, encode(f.geom), f.name, f.detail]
        while row[-1] is None:
            row.pop()
        if f.type == "l" and len(f.geom) > 2:
            # a long pier or cliff: split like the coastline
            for key, runs in _line_runs(f.geom, deg).items():
                c = cell(key)
                if c is not None:
                    for r in runs:
                        c["features"].append([f.id, f.kind, "l", encode(r), *row[4:]])
            continue
        for key in _cells_of_bbox(f.geom, deg):
            c = cell(key)
            if c is not None:
                c["features"].append(row)
    return cells


def cells_in(bboxes: Sequence[tuple[float, float, float, float]], deg: float) -> list[str]:
    """Every cell key overlapping any of the bboxes."""
    keys: set[str] = set()
    for b in bboxes:
        keys.update(_cells_of_bbox([(b[0], b[1]), (b[2], b[3])], deg))
    return sorted(keys)


def download(dest: pathlib.Path, url: str = GEOFABRIK_URL) -> pathlib.Path:
    """Fetch the Denmark extract (about 500 MB) to ``dest`` unless it exists."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as r, part.open("wb") as out:
        shutil.copyfileobj(r, out, length=1 << 20)
    part.replace(dest)
    return dest


SOURCE = "OpenStreetMap (Geofabrik-udtræk for Danmark)"
LICENSE = "ODbL 1.0"


def publish_coast(
    out: pathlib.Path,
    pbf: str | pathlib.Path,
    cell_deg: float,
    coverage: Sequence[tuple[float, float, float, float]] | None = None,
) -> dict[str, Any]:
    """Extract ``pbf`` into ``out/coast/<cell>.json`` and return the
    manifest's ``coast`` index. ``coverage``: only the cells overlapping these
    bboxes (the committed dev sample); the index then lists those cells as the
    area the data covers, so the app can tell "no coast here" from "no data
    here". Old cell files are removed first."""
    extract = read_pbf(pbf)
    features = prepare(extract)
    keep = cells_in(coverage, cell_deg) if coverage else None
    cells = cell_files(features, cell_deg, keep)
    folder = out / "coast"
    if folder.exists():
        for old in folder.glob("*.json"):
            old.unlink()
    for key, content in cells.items():
        write_json(folder / f"{key}.json", content)
    counts = Counter(f.kind for f in features)
    print(
        f"  read {extract.seconds:.0f} s; kept {len(features)} features"
        f" (inland dropped: {dict(extract.dropped_inland)}); {len(cells)} cells"
    )
    return {
        "cell_deg": cell_deg,
        "cells": sorted(cells),
        "coverage": keep,
        "source": SOURCE,
        "license": LICENSE,
        "osm_timestamp": extract.timestamp,
        # features in the whole extract, before any sample cut
        "counts_denmark": {k: counts.get(k, 0) for k in (*AREA_KINDS, *LINE_KINDS)},
    }
