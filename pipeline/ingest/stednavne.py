"""Official place names along the coast, from Danske Stednavne (Klimadatastyrelsen).

Danske Stednavne is the national register of place names. Tangkortet takes
the names a forager says about the shore and the water:

* beaches and other named shore (``sn:Naturareal``: ``strand``, ``marsk``,
  ``sandKlit``, ``klippeIOverfladen``);
* harbours (``sn:Havnebassin``: ``lystbådehavn``, ``fiskerihavn``,
  ``trafikhavn``);
* coastal landforms (``sn:Landskabsform``: ``pynt``, ``næs``, ``odde``,
  ``klint``, ``skræntNaturlig``, ``skær``, ``tange``, ``hage``, ``halvø``,
  ``ø``);
* waters (``sn:Farvand``: ``bugt``, ``fjord``, ``sund``, ``nor``,
  ``bredning``, ``løb``, ``hav``; the 7 ``sejlløb`` are shipping lanes and
  left out);
* shallow stones (``sn:UrentFarvand``: ``tørtVedLavvande``,
  ``overskylledeSten``; the 1,092 ``undersøiskGrund`` are banks out at sea);
* sea baths (``sn:Friluftsbad``: ``hav``, published as ``havbad``).

Waters must be the sea's: the register's bugt, løb and nor also name bays of
lakes (Valdemars Vig in Tissø, Kinabugten in Furesø, Ågabet in Arresø). A
water counts as the sea when it lies within :data:`SEA_COAST_M` of the
OpenStreetMap coastline (``--coast-pbf``, the extract the coast cells come
from), is a ``hav``, or touches a water already counted (grown outwards, so a
fjord behind a sluice stays); see :func:`sea_waters`. On the 2026-11-20 data
27 of 761 waters are lakes'.

Landforms, beaches, harbours and the rest are kept only within
:data:`NEAR_WATER_M` of the sea, a sea water or the coastline: many landform
types (næs, pynt, ø) also name places on lakes (Skanderborg Sø, Silkeborg
Langsø, Furesø). Without the extract every water counts as the sea, with a
warning. Shallow stones and sea baths are kept as they are.

Service: Datafordeler's WFS ``Stednavn/STEDNAVNE_BEARBEJDET_GML3SFP``, with an
OAuth bearer token (pipeline/datafordeler.py). ``propertyName`` gives HTTP
400, so whole features are fetched; ``cql_filter`` selects the types. The
``urn:ogc:def:crs:EPSG::4326`` responses are in **lat, lon** order and are
swapped here. The name is the primary one (``brugsprioritet`` primær,
usually ``navn_1.skrivemaade``). The GML
parsing is adapted from Svampekortet 624fb8b (pipeline/ingest/stednavne.py).

Licence: Klimadatastyrelsen's free data, **CC BY 4.0**, credit "Indeholder
data fra Klimadatastyrelsen". The register has been frozen since 2025-09, so
the deploy caches the result (see .github/workflows/deploy.yml).

    py -m pipeline.ingest.stednavne [--out build/stednavne/stednavne.json]
                                    [--raw-dir build/stednavne/raw]

``--raw-dir`` keeps the WFS pages and reuses them, so the parsing can be
changed and rerun without the network. The output feeds ``pipeline.build
--names`` (the ``names/<cell>.json`` files) and ``pipeline.places --names``
(the place search).
"""

from __future__ import annotations

import argparse
import html
import json
import math
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from pipeline.config import BUILD_DIR, REPO_ROOT
from pipeline.datafordeler import credentials, get_token
from pipeline.http import USER_AGENT
from pipeline.ingest.coast import CoastIndex, simplify_lonlat

WFS_URL = "https://wfs.datafordeler.dk/Stednavn/STEDNAVNE_BEARBEJDET_GML3SFP/1/WFS"
DEFAULT_OUT = BUILD_DIR / "stednavne" / "stednavne.json"
DEFAULT_RAW = BUILD_DIR / "stednavne" / "raw"

SOURCE = "Danske Stednavne, Klimadatastyrelsen"
LICENSE = "CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = "Indeholder data fra Klimadatastyrelsen, Danske Stednavne (CC BY 4.0)"


