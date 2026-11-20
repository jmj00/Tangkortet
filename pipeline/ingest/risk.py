"""Contamination-risk point layers (docs/data-sources.md, ADR-0004).

Every layer is reduced to points: ``[lon, lat, *fields]`` with the fields named
in :data:`LAYERS`. Dumping-site polygons become their centroid plus an
equivalent radius ``sqrt(area / pi)`` in metres, which is plenty for "how far is
the nearest one". Polygon *membership* questions (is the pin in a Natura 2000
area? which coastal water body?) and contaminated land (V1/V2, whose mirror
withholds geometry but answers distance queries) are queried live by the client
instead (web/src/live.ts), so no polygons are shipped.

Source: MiljøGIS water-plan baseline ``vp4basis2026`` (Miljøstyrelsen).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from pipeline.geo import ring_area_centroid, utm32n_to_wgs84
from pipeline.http import get_json

MILJOEGIS = "https://wfs2-miljoegis.mim.dk/{ws}/ows"
WFS_PAGE = 5000

# PULS "bygværkstype" (support.miljoeportal.dk, "PULS: Regnbetingede udløb -
# Oversigt over bygværkstyper"). Overflows from the combined system carry diluted,
# untreated sewage -- the fecal risk the brief singles out (§2 "Kloakoverløb").
RBU_KIND = {
    "OV": "overloeb",  # overløbsbygværk
    "OS": "overloeb",  # overløb med sparebassin
    "OF": "overloeb",  # overløb med forsinkelsesbassin
    "OK": "overloeb",  # overløb med kombibassin
    "Bypass": "overloeb",  # bypass på renseanlæg (delvist renset spildevand)
    "SE": "regnvand",  # separat regnvand
    "SF": "regnvand",  # separat regnvand med forsinkelsesbassin
    "SKYBRUD": "regnvand",
}

Row = list[Any]


@dataclass(frozen=True)
class Layer:
    key: str
    label: str
    fields: tuple[str, ...]
    source: str
    fetch: Callable[[], Iterator[Row]]


def _text(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _number(value: Any) -> float | None:
    try:
        return round(float(str(value).replace(",", ".")), 1)
    except (TypeError, ValueError):
        return None


def _lonlat(x: float, y: float) -> tuple[float, float]:
    lon, lat = utm32n_to_wgs84(x, y)
    return round(lon, 5), round(lat, 5)


def _polygon_point(rings: list[list[list[float]]]) -> tuple[float, float, int]:
    """Centroid (lon, lat) of the largest ring and the equivalent radius in m.
    ``rings`` are in EPSG:25832 metres."""
    best_area, best_c = 0.0, (rings[0][0][0], rings[0][0][1])
    total = 0.0
    for ring in rings:
        area, c = ring_area_centroid([(p[0], p[1]) for p in ring])
        total += area
        if area >= best_area:
            best_area, best_c = area, c
    lon, lat = _lonlat(*best_c)
    return lon, lat, round(math.sqrt(total / math.pi))


def _outer_rings(geometry: Mapping[str, Any]) -> list[list[list[float]]]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"][0]]
    if geometry["type"] == "MultiPolygon":
        return [poly[0] for poly in geometry["coordinates"]]
    raise ValueError(f"not a polygon: {geometry['type']}")


# --- MiljøGIS (GeoServer WFS 2.0, GeoJSON, EPSG:25832) ---


def wfs_features(layer: str) -> Iterator[dict[str, Any]]:
    url = MILJOEGIS.format(ws=layer.split(":")[0])
    start = 0
    while True:
        page = get_json(
            url,
            {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": layer,
                "outputFormat": "application/json",
                "count": WFS_PAGE,
                "startIndex": start,
            },
        )
        features = page["features"]
        yield from features
        start += len(features)
        if len(features) < WFS_PAGE:
            return


def rbu_row(f: Mapping[str, Any]) -> Row | None:
    p = f["properties"]
    code = _text(p.get("bgv_type"))
    x, y = f["geometry"]["coordinates"][:2]
    return [
        *_lonlat(x, y),
        RBU_KIND.get(code or "", "ukendt"),
        code,
        _text(p.get("pkt_navn")),
        _text(p.get("ejer")),
        _number(p.get("udl_va_sta")),
    ]


def point_row(*props: str) -> Callable[[Mapping[str, Any]], Row | None]:
    def row(f: Mapping[str, Any]) -> Row | None:
        if not f.get("geometry"):
            return None
        x, y = f["geometry"]["coordinates"][:2]
        return [*_lonlat(x, y), *(_text(f["properties"].get(k)) for k in props)]

    return row


def rens_row(f: Mapping[str, Any]) -> Row | None:
    p = f["properties"]
    x, y = f["geometry"]["coordinates"][:2]
    pe = _number(p.get("godk_pe"))
    return [
        *_lonlat(x, y),
        _text(p.get("pkt_navn")),
        _text(p.get("ejer")),
        int(pe) if pe is not None else None,
        _text(p.get("rens_sta")),
    ]


def badevand_row(f: Mapping[str, Any]) -> Row | None:
    p = f["properties"]
    if p.get("bathingwatertype") != "coastalBathingWater":
        return None  # lakes are irrelevant for seaweed
    lon, lat = _number(p.get("lon")), _number(p.get("lat"))
    if lon is None or lat is None:
        x, y = f["geometry"]["coordinates"][:2]
        lon, lat = _lonlat(x, y)
    else:
        lon, lat = round(float(p["lon"]), 5), round(float(p["lat"]), 5)
    return [
        lon,
        lat,
        _text(p.get("bathingwatername")),
        _text(p.get("quality")),
        _text(p.get("season")),
        _text(p.get("bwprofile")),
    ]


def klapplads_row(active: bool) -> Callable[[Mapping[str, Any]], Row | None]:
    def row(f: Mapping[str, Any]) -> Row | None:
        if not f.get("geometry"):
            return None
        lon, lat, radius = _polygon_point(_outer_rings(f["geometry"]))
        p = f["properties"]
        return [lon, lat, radius, _text(p.get("navn")), _text(p.get("klapplads")), active]

    return row


def from_wfs(
    layer: str, row: Callable[[Mapping[str, Any]], Row | None]
) -> Callable[[], Iterator[Row]]:
    def fetch() -> Iterator[Row]:
        for f in wfs_features(layer):
            r = row(f)
            if r is not None:
                yield r

    return fetch


def _chain(*fetchers: Callable[[], Iterator[Row]]) -> Callable[[], Iterator[Row]]:
    def fetch() -> Iterator[Row]:
        for fetcher in fetchers:
            yield from fetcher()

    return fetch


VP4 = "vp4basis2026:vp4_ba_26_"
MILJOEGIS_SRC = "Miljøstyrelsen, MiljøGIS – basisanalyse 2027-2033 (data 2024)"

LAYERS: tuple[Layer, ...] = (
    Layer(
        "rbu",
        "Regnbetingede udløb og overløb",
        ("kind", "code", "name", "owner", "volume_m3_per_year"),
        MILJOEGIS_SRC,
        from_wfs(VP4 + "punkt_rbu_saml", rbu_row),
    ),
    Layer(
        "rens",
        "Renseanlæg",
        ("name", "owner", "capacity_pe", "treatment"),
        MILJOEGIS_SRC,
        from_wfs(VP4 + "punkt_rens_saml", rens_row),
    ),
    Layer(
        "industri",
        "Industriudledninger",
        ("name", "owner", "discharge_type"),
        MILJOEGIS_SRC,
        from_wfs(VP4 + "punkt_ind_saml", point_row("pkt_navn", "ejer", "udl_type")),
    ),
    Layer(
        "akvakultur",
        "Akvakultur (fiskeopdræt)",
        ("name", "owner", "kind"),
        MILJOEGIS_SRC,
        from_wfs(VP4 + "punkt_havdam_saml", point_row("pkt_navn", "ejer", "virk_type")),
    ),
    Layer(
        "havne",
        "Havne",
        ("name", "kind"),
        MILJOEGIS_SRC,
        from_wfs(VP4 + "havne", point_row("navn", "typetekst")),
    ),
    Layer(
        "klapplads",
        "Klappladser (dumping af havnesediment)",
        ("radius_m", "name", "id", "active"),
        MILJOEGIS_SRC,
        _chain(
            from_wfs(VP4 + "klappladser", klapplads_row(active=True)),
            from_wfs(VP4 + "nedlagte_klappladser", klapplads_row(active=False)),
        ),
    ),
    Layer(
        "badevand",
        "Badevand (EU-klassificering)",
        ("name", "quality", "season", "profile_url"),
        MILJOEGIS_SRC,
        from_wfs(VP4 + "badevand", badevand_row),
    ),
)