@dataclass(frozen=True)
class Query:
    typename: str  # without the "sn:" prefix
    attribute: str
    values: tuple[str, ...]
    page_size: int = 500


QUERIES: tuple[Query, ...] = (
    Query("Naturareal", "naturarealtype", ("strand", "marsk", "sandKlit", "klippeIOverfladen")),
    Query("Havnebassin", "havnebassintype", ("lystbådehavn", "fiskerihavn", "trafikhavn")),
    Query(
        "Landskabsform",
        "landskabsformtype",
        ("pynt", "næs", "odde", "klint", "skræntNaturlig", "skær", "tange", "hage", "halvø", "ø"),
    ),
    # big polygons (a bay is often 100-500 kB of GML): small pages
    Query(
        "Farvand",
        "farvandstype",
        ("bugt", "fjord", "sund", "nor", "bredning", "løb", "hav"),
        page_size=50,
    ),
    Query("UrentFarvand", "urentFarvandType", ("tørtVedLavvande", "overskylledeSten")),
    Query("Friluftsbad", "friluftsbadtype", ("hav",)),
)


#: The published kind of each (type name, type value); the sea bath's "hav"
#: would clash with the water "hav".
def kind_of(typename: str, value: str) -> str:
    return "havbad" if typename == "Friluftsbad" else value


GROUPS: dict[str, tuple[str, ...]] = {
    "beach": ("strand",),
    "shore": ("marsk", "sandKlit", "klippeIOverfladen"),
    "harbour": ("lystbådehavn", "fiskerihavn", "trafikhavn"),
    "landform": (
        "pynt",
        "næs",
        "odde",
        "klint",
        "skræntNaturlig",
        "skær",
        "tange",
        "hage",
        "halvø",
        "ø",
    ),
    "water": ("bugt", "fjord", "sund", "nor", "bredning", "løb", "hav"),
    "shoal": ("tørtVedLavvande", "overskylledeSten"),
    "bath": ("havbad",),
}
GROUP_OF = {kind: group for group, kinds in GROUPS.items() for kind in kinds}

#: How near a named water (its edge, or inside it) a feature must be to be
#: kept; waters and sea baths are always kept.
NEAR_WATER_M = 1000.0
#: A water this near the OpenStreetMap coastline is the sea (see sea_waters).
SEA_COAST_M = 300.0
#: A water this near a sea water touches it (the open sea is simplified at
#: SEA_TOLERANCE_M, so its edge may be that far off).
SEA_TOUCH_M = 150.0
#: Waters are filtered by sea_waters; sea baths and shallow stones are kept.
UNFILTERED = ("water", "bath", "shoal")

#: Douglas-Peucker tolerance in metres per group (the open sea coarser).
TOLERANCE_M = {"water": 25.0, "landform": 15.0}
DEFAULT_TOLERANCE_M = 8.0
SEA_TOLERANCE_M = 100.0
#: Islands (holes) in a water smaller than this are dropped: the coastline
#: (OpenStreetMap) decides land or water at that scale.
MIN_HOLE_M2 = 5_000.0

Point = tuple[float, float]
Ring = list[Point]


@dataclass
class NameFeature:
    """One named place. ``rings``: areas as rings of (lon, lat), outer rings
    and holes together (even-odd); ``line``: a line; ``point``: a point on
    the place (inside an area), where search flies to."""

    id: str
    kind: str
    name: str
    point: Point
    rings: list[Ring] = field(default_factory=list)
    line: list[Point] = field(default_factory=list)
    area_m2: float = 0.0

    @property
    def group(self) -> str:
        return GROUP_OF[self.kind]

    @property
    def type(self) -> str:
        return "a" if self.rings else "l" if self.line else "p"


# --- GML (regexes, as Svampekortet: one feature shape, no XML library) ---

_ID_RE = re.compile(r"<sn:id\.lokalId>([^<]+)</sn:id\.lokalId>")
_NAME_RE = re.compile(r"<sn:navn_(\d+)\.skrivemaade>([^<]+)</sn:navn_\1\.skrivemaade>")
_PRIORITY_RE = re.compile(r"<sn:navn_(\d+)\.brugsprioritet>([^<]+)</sn:navn_\1\.brugsprioritet>")


def primary_name(member: str) -> str | None:
    """The name whose ``brugsprioritet`` is ``primær`` (usually navn_1, but
    some waters have only a navn_2, e.g. Løgstør Bredning), else the first."""
    names = {int(n): html.unescape(v) for n, v in _NAME_RE.findall(member)}
    if not names:
        return None
    for n, priority in _PRIORITY_RE.findall(member):
        if html.unescape(priority).strip() == "primær" and int(n) in names:
            return names[int(n)]
    return names[min(names)]


_POSLIST_RE = re.compile(r"<gml:posList[^>]*>([^<]+)</gml:posList>")
_POS_RE = re.compile(r"<gml:pos[^L>]*>([^<]+)</gml:pos>")
_POLYGON_RE = re.compile(r"<gml:Polygon\b.*?</gml:Polygon>", re.DOTALL)
_LINE_RE = re.compile(r"<gml:LineString\b.*?</gml:LineString>", re.DOTALL)
_POINT_RE = re.compile(r"<gml:Point\b.*?</gml:Point>", re.DOTALL)
_MATCHED_RE = re.compile(r'numberMatched="(\d+)"')
_EXTERIOR_RE = re.compile(r"<gml:exterior>.*?</gml:exterior>", re.DOTALL)
_INTERIOR_RE = re.compile(r"<gml:interior>.*?</gml:interior>", re.DOTALL)


def latlon_pairs(text: str) -> list[Point]:
    """A GML ``posList`` of **lat lon** pairs as (lon, lat)."""
    v = [float(x) for x in text.split()]
    return [(v[i + 1], v[i]) for i in range(0, len(v) - 1, 2)]


@dataclass
class RawFeature:
    id: str
    kind: str
    name: str
    polygons: list[list[Ring]]  # [outer, *holes] per polygon
    lines: list[list[Point]]
    points: list[Point]


def parse_page(xml_text: str, query: Query) -> tuple[int, list[RawFeature]]:
    """(raw member count, parsed features); a member without a name, a known
    type or a geometry is skipped but still counted, so paging stops on the
    raw count."""
    member_re = re.compile(rf"<sn:{query.typename}\b.*?</sn:{query.typename}>", re.DOTALL)
    type_re = re.compile(rf"<sn:{query.attribute}>([^<]+)</sn:{query.attribute}>")
    members = member_re.findall(xml_text)
    out: list[RawFeature] = []
    for m in members:
        id_m, raw_name, type_m = _ID_RE.search(m), primary_name(m), type_re.search(m)
        if not (id_m and raw_name and type_m):
            continue
        value = html.unescape(type_m.group(1)).strip()
        if value not in query.values:
            continue
        polygons: list[list[Ring]] = []
        for block in _POLYGON_RE.findall(m):
            ext = _EXTERIOR_RE.search(block)
            outer_m = _POSLIST_RE.search(ext.group(0)) if ext else None
            if not outer_m:
                continue
            rings = [latlon_pairs(outer_m.group(1))]
            for interior in _INTERIOR_RE.findall(block):
                hole = _POSLIST_RE.search(interior)
                if hole:
                    rings.append(latlon_pairs(hole.group(1)))
            polygons.append(rings)
        lines = [
            latlon_pairs(p.group(1))
            for block in _LINE_RE.findall(m)
            if (p := _POSLIST_RE.search(block))
        ]
        points = [
            latlon_pairs(p.group(1))[0]
            for block in _POINT_RE.findall(m)
            if (p := _POS_RE.search(block))
        ]
        if not (polygons or lines or points):
            continue
        name = re.sub(r"\s+", " ", raw_name).strip()
        out.append(
            RawFeature(id_m.group(1), kind_of(query.typename, value), name, polygons, lines, points)
        )
    return len(members), out


# --- fetching ---


def page_params(query: Query, start: int) -> dict[str, str]:
    values = ",".join(f"'{v}'" for v in query.values)
    return {
        "service": "WFS",
        "request": "GetFeature",
        "version": "2.0.0",
        "typenames": f"sn:{query.typename}",
        "srsname": "urn:ogc:def:crs:EPSG::4326",
        "cql_filter": f"{query.attribute} IN ({values})",
        "count": str(query.page_size),
        "startindex": str(start),
        # no sortBy: with it the service drops the cql_filter (2026-11-20)
    }


class Fetcher:
    """Pages from the WFS, a fresh token when the last one expired (or was
    refused); with ``raw_dir``, pages are kept on disk and reused."""

    TOKEN_TTL_S = 50 * 60  # tokens last 60 minutes

    def __init__(
        self,
        creds: tuple[str, str] | None,
        raw_dir: pathlib.Path | None,
        get: Callable[[str, str], str] | None = None,
    ) -> None:
        self.creds = creds
        self.raw_dir = raw_dir
        self._get = get or self._http_get
        self._token: str | None = None
        self._token_at = 0.0
        self.requests = 0

    def token(self, fresh: bool = False) -> str:
        if self.creds is None:
            raise RuntimeError("no Datafordeler credentials (DATAFORDELER_CLIENT_ID/_SECRET)")
        if fresh or self._token is None or time.monotonic() - self._token_at > self.TOKEN_TTL_S:
            self._token = get_token(*self.creds)
            self._token_at = time.monotonic()
        return self._token

    @staticmethod
    def _http_get(url: str, token: str) -> str:
        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(req, timeout=180) as resp:  # noqa: S310
            return resp.read().decode("utf-8")

    def page(self, query: Query, start: int) -> str:
        path = (
            self.raw_dir / f"{query.typename}-{start:05d}.xml" if self.raw_dir is not None else None
        )
        if path is not None and path.exists():
            return path.read_text(encoding="utf-8")
        url = f"{WFS_URL}?{urllib.parse.urlencode(page_params(query, start))}"
        text = None
        for attempt in range(4):
            try:
                self.requests += 1
                text = self._get(url, self.token(fresh=attempt > 0))
                break
            except urllib.error.HTTPError as e:
                if e.code not in (401, 403, 429, 500, 502, 503, 504) or attempt == 3:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
            time.sleep(2 * (attempt + 1))
        assert text is not None
        if "ExceptionReport" in text[:2000]:
            raise RuntimeError(f"WFS exception for {query.typename} at {start}: {text[:300]}")
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return text

    def features(self, query: Query) -> list[RawFeature]:
        """Every feature of the query, page by page, each id once."""
        out: dict[str, RawFeature] = {}
        start = 0
        while True:
            text = self.page(query, start)
            count, rows = parse_page(text, query)
            for r in rows:
                out.setdefault(r.id, r)
            matched = _MATCHED_RE.search(text[:3000])
            start += query.page_size
            if count < query.page_size or (matched and start >= int(matched.group(1))):
                return list(out.values())


# --- geometry (flat metres around a feature; fine at Denmark's scale) ---

_M_PER_DEG = 111_320.0


def ring_area_m2(ring: Sequence[Point]) -> float:
    if len(ring) < 3:
        return 0.0
    kx = _M_PER_DEG * math.cos(math.radians(ring[0][1]))
    total = 0.0
    for (x0, y0), (x1, y1) in zip(ring, [*ring[1:], ring[0]], strict=True):
        total += x0 * y1 - x1 * y0
    return abs(total) * kx * _M_PER_DEG / 2


def point_in_rings(p: Point, rings: Iterable[Sequence[Point]]) -> bool:
    """Even-odd over all rings (outer rings and holes alike)."""
    x, y = p
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def point_on_surface(rings: Sequence[Sequence[Point]]) -> Point:
    """A point inside the area: the centroid of the largest outer ring when
    it is inside, else the middle of the widest inside stretch of a
    horizontal line through it (a crescent, a ring of land round a bay)."""
    outer = max(rings, key=ring_area_m2)
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(outer, [*outer[1:], outer[0]], strict=True):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-15:
        return outer[0]
    centre = (cx / (3 * a), cy / (3 * a))
    if point_in_rings(centre, rings):
        return centre
    lats = sorted(p[1] for p in outer)
    best: tuple[float, Point] | None = None
    for frac in (0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6):
        y = lats[0] + (lats[-1] - lats[0]) * frac
        xs: list[float] = []
        for ring in rings:
            for (x0, y0), (x1, y1) in zip(ring, [*ring[1:], ring[0]], strict=True):
                if (y0 > y) != (y1 > y):
                    xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            width = xs[i + 1] - xs[i]
            if best is None or width > best[0]:
                best = (width, ((xs[i] + xs[i + 1]) / 2, y))
        if best is not None:
            return best[1]
    return outer[0]


def _close(ring: list[Point]) -> list[Point]:
    return ring if ring and ring[0] == ring[-1] else [*ring, ring[0]]


def simplify_area(ring: Sequence[Point], tolerance_m: float) -> Ring | None:
    """A closed ring simplified (Douglas-Peucker), or None when it collapses
    below a triangle."""
    out = simplify_lonlat(_close(list(ring)), tolerance_m)
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def clip_ring(ring: Sequence[Point], box: tuple[float, float, float, float]) -> Ring:
    """Sutherland-Hodgman against an axis-aligned box. For a concave ring the
    result may have zero-width slivers along the box's edges; even-odd point
    tests inside the box are still right."""
    west, south, east, north = box
    pts = [p for p in ring]
    if pts and pts[0] == pts[-1]:
        pts = pts[:-1]
    edges: list[tuple[Callable[[Point], bool], Callable[[Point, Point], Point]]] = [
        (lambda p: p[0] >= west, lambda a, b: _at_x(a, b, west)),
        (lambda p: p[0] <= east, lambda a, b: _at_x(a, b, east)),
        (lambda p: p[1] >= south, lambda a, b: _at_y(a, b, south)),
        (lambda p: p[1] <= north, lambda a, b: _at_y(a, b, north)),
    ]
    for inside, cut in edges:
        if not pts:
            break
        out: list[Point] = []
        prev = pts[-1]
        for cur in pts:
            if inside(cur):
                if not inside(prev):
                    out.append(cut(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cut(prev, cur))
            prev = cur
        pts = out
    return pts


def _at_x(a: Point, b: Point, x: float) -> Point:
    t = (x - a[0]) / (b[0] - a[0])
    return (x, a[1] + t * (b[1] - a[1]))


def _at_y(a: Point, b: Point, y: float) -> Point:
    t = (y - a[1]) / (b[1] - a[1])
    return (a[0] + t * (b[0] - a[0]), y)


# --- from raw features to the kept, simplified ones ---


def prepare_one(raw: RawFeature) -> NameFeature | None:
    group = GROUP_OF[raw.kind]
    tolerance = SEA_TOLERANCE_M if raw.kind == "hav" else TOLERANCE_M.get(group, 8.0)
    rings: list[Ring] = []
    area = 0.0
    for polygon in raw.polygons:
        outer = simplify_area(polygon[0], tolerance)
        if outer is None:
            continue
        rings.append(outer)
        area += ring_area_m2(outer)
        for hole in polygon[1:]:
            if ring_area_m2(hole) < MIN_HOLE_M2:
                continue
            h = simplify_area(hole, tolerance)
            if h is not None:
                rings.append(h)
                area -= ring_area_m2(h)
    if rings:
        lon, lat = point_on_surface(rings)
        point = (round(lon, 5), round(lat, 5))
        return NameFeature(raw.id, raw.kind, raw.name, point, rings, [], area)
    if raw.polygons:
        # every ring collapsed (a tiny area): its first corner as a point
        lon, lat = raw.polygons[0][0][0]
        return NameFeature(raw.id, raw.kind, raw.name, (round(lon, 5), round(lat, 5)))
    if raw.lines:
        line = simplify_lonlat(max(raw.lines, key=len), tolerance)
        mid = line[len(line) // 2]
        return NameFeature(raw.id, raw.kind, raw.name, mid, [], line if len(line) >= 2 else [])
    lon, lat = raw.points[0]
    return NameFeature(raw.id, raw.kind, raw.name, (round(lon, 5), round(lat, 5)))


class WaterIndex:
    """The waters' edges for "within so many metres of a named water", plus
    their rings (by bbox) for "inside one"."""

    def __init__(
        self, waters: Sequence[NameFeature], coastline: Iterable[Sequence[Point]] = ()
    ) -> None:
        self.edges = CoastIndex([*(r for w in waters for r in w.rings), *coastline])
        self.areas = [(_bbox(w.rings), w.rings) for w in waters if w.rings]

    def near(self, f: NameFeature, limit_m: float) -> bool:
        pts = [p for r in f.rings for p in r] or f.line or [f.point]
        if self.edges.any_near(pts, limit_m):
            return True
        p = f.point
        return any(
            b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3] and point_in_rings(p, rings)
            for b, rings in self.areas
        )


def _bbox(rings: Sequence[Sequence[Point]]) -> tuple[float, float, float, float]:
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return min(xs), min(ys), max(xs), max(ys)


@dataclass
class Extract:
    features: list[NameFeature]
    fetched: Counter[str]
    dropped_inland: Counter[str]


def sea_waters(
    waters: Sequence[NameFeature], coastline: Sequence[Sequence[Point]]
) -> tuple[list[NameFeature], list[NameFeature]]:
    """(sea, lake) waters. The register's bugt, løb and nor also name bays of
    lakes (Valdemars Vig in Tissø, Kinabugten in Furesø), so a water counts as
    the sea only when it is within :data:`SEA_COAST_M` of the OpenStreetMap
    coastline, or is a ``hav``, or touches (within :data:`SEA_TOUCH_M`) or lies
    inside a water already counted, grown outwards until nothing changes (a
    fjord behind a sluice touches the bay outside it). Without a coastline
    every water counts (and :func:`main` warns)."""
    if not coastline:
        return list(waters), []
    coast = CoastIndex(coastline)

    def by_coast(w: NameFeature) -> bool:
        return coast.any_near([p for r in w.rings for p in r] or w.line or [w.point], SEA_COAST_M)

    sea = [w for w in waters if w.kind == "hav" or by_coast(w)]
    rest = [w for w in waters if all(w is not s for s in sea)]
    grown = list(sea)
    while grown and rest:
        index = WaterIndex(grown)
        grown = [w for w in rest if index.near(w, SEA_TOUCH_M)]
        sea += grown
        rest = [w for w in rest if all(w is not g for g in grown)]
    return sea, rest


def prepare(raw: Sequence[RawFeature], coastline: Sequence[Sequence[Point]] = ()) -> Extract:
    """Simplify everything; keep the sea's waters (:func:`sea_waters`) and the
    shore and landforms near the sea (the coastline or a sea water)."""
    fetched = Counter(r.kind for r in raw)
    prepared = [f for r in raw if (f := prepare_one(r)) is not None]
    waters = [f for f in prepared if f.group == "water"]
    sea, lakes = sea_waters(waters, coastline)
    lake_ids = {id(w) for w in lakes}
    index = WaterIndex(sea, coastline)
    kept: list[NameFeature] = []
    dropped: Counter[str] = Counter()
    for f in prepared:
        if id(f) in lake_ids:
            dropped[f.kind] += 1
        elif f.group in UNFILTERED or index.near(f, NEAR_WATER_M):
            kept.append(f)
        else:
            dropped[f.kind] += 1
    kept.sort(key=lambda f: (f.kind, f.name, f.id))
    return Extract(kept, fetched, dropped)


# --- the intermediate file (read by pipeline.build and pipeline.places) ---


def _r(p: Point) -> list[float]:
    return [round(p[0], 5), round(p[1], 5)]


def to_json(extract: Extract, seconds: float | None = None) -> dict[str, Any]:
    rows = []
    for f in extract.features:
        row: dict[str, Any] = {"id": f.id, "kind": f.kind, "name": f.name, "point": _r(f.point)}
        if f.rings:
            row["rings"] = [[_r(p) for p in r] for r in f.rings]
            row["area_m2"] = round(f.area_m2)
        elif f.line:
            row["line"] = [_r(p) for p in f.line]
        rows.append(row)
    return {
        "source": SOURCE,
        "license": LICENSE,
        "license_url": LICENSE_URL,
        "attribution": ATTRIBUTION,
        "fetched": date.today().isoformat(),
        "seconds": round(seconds, 1) if seconds is not None else None,
        "counts_fetched": dict(sorted(extract.fetched.items())),
        "counts_kept": dict(sorted(Counter(f.kind for f in extract.features).items())),
        "dropped_inland": dict(sorted(extract.dropped_inland.items())),
        "features": rows,
    }


def read(path: pathlib.Path) -> tuple[dict[str, Any], list[NameFeature]]:
    """The intermediate file: its header and its features."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for row in doc["features"]:
        out.append(
            NameFeature(
                row["id"],
                row["kind"],
                row["name"],
                tuple(row["point"]),  # type: ignore[arg-type]
                [[tuple(p) for p in r] for r in row.get("rings", [])],  # type: ignore[misc]
                [tuple(p) for p in row.get("line", [])],  # type: ignore[misc]
                row.get("area_m2", 0.0),
            )
        )
    return doc, out


# --- publishing: names/<cell>.json on the risk cells' grid ---

#: Islands and peninsulas larger than this (Sjælland, Fyn, Jylland,
#: Djursland) say nothing about where on the shore a pin is: left out of the
#: cells (the place search still has them).
MAX_LANDFORM_M2 = 200e6


def _cell_box(key: str, deg: float) -> tuple[float, float, float, float]:
    x, y = (int(v) for v in key.split("_"))
    return x * deg, y * deg, (x + 1) * deg, (y + 1) * deg


def _cells_of(bbox: tuple[float, float, float, float], deg: float) -> list[str]:
    return [
        f"{x}_{y}"
        for x in range(math.floor(bbox[0] / deg), math.floor(bbox[2] / deg) + 1)
        for y in range(math.floor(bbox[1] / deg), math.floor(bbox[3] / deg) + 1)
    ]


def in_cells(f: NameFeature) -> bool:
    """Whether a feature goes into the cells (see MAX_LANDFORM_M2)."""
    return not (f.group == "landform" and f.area_m2 > MAX_LANDFORM_M2)


def cell_files(
    features: Sequence[NameFeature], deg: float, keep: Iterable[str] | None = None
) -> dict[str, dict[str, Any]]:
    """``{cell: {"features": [row, ...]}}``, a row ``[id, kind, type, coords,
    name, area_ha?]``: ``id`` a number (the same in every cell a feature is
    in), type "p" (coords ``[x, y]``), "l" (coords delta-encoded as the coast
    cells) or "a" (coords a list of delta-encoded rings, outer rings and
    holes together: even-odd). A water is clipped to each cell it covers, so
    a cell of open sea holds just the cell's square; everything else goes
    whole into every cell its bbox touches (the client counts it once).
    ``area_ha``: the whole area's size, for "the smallest water the pin is
    in". ``keep``: only these cells (the committed sample)."""
    from pipeline.ingest.coast import encode

    wanted = set(keep) if keep is not None else None
    cells: dict[str, dict[str, Any]] = {}

    def add(key: str, row: list[Any]) -> None:
        if wanted is None or key in wanted:
            cells.setdefault(key, {"features": []})["features"].append(row)

    for i, f in enumerate(features):
        if not in_cells(f):
            continue
        area_ha = max(1, round(f.area_m2 / 10_000)) if f.rings else None
        if f.type == "p":
            add_row: list[Any] = [i, f.kind, "p", encode([f.point]), f.name]
            for key in _cells_of((*f.point, *f.point), deg):
                add(key, add_row)
            continue
        if f.type == "l":
            row = [i, f.kind, "l", encode(f.line), f.name]
            for key in _cells_of(_bbox([f.line]), deg):
                add(key, row)
            continue
        if f.group != "water":
            row = [i, f.kind, "a", [encode(r) for r in f.rings], f.name, area_ha]
            for key in _cells_of(_bbox(f.rings), deg):
                add(key, row)
            continue
        boxes = [(r, _bbox([r])) for r in f.rings]
        for key in _cells_of(_bbox(f.rings), deg):
            if wanted is not None and key not in wanted:
                continue
            box = _cell_box(key, deg)
            pieces = []
            for ring, b in boxes:
                if b[2] < box[0] or b[0] > box[2] or b[3] < box[1] or b[1] > box[3]:
                    continue
                clipped = [(round(x, 5), round(y, 5)) for x, y in clip_ring(ring, box)]
                if len(clipped) >= 3 and ring_area_m2(clipped) > 1.0:
                    pieces.append(encode(clipped))
            if pieces:
                add(key, [i, f.kind, "a", pieces, f.name, area_ha])
    return cells


def publish_names(
    out: pathlib.Path,
    path: pathlib.Path,
    cell_deg: float,
    coverage: Sequence[tuple[float, float, float, float]] | None = None,
) -> dict[str, Any]:
    """The intermediate file at ``path`` into ``out/names/<cell>.json``;
    returns the manifest's ``names`` index. ``coverage`` as for the coast
    cells (the committed dev sample). Old cell files are removed first."""
    from pipeline.ingest.coast import cells_in
    from pipeline.publish import write_json

    doc, features = read(path)
    keep = cells_in(coverage, cell_deg) if coverage else None
    cells = cell_files(features, cell_deg, keep)
    folder = out / "names"
    if folder.exists():
        for old in folder.glob("*.json"):
            old.unlink()
    for key, content in cells.items():
        write_json(folder / f"{key}.json", content)
    size = sum((folder / f"{k}.json").stat().st_size for k in cells)
    print(f"  {len(features)} names; {len(cells)} cells, {size / 1e6:.1f} MB")
    return {
        "cell_deg": cell_deg,
        "cells": sorted(cells),
        "coverage": keep,
        "source": doc.get("source", SOURCE),
        "license": doc.get("license", LICENSE),
        "license_url": doc.get("license_url", LICENSE_URL),
        "fetched": doc.get("fetched"),
        "counts_denmark": doc.get("counts_kept"),
    }


def osm_coastline(pbf: pathlib.Path) -> list[list[Point]]:
    """Every ``natural=coastline`` way in an OpenStreetMap extract, simplified
    (8 m). Reads only the coastline, so it is quicker than the coast cells."""
    import osmium  # as pipeline.ingest.coast: only this step needs it

    from pipeline.ingest.coast import _locations

    processor = (
        osmium.FileProcessor(str(pbf))
        .with_locations()
        .with_filter(osmium.filter.TagFilter(("natural", "coastline")))
    )
    lines: list[list[Point]] = []
    for obj in processor:
        if obj.is_way():
            geom = _locations(obj.nodes)
            if geom and len(geom) >= 2:
                lines.append(simplify_lonlat(geom, 8.0))
    return lines


def fetch_all(fetcher: Fetcher, queries: Sequence[Query] = QUERIES) -> list[RawFeature]:
    raw: list[RawFeature] = []
    for q in queries:
        rows = fetcher.features(q)
        print(f"  {q.typename:14} {len(rows):5} features")
        raw += rows
    return raw


#: A fetch with fewer kept than this is cut short (a failed page, a changed
#: service), and must not replace good names (2026-11-20: 734 waters, 1,256
#: landforms).
MIN_KEPT = {"water": 500, "landform": 800}


def check_counts(extract: Extract) -> None:
    """Raise when a group has fewer kept features than :data:`MIN_KEPT`."""
    kept = Counter(f.group for f in extract.features)
    short = {g: kept[g] for g, n in MIN_KEPT.items() if kept[g] < n}
    if short:
        raise SystemExit(
            f"too few names kept, the fetch looks truncated: {short} (minimum {MIN_KEPT})"
        )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Fetch coastal place names from Danske Stednavne.")
    parser.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--raw-dir", type=pathlib.Path, default=None, help="keep and reuse the WFS pages here"
    )
    parser.add_argument(
        "--coast-pbf",
        type=pathlib.Path,
        default=None,
        help="OpenStreetMap Denmark extract: its coastline decides what is coastal",
    )
    args = parser.parse_args(argv)
    creds = credentials(REPO_ROOT / ".env")
    if creds is None and args.raw_dir is None:
        raise SystemExit("no DATAFORDELER_CLIENT_ID / DATAFORDELER_CLIENT_SECRET")
    start = time.monotonic()
    fetcher = Fetcher(creds, args.raw_dir)
    raw = fetch_all(fetcher)
    fetched_s = time.monotonic() - start
    coastline: list[list[Point]] = []
    if args.coast_pbf and args.coast_pbf.exists():
        coastline = osm_coastline(args.coast_pbf)
        print(f"  {len(coastline)} coastline ways from {args.coast_pbf}")
    else:
        print("  warning: no OpenStreetMap extract; only the named waters say what is coastal")
    extract = prepare(raw, coastline)
    check_counts(extract)
    doc = to_json(extract, fetched_s)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {args.out}: {len(extract.features)} of {len(raw)} features kept "
        f"({fetcher.requests} requests, fetch {fetched_s:.0f} s, "
        f"all {time.monotonic() - start:.0f} s); inland dropped {dict(extract.dropped_inland)}"
    )


if __name__ == "__main__":
    main()
