"""Seed the place cards: data/places_info/places_info.json (see its README).

A well-known Danish beach, harbour, marina, headland, spit, cliff, bay or islet
gets a card when open sources say something about it and show it:

- **Wikidata** (CC0): the places, their kind (the direct P31 first, then the
  name, then P279*), coordinates (P625), photo (P18), Commons category (P373)
  and Danish Wikipedia article. One SPARQL query per class, and one for the
  details.
- **Danish Wikipedia** (English only without a Danish article): the lead,
  trimmed to one or two sentences at a sentence boundary, run through the
  safety filter (pipeline/placeinfo.py). Text licence CC BY-SA 4.0. A
  sitelink that redirects to another article (a harbour to its town) gives
  no Wikipedia text.
- **Wikimedia Commons**: the photo (P18, else the article's free page image,
  else one from the item's Commons category), only under CC0, public domain,
  CC BY or CC BY-SA, read from ``extmetadata``; no maps, paintings, drawings,
  pictures from before 1950 or crowds; thumbnails at 330 and 960 px,
  hotlinked from upload.wikimedia.org.
- **OpenStreetMap** via the Overpass API (ODbL): the features tagged
  ``wikidata=<item>`` (the match, the point and the outline), else a beach,
  harbour, marina, cape ... of the same name and kind within 1 km; and the
  committed Danske Stednavne cells (web/public/data/names) for a name match
  inside the dev sample. Only places that match one of the app's coast
  features are kept. The coastline gives a peninsula's or islet's shore.
- **data/places_info/overrides.json**: the manual review, applied on every run.

    py -3.10 scripts/pull_place_info.py            # fetch (cached) and write
    py -3.10 scripts/pull_place_info.py --offline  # from the cache only

Raw responses are cached under build/placeinfo/cache (git-ignored), so a
re-run is fast and does not touch the APIs. Requests are throttled and carry a
generic User-Agent. A content-authoring tool, not part of the pipeline: the
build only reads the committed file. Records the owner has reviewed or
rejected are kept as they are on a re-run.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from pipeline.config import DK_BBOX, REPO_ROOT, SAMPLE_DATA_DIR  # noqa: E402
from pipeline.geo import simplify  # noqa: E402
from pipeline.placeinfo import (  # noqa: E402
    BAY_POINT_MAX_M,
    KIND_GROUP,
    KIND_LABEL,
    SHORE_EXTENT_M,
    SHORE_KINDS,
    SHORE_RADIUS_M,
    STEDNAVNE_GROUP,
    WIKIDATA_CLASSES,
    SegmentIndex,
    allowed_licence,
    bay_shore,
    classify_kind,
    clean_author,
    convex_hull,
    distance_m,
    is_station,
    lead_sentences,
    licence_url,
    match_by_name,
    name_core,
    non_public_class,
    osm_groups,
    osm_kind,
    photo_file_ok,
    photo_meta_reason,
    same_name,
    shore_lines,
    simplify_lines,
    text_from_override,
    upload_url,
    wikidata_sentence,
)

USER_AGENT = "open-data-place-cards/1.1 (non-commercial map project)"
CACHE = REPO_ROOT / "build" / "placeinfo" / "cache"
OUT = REPO_ROOT / "data" / "places_info" / "places_info.json"
OVERRIDES = REPO_ROOT / "data" / "places_info" / "overrides.json"
SPARQL = "https://query.wikidata.org/sparql"
OVERPASS = "https://overpass-api.de/api/interpreter"
COMMONS = "https://commons.wikimedia.org/w/api.php"
THROTTLE_S = 1.0
#: Commons' standard thumbnail steps: the URLs come back as 330px- and
#: 960px-, and the app's srcset says 330w and 960w.
SMALL_W, LARGE_W = 330, 960
#: An outline larger than this (its bounding box's diagonal) is dropped and
#: the card keeps only its point: a pin anywhere in a big bay is not "at" it.
MAX_OUTLINE_M = 12000
#: Larger still (Kattegat, Jylland, Køge Bugt), the place gets no card at all.
MAX_PLACE_M = 25000
MAX_OUTLINE_POINTS = 60
#: Two cards this close never show the same photo (Odense Fjord and Tornø).
SAME_PHOTO_M = 30000
#: A harbour item tagged on a marina further than this from its point keeps
#: its own point (Esbjerg Havn).
FAR_MARINA_M = 300

OFFLINE = False
TODAY = dt.date.today().isoformat()
_last = 0.0


def fetch(url: str, params: dict[str, Any] | None = None, data: dict[str, str] | None = None):
    """GET (or POST ``data``), cached by URL and body under build/, throttled."""
    full = f"{url}?{urllib.parse.urlencode(params, doseq=True)}" if params else url
    body = urllib.parse.urlencode(data).encode() if data else None
    key = hashlib.sha1(full.encode() + (body or b"")).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    if OFFLINE:
        raise SystemExit(f"not cached (offline): {full[:120]}")
    global _last
    for attempt in range(5):
        wait = THROTTLE_S - (time.monotonic() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()
        req = urllib.request.Request(
            full,
            data=body,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                text = r.read().decode("utf-8")
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise
            time.sleep(int(e.headers.get("Retry-After") or 10 * (attempt + 1)))
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 4:
                raise
            time.sleep(10 * (attempt + 1))
    result = json.loads(text)
    remark = result.get("remark", "") if isinstance(result, dict) else ""
    if "error" in remark:
        raise SystemExit(f"overpass: {remark}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, "utf-8")
    return result


# --- Wikidata --------------------------------------------------------------

QUERY = """
SELECT ?item (SAMPLE(?coord) AS ?c) (SAMPLE(?img) AS ?image) (SAMPLE(?daL) AS ?da_label)
  (SAMPLE(?enL) AS ?en_label) (SAMPLE(?daD) AS ?da_desc) (SAMPLE(?daT) AS ?da_title)
  (SAMPLE(?enT) AS ?en_title) (SAMPLE(?end) AS ?ended) WHERE {
  ?t wdt:P279* wd:%s .
  ?item wdt:P31 ?t ; wdt:P17 wd:Q35 ; wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P576 ?end }
  OPTIONAL { ?item rdfs:label ?daL FILTER(LANG(?daL) = "da") }
  OPTIONAL { ?item rdfs:label ?enL FILTER(LANG(?enL) = "en") }
  OPTIONAL { ?item schema:description ?daD FILTER(LANG(?daD) = "da") }
  OPTIONAL { ?daA schema:about ?item ; schema:isPartOf <https://da.wikipedia.org/> ;
             schema:name ?daT }
  OPTIONAL { ?enA schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ;
             schema:name ?enT }
} GROUP BY ?item
"""

#: The direct classes (P31, with English labels) and Commons category (P373).
DETAILS = """
SELECT ?item ?p31 ?p31L ?cat WHERE {
  VALUES ?item { %s }
  OPTIONAL { ?item wdt:P31 ?p31 .
             OPTIONAL { ?p31 rdfs:label ?p31L FILTER(LANG(?p31L) = "en") } }
  OPTIONAL { ?item wdt:P373 ?cat }
}
"""


def parse_point(wkt: str) -> tuple[float, float] | None:
    if not wkt.startswith("Point("):
        return None
    lon, lat = wkt[6:-1].split()
    return float(lon), float(lat)


def wikidata_items() -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for qid, kind in WIKIDATA_CLASSES:
        rows = fetch(SPARQL, data={"query": QUERY % qid, "format": "json"})["results"]["bindings"]
        for row in rows:
            v = {k: x["value"] for k, x in row.items()}
            item_id = v["item"].rsplit("/", 1)[-1]
            point = parse_point(v.get("c", ""))
            if point is None:
                continue
            rec = items.setdefault(item_id, {"id": item_id, "kinds": set(), **v, "point": point})
            rec["kinds"].add(kind)
        print(f"  wikidata {qid:10} {kind:16} {len(rows):4}")
    return items


def wikidata_details(ids: list[str]) -> dict[str, dict[str, Any]]:
    """``{qid: {"p31": {qid}, "p31_labels": [..], "commons_category": str|None}}``."""
    out: dict[str, dict[str, Any]] = {
        i: {"p31": set(), "p31_labels": [], "commons_category": None} for i in ids
    }
    for i in range(0, len(ids), 200):
        values = " ".join(f"wd:{q}" for q in ids[i : i + 200])
        rows = fetch(SPARQL, data={"query": DETAILS % values, "format": "json"})
        for row in rows["results"]["bindings"]:
            v = {k: x["value"] for k, x in row.items()}
            rec = out[v["item"].rsplit("/", 1)[-1]]
            if v.get("p31"):
                cls = v["p31"].rsplit("/", 1)[-1]
                if cls not in rec["p31"]:
                    rec["p31"].add(cls)
                    rec["p31_labels"].append(v.get("p31L") or cls)
            if v.get("cat"):
                rec["commons_category"] = v["cat"]
    return out


# --- OpenStreetMap (Overpass) -----------------------------------------------

BBOX = f"({DK_BBOX[1]},{DK_BBOX[0]},{DK_BBOX[3]},{DK_BBOX[2]})"


def overpass(query: str) -> list[dict[str, Any]]:
    res = fetch(OVERPASS, data={"data": f"[out:json][timeout:240];{query}"})
    return res["elements"]


#: The coast kinds of pipeline/placeinfo.py osm_kind, named or tagged with a
#: Wikidata item: the candidates for both kinds of match.
#: Beaches, harbours and marinas also unnamed, for the match by place.
COAST_FEATURES = (
    'nwr["natural"="beach"]{b};'
    'nwr["leisure"~"^(marina|beach_resort|bathing_place)$"]{b};'
    'nwr["landuse"="harbour"]{b};'
    'nwr["harbour"="yes"]{b};'
    'nwr[~"^(name|wikidata)$"~"."]["natural"~"^(cape|spit|cliff|peninsula|bay)$"]{b};'
    'nwr[~"^(name|wikidata)$"~"."]["place"="islet"]{b};'
)
#: A beach or harbour item with no name match: the nearest beach or harbour
#: of the same kind group mapped this close to its Wikidata point stands for it.
NEARBY_M = 250


def osm_features() -> list[dict[str, Any]]:
    """Every named or Wikidata-tagged coast feature in Denmark (tags, centre)."""
    out = []
    for el in overpass(f"({COAST_FEATURES.format(b=BBOX)});out tags center;"):
        tags = el.get("tags", {})
        kind = osm_kind(tags)
        point = osm_point(el)
        if kind and point:
            out.append(
                {
                    "name": tags.get("name") or "",
                    "wikidata": tags.get("wikidata"),
                    "point": point,
                    "group": KIND_GROUP[kind],
                    "groups": osm_groups(tags),
                    "kind": kind,
                    "osm": f"{el['type'][0]}{el['id']}",
                }
            )
    return out


def osm_geometries(ids: list[str]) -> dict[str, dict[str, Any]]:
    """Full geometry ("out geom") of the matched ways and relations."""
    out: dict[str, dict[str, Any]] = {}
    for prefix, typ in (("w", "way"), ("r", "relation")):
        wanted = sorted(int(i[1:]) for i in ids if i[0] == prefix)
        for i in range(0, len(wanted), 200):
            batch = ",".join(map(str, wanted[i : i + 200]))
            for el in overpass(f"{typ}(id:{batch});out geom;"):
                out[f"{prefix}{el['id']}"] = el
    return out


def osm_point(el: dict[str, Any]) -> tuple[float, float] | None:
    if "lon" in el:
        return el["lon"], el["lat"]
    c = el.get("center")
    if c:
        return c["lon"], c["lat"]
    b = el.get("bounds")
    if b:
        return (b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2
    return None


def osm_edges(el: dict[str, Any]) -> list[list[tuple[float, float]]]:
    """The edge of a way, or of a relation's outer members, as polylines."""
    if el["type"] == "way" and el.get("geometry"):
        return [[(g["lon"], g["lat"]) for g in el["geometry"]]]
    if el["type"] == "relation":
        return [
            [(g["lon"], g["lat"]) for g in m["geometry"]]
            for m in el.get("members", [])
            if m.get("role") in ("outer", "") and m.get("geometry")
        ]
    return []


def osm_geometry(el: dict[str, Any]) -> tuple[str, list[tuple[float, float]]] | None:
    """("ring" | "line", points) of a way or a relation's outer members."""
    if el["type"] == "way" and el.get("geometry"):
        pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
        return ("ring" if pts[0] == pts[-1] and len(pts) >= 4 else "line"), pts
    if el["type"] == "relation":
        pts = [p for line in osm_edges(el) for p in line]
        if len(pts) >= 3:
            return "ring", convex_hull(pts)
    return None


def extent_m(pts: list[tuple[float, float]]) -> float:
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    return distance_m((min(lons), min(lats)), (max(lons), max(lats)))


def outline(geometry: tuple[str, list[tuple[float, float]]] | None) -> dict[str, Any] | None:
    """The simplified outline the app tests the pin against, or None when it
    is a point or too large."""
    if geometry is None:
        return None
    kind, pts = geometry
    extent = extent_m(pts)
    if extent > MAX_PLACE_M:
        return {"type": "too_large"}
    if extent > MAX_OUTLINE_M:
        return None
    kx = 111320 * math.cos(math.radians(pts[0][1]))
    metres = [(x * kx, y * 110574) for x, y in pts]
    tolerance = 10.0
    kept = simplify(metres, tolerance)
    while len(kept) > MAX_OUTLINE_POINTS:
        tolerance *= 1.5
        kept = simplify(metres, tolerance)
    coords = [[round(x / kx, 5), round(y / 110574, 5)] for x, y in kept]
    if kind == "ring" and len(coords) < 4:
        return None
    return {"type": kind, "coords": coords}


#: How close OpenStreetMap's coastline must be: a lake's harbour or peninsula
#: (Silkeborg Havn, Arrenæs in Arresø) is no place for a seaweed card. A bay's
#: point lies out in the water, so it gets more room.
COASTLINE_M = 1500
COASTLINE_BAY_M = 6000


def _coast_radius(r: dict[str, Any]) -> int:
    return COASTLINE_BAY_M if r["kind"] == "bay" else COASTLINE_M


def _test_points(r: dict[str, Any]) -> list[tuple[float, float]]:
    pts = [p for line in r.get("_edges") or [] for p in line]
    step = max(1, len(pts) // 24)
    return [(r["lon"], r["lat"]), *pts[::step]]


def _bbox(r: dict[str, Any]) -> tuple[float, float, float, float]:
    """(south, west, north, east) of the place (point and outline), widened
    by its coast radius."""
    pts = [(r["lon"], r["lat"]), *(p for line in r.get("_edges") or [] for p in line)]
    pad_m = _coast_radius(r)
    dlat = pad_m / 110574
    dlon = pad_m / (111320 * math.cos(math.radians(r["lat"])))
    return (
        round(min(p[1] for p in pts) - dlat, 4),
        round(min(p[0] for p in pts) - dlon, 4),
        round(max(p[1] for p in pts) + dlat, 4),
        round(max(p[0] for p in pts) + dlon, 4),
    )


def coastlines(records: list[dict[str, Any]]) -> dict[str, list[list[tuple[float, float]]]]:
    """OpenStreetMap's coastline round each record (its box): one Overpass
    query per 0.25° cell of the places' points, so that a re-run only asks
    again for the cells whose places changed."""
    out: dict[str, list[list[tuple[float, float]]]] = {}
    cells: dict[tuple[int, int], list[dict[str, Any]]] = collections.defaultdict(list)
    for r in sorted(records, key=lambda r: r["id"]):
        cells[(math.floor(r["lon"] * 4), math.floor(r["lat"] * 4))].append(r)
    for _cell, batch in sorted(cells.items()):
        parts = "".join('way({},{},{},{})["natural"="coastline"];'.format(*_bbox(r)) for r in batch)
        lines = [
            [(g["lon"], g["lat"]) for g in el.get("geometry", [])]
            for el in overpass(f"({parts});out geom;")
        ]
        for r in batch:
            s, w, n, e = _bbox(r)
            out[r["id"]] = [
                line for line in lines if any(w <= p[0] <= e and s <= p[1] <= n for p in line)
            ]
    return out


# --- Danske Stednavne (the committed dev-sample cells) -------------------------


def stednavne_names() -> list[dict[str, Any]]:
    """Named places of the committed names cells, as name-match candidates."""
    out = []
    for path in sorted((SAMPLE_DATA_DIR / "names").glob("*.json")):
        for row in json.loads(path.read_text("utf-8"))["features"]:
            fid, kind, typ, coords, name = row[:5]
            group = STEDNAVNE_GROUP.get(kind)
            if not group:
                continue
            if typ == "p":
                point = (coords[0] / 1e5, coords[1] / 1e5)
            else:
                first = coords[0] if typ == "a" else coords
                point = (first[0] / 1e5, first[1] / 1e5)
            out.append(
                {"name": name, "point": point, "group": group, "stednavne": fid, "kind": kind}
            )
    return out


# --- Wikipedia and Commons ------------------------------------------------------


def extracts(lang: str, titles: list[str]) -> dict[str, str]:
    """Leads by sitelink title; ``image:<title>`` the free page image and
    ``redirect:<title>`` the article a redirecting sitelink lands on."""
    api = f"https://{lang}.wikipedia.org/w/api.php"
    out: dict[str, str] = {}
    for i in range(0, len(titles), 20):
        batch = titles[i : i + 20]
        res = fetch(
            api,
            {
                "action": "query",
                "prop": "extracts|pageimages",
                "exintro": 1,
                "explaintext": 1,
                "exlimit": 20,
                "piprop": "name",
                "pilicense": "free",
                "redirects": 1,
                "titles": "|".join(batch),
                "format": "json",
                "formatversion": 2,
            },
        )
        q = res.get("query", {})
        normalized = {n["to"]: n["from"] for n in q.get("normalized", [])}
        redirects = {r["to"]: r["from"] for r in q.get("redirects", [])}
        for page in q.get("pages", []):
            title = page.get("title", "")
            original = redirects.get(title, title)
            redirected = original != title
            original = normalized.get(original, original)
            if redirected:
                # the sitelink redirects: "Frederikshavn Havn" -> "Frederikshavn"
                out[f"redirect:{original}"] = title
            out[original] = page.get("extract") or ""
            if page.get("pageimage"):
                out[f"image:{original}"] = page["pageimage"]
    return out


def _imageinfo_pages(res: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    q = res.get("query", {})
    back = {n["to"]: n["from"] for n in q.get("normalized", [])}
    out = []
    for page in q.get("pages", []):
        info = (page.get("imageinfo") or [None])[0]
        if info:
            out.append((back.get(page["title"], page["title"]).removeprefix("File:"), info))
    return out


def _size(info: dict[str, Any]) -> tuple[str, int, int]:
    if info.get("thumburl"):
        return info["thumburl"], info.get("thumbwidth"), info.get("thumbheight")
    return info.get("url"), info.get("width"), info.get("height")


IIPROP = "url|size|extmetadata|user"


def commons_info(files: list[str]) -> dict[str, dict[str, Any]]:
    """imageinfo per file name (without "File:") at both thumbnail widths."""
    out: dict[str, dict[str, Any]] = {}
    for width in (SMALL_W, LARGE_W):
        for i in range(0, len(files), 50):
            batch = files[i : i + 50]
            res = fetch(
                COMMONS,
                {
                    "action": "query",
                    "prop": "imageinfo",
                    "iiprop": IIPROP,
                    "iiurlwidth": width,
                    "titles": "|".join(f"File:{f}" for f in batch),
                    "format": "json",
                    "formatversion": 2,
                },
            )
            for name, info in _imageinfo_pages(res):
                rec = out.setdefault(name, {"info": info})
                rec[width] = _size(info)
    return out


def category_files(category: str) -> dict[str, dict[str, Any]]:
    """imageinfo (960 px) of the files in a Commons category, the 330 px
    thumbnail taken from the same path (a standard step)."""
    res = fetch(
        COMMONS,
        {
            "action": "query",
            "generator": "categorymembers",
            "gcmtitle": f"Category:{category}",
            "gcmtype": "file",
            "gcmlimit": 50,
            "prop": "imageinfo",
            "iiprop": IIPROP,
            "iiurlwidth": LARGE_W,
            "format": "json",
            "formatversion": 2,
        },
    )
    out: dict[str, dict[str, Any]] = {}
    for name, info in _imageinfo_pages(res):
        url, w, h = _size(info)
        if not url or f"/{LARGE_W}px-" not in url:
            continue  # smaller than 960 px: too small to choose
        out[name] = {
            "info": info,
            LARGE_W: (url, w, h),
            SMALL_W: (url.replace(f"/{LARGE_W}px-", f"/{SMALL_W}px-"), SMALL_W, None),
        }
    return out


#: photo_record reasons after which a card may go on as text only (the
#: picture is there but unfit), unlike a licence or a missing file.
UNFIT = ("not a photo", "before ", "people ", "not the shore", "same photo")


def photo_record(name: str, info: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    meta = info["info"].get("extmetadata", {})

    def m(key: str) -> str:
        return (meta.get(key) or {}).get("value") or ""

    licence = allowed_licence(m("LicenseShortName"), m("LicenseUrl") or None)
    if not licence:
        return None, f"licence {m('LicenseShortName') or '?'}"
    if m("Restrictions").strip():
        return None, f"restrictions {m('Restrictions')}"
    reason = photo_meta_reason({k: m(k) for k in meta})
    if reason:
        return None, reason
    i = info["info"]
    if SMALL_W not in info or LARGE_W not in info:
        return None, "no thumbnail"
    large, lw, lh = info[LARGE_W]
    # the thumbnail's real width is in its URL ("960px-"); the height scales
    px = re.search(r"/(\d+)px-[^/]*$", large or "")
    if px and lw and lh:
        lw, lh = int(px.group(1)), round(lh * int(px.group(1)) / lw)
    return {
        "file": f"File:{name}",
        "page": i.get("descriptionurl"),
        "small": upload_url(info[SMALL_W][0]),
        "large": upload_url(large),
        "width": lw,
        "height": lh,
        "author": clean_author(m("Artist"), m("Credit"), i.get("user")),
        "license": licence,
        "license_url": licence_url(licence, m("LicenseUrl") or None),
    }, "ok"


def landscape(info: dict[str, Any]) -> bool:
    i = info["info"]
    return bool(i.get("width") and i.get("height") and i["width"] >= 1.2 * i["height"])


# --- overrides ----------------------------------------------------------------

#: Each override key and the type its value must have.
OVERRIDE_TYPES: dict[str, type] = {
    "name": str,
    "reason": str,
    "drop": bool,
    "photo": str,
    "no_photo": bool,
    "kind": str,
    "text": str,
}


def check_override(qid: str, o: Any) -> dict[str, Any]:
    """One entry of overrides.json, checked, with its photo as "File:<name>".
    Stops on: a key that is not a Wikidata id, unknown keys, a value of the
    wrong type (``"drop": "yes"``), no reason, an unknown kind, ``photo``
    and ``no_photo`` together, an empty photo."""

    def fail(why: str) -> SystemExit:
        return SystemExit(f"overrides.json {qid}: {why}")

    if not re.fullmatch(r"Q\d+", qid):
        raise fail("the key must be a Wikidata id (Q123)")
    if not isinstance(o, dict):
        raise fail("must be an object")
    unknown = set(o) - set(OVERRIDE_TYPES)
    if unknown:
        raise fail(f"unknown keys {sorted(unknown)}")
    for key, typ in OVERRIDE_TYPES.items():
        if key in o and not isinstance(o[key], typ):
            raise fail(f"{key} must be a {typ.__name__}, not {o[key]!r}")
    if not o.get("reason", "").strip():
        raise fail("needs a reason")
    if o.get("kind") and o["kind"] not in KIND_LABEL:
        raise fail(f"unknown kind {o['kind']}")
    if "photo" in o and o.get("no_photo"):
        raise fail("photo and no_photo together")
    out = dict(o)
    if "photo" in o:
        name = re.sub(r"^(File|Fil|Image):\s*", "", o["photo"].strip(), flags=re.IGNORECASE)
        if not name:
            raise fail("photo is empty")
        out["photo"] = f"File:{name}"
    return out


def load_overrides() -> dict[str, dict[str, Any]]:
    """data/places_info/overrides.json, every entry checked (check_override)."""
    if not OVERRIDES.exists():
        return {}
    doc = json.loads(OVERRIDES.read_text("utf-8"))
    return {qid: check_override(qid, o) for qid, o in doc["overrides"].items()}


# --- assembling -------------------------------------------------------------------


def in_denmark(p: tuple[float, float]) -> bool:
    return DK_BBOX[0] <= p[0] <= DK_BBOX[2] and DK_BBOX[1] <= p[1] <= DK_BBOX[3]


def leave_out(left_out: list[dict[str, str]], r: dict[str, Any], name: str, why: str) -> None:
    left_out.append({"id": r["id"], "name": name, "kind": r["kind"], "why": why})


def main() -> None:
    global OFFLINE
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--offline", action="store_true", help="use the cache only")
    OFFLINE = parser.parse_args().offline
    overrides = load_overrides()

    print("wikidata")
    items = wikidata_items()
    details = wikidata_details(sorted(items))
    for qid in sorted(set(overrides) - set(items)):
        name = overrides[qid].get("name") or "?"
        print(f"  WARNING overrides.json {qid} ({name}) matches no Wikidata item", file=sys.stderr)
    stats: collections.Counter[str] = collections.Counter()
    left_out: list[dict[str, str]] = []
    candidates = []
    for rec in items.values():
        label = rec.get("da_label") or rec.get("en_label") or ""
        d = details[rec["id"]]
        override = overrides.get(rec["id"], {})
        rec["kind"] = override.get("kind") or classify_kind(d["p31"], rec["kinds"], label)
        rec["commons_category"] = d["commons_category"]
        closed = non_public_class(d["p31_labels"])
        if not in_denmark(rec["point"]):
            stats["outside Denmark"] += 1
        elif is_station(label):
            stats["bathing-water station"] += 1
        elif rec.get("ended"):
            stats["dissolved (P576)"] += 1
        elif override.get("drop"):
            stats["dropped by override"] += 1
            leave_out(left_out, rec, label, f"override: {override['reason']}")
        elif closed:
            stats["non-public class"] += 1
            leave_out(left_out, rec, label, f"class: {closed}")
        else:
            candidates.append(rec)
    print(f"  {len(items)} items, {len(candidates)} candidates")

    print("openstreetmap")
    osm = osm_features()
    by_qid: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for f in osm:
        if f["wikidata"]:
            by_qid[f["wikidata"]].append(f)
    named = [f for f in osm if f["name"]]
    places = [f for f in osm if f["groups"] & {"beach", "harbour", "marina"}]
    sted = stednavne_names()
    print(f"  {len(osm)} coast features, {len(by_qid)} items tagged, {len(sted)} stednavne")

    print("wikipedia")
    da_titles = [r["da_title"] for r in candidates if r.get("da_title")]
    en_titles = [r["en_title"] for r in candidates if r.get("en_title") and not r.get("da_title")]
    leads = {"da": extracts("da", da_titles), "en": extracts("en", en_titles)}

    print("commons")
    files: dict[str, str] = {}
    for r in candidates:
        if r.get("image"):
            files[r["id"]] = urllib.parse.unquote(r["image"].rsplit("/", 1)[-1]).replace("_", " ")
    # the article's free page image for items without (a usable) P18
    fallback: dict[str, str] = {}
    for r in candidates:
        lang = "da" if r.get("da_title") else "en"
        title = r.get(f"{lang}_title")
        image = leads[lang].get(f"image:{title}") if title else None
        if image and not leads[lang].get(f"redirect:{title}"):
            fallback[r["id"]] = image.replace("_", " ")
    chosen = {
        qid: o["photo"].removeprefix("File:") for qid, o in overrides.items() if o.get("photo")
    }
    wanted = set(files.values()) | set(fallback.values()) | set(chosen.values())
    infos = commons_info(sorted(wanted))

    existing = {}
    if OUT.exists():
        existing = {r["id"]: r for r in json.loads(OUT.read_text("utf-8"))}
    records = []
    dropped_examples: list[dict[str, str]] = []
    for r in sorted(candidates, key=lambda r: r["id"]):
        old = existing.get(r["id"])
        override = overrides.get(r["id"], {})
        if old and (old.get("reviewed") or old.get("rejected")):
            records.append(old)
            stats["kept as reviewed"] += 1
            continue
        kind = r["kind"]
        group = KIND_GROUP[kind]
        label = override.get("name") or (
            r.get("da_label") or r.get("da_title") or r.get("en_label") or r["id"]
        )
        # the match: an OSM feature tagged with the item (of the same kind
        # group, for a harbour or a marina), else one of the same name and
        # kind group (OSM, then Danske Stednavne) within 1 km
        match: dict[str, Any] | None = None
        point = r["point"]
        tagged = [
            f
            for f in by_qid.get(r["id"], [])
            if group not in ("harbour", "marina") or group in f["groups"]
        ]
        if tagged:
            f = min(tagged, key=lambda f: distance_m(point, f["point"]))
            match = {
                "by": "osm_wikidata",
                "osm": f["osm"],
                "osm_name": f["name"] or None,
                "osm_kind": f["kind"],
                "distance_m": round(distance_m(point, f["point"])),
            }
            if f["name"] and not r.get("da_label") and not override.get("name"):
                label = f["name"]
        else:
            names = [n for n in (r.get("da_label"), r.get("en_label"), r.get("da_title")) if n]
            for source, pool in (("osm_name", named), ("stednavne_name", sted)):
                hit = next(
                    (h for n in names if (h := match_by_name(n, point, group, pool)) is not None),
                    None,
                )
                if hit:
                    match = {
                        "by": source,
                        **{k: hit[k] for k in ("osm", "stednavne") if k in hit},
                        "matched_name": hit["name"],
                        "osm_kind": hit["kind"],
                        "distance_m": hit["distance_m"],
                    }
                    if not r.get("da_label") and not override.get("name"):
                        label = hit["name"]
                    break
            if match is None and group in ("beach", "harbour", "marina"):
                # unnamed, or of the item's name: never the bare town name
                # ("Gedser") or the town's marina ("Nyborg Marina")
                near = [
                    (distance_m(point, f["point"]), f)
                    for f in places
                    if group in f["groups"]
                    and (not f["name"] or any(same_name(n, f["name"]) for n in names))
                ]
                d, f = min(near, key=lambda x: x[0], default=(1e9, None))
                if f is not None and d <= NEARBY_M:
                    match = {
                        "by": "osm_nearby",
                        "osm": f["osm"],
                        "osm_kind": f["kind"],
                        "distance_m": round(d),
                    }
            if match is None and kind in ("headland", "spit"):
                # a headland's or spit's own point (Blåvands Huk: OpenStreetMap
                # maps no cape there); the coast check wants the coastline
                # within 300 m of it
                match = {"by": "wikidata_point", "distance_m": 0}
        if match is None:
            stats[f"no match: {kind}"] += 1
            leave_out(left_out, r, label, "no match")
            continue
        stats[f"matched {match['by']}"] += 1

        # the text: the lead, unless the sitelink redirects to another article
        description, source, article, dropped = None, None, None, []
        lang = "da" if r.get("da_title") else ("en" if r.get("en_title") else None)
        if lang:
            title = r[f"{lang}_title"]
            target = leads[lang].get(f"redirect:{title}")
            if target:
                stats["wikipedia redirect (no text)"] += 1
                dropped.append({"sentence": f"(redirects to {target})", "reason": "redirect"})
            else:
                lead = leads[lang].get(title, "")
                if override.get("text"):
                    description = text_from_override(override["text"], lead)
                    if description is None:
                        raise SystemExit(f"overrides.json {r['id']}: text is not from the lead")
                else:
                    description, dropped = lead_sentences(lead)
                article = {
                    "title": title,
                    "lang": lang,
                    "url": f"https://{lang}.wikipedia.org/wiki/"
                    + urllib.parse.quote(title.replace(" ", "_")),
                    "license": "CC BY-SA 4.0",
                }
                if description:
                    source = f"wikipedia_{lang}"
        for d in dropped:
            stats[f"dropped sentence: {d['reason']}"] += 1
            dropped_examples.append({"place": label, **d})
        if not description:
            description = wikidata_sentence(label, r.get("da_desc"))
            source = "wikidata" if description else None
        if not source:
            stats["skipped: no text"] += 1
            leave_out(left_out, r, label, "no text")
            continue

        # the photo: the override's, else P18, else the page image
        photo, why, tried, unfit = None, "no photo", [], False
        if override.get("no_photo"):
            why = "no_photo override"
        else:
            options = [chosen[r["id"]]] if r["id"] in chosen else []
            options += [files.get(r["id"]), fallback.get(r["id"])]
            for file in options:
                if not file or file in tried:
                    continue
                tried.append(file)
                if not photo_file_ok(file):
                    why, unfit = "not a photo (file name)", True
                    continue
                if file not in infos:
                    why = "not on commons"
                    continue
                photo, why = photo_record(file, infos[file])
                if photo:
                    break
                if r["id"] in chosen:
                    raise SystemExit(f"overrides.json {r['id']}: photo rejected: {why}")
                unfit = unfit or why.startswith(UNFIT)
        p = point
        if match["by"] == "osm_wikidata":
            f = min(tagged, key=lambda f: distance_m(point, f["point"]))
            if far_marina(kind, f, match["distance_m"]):
                # a harbour tagged on a marina far off (Esbjerg Havn: the
                # marina 1 km from the port): the item's own point, and not
                # the marina's outline
                match["point"] = "wikidata"
            else:
                p = f["point"]
        records.append(
            {
                "id": r["id"],
                "name": label,
                "kind": kind,
                "kind_label": KIND_LABEL[kind],
                "lon": round(p[0], 5),
                "lat": round(p[1], 5),
                "geom": None,
                "match": match,
                "description": description,
                "description_source": source,
                "dropped_sentences": dropped,
                "wikidata": f"https://www.wikidata.org/wiki/{r['id']}",
                "article": article,
                "photo": photo,
                "photo_rejected": None if photo else why,
                "_tried": tried,
                "_unfit": unfit,
                "_category": r.get("commons_category"),
                "_p18": files.get(r["id"]),
                "_pinned_photo": r["id"] in chosen,
                "_wikidata_point": point,
                "_no_photo": bool(override.get("no_photo")),
                "fetched": TODAY,
                "reviewed": False,
            }
        )

    fresh = [r for r in records if not r.get("reviewed")]
    # a photo for the cards whose own were all rejected (the photos shared
    # with a card nearby wait until the cards left out are gone)
    fill_from_category(fresh, [], stats)

    # the outline of the matched OpenStreetMap way or relation (not of a
    # marina far from a harbour's own point)
    outlined = [r for r in fresh if r["match"].get("osm") and r["match"].get("point") != "wikidata"]
    geoms = osm_geometries(sorted({r["match"]["osm"] for r in outlined}))
    for r in fresh:
        if r["match"].get("point") == "wikidata":
            r["_edges"], r["geom"] = [], None
            continue
        el = geoms.get(r["match"].get("osm") or "")
        r["_edges"] = osm_edges(el) if el else []
        r["geom"] = outline(osm_geometry(el)) if el else None
        if r["geom"] and r["geom"]["type"] == "too_large":
            r["geom"] = None
            r["_too_large"] = True

    # by the sea, not a lake: OpenStreetMap's coastline near the place; a
    # peninsula's or islet's card shows only near its shore
    coast = coastlines([r for r in fresh if not r.get("_too_large")])
    kept = []
    for r in records:
        why = None
        if r.get("reviewed"):
            pass
        elif r.get("_too_large"):
            why = f"too large (over {MAX_PLACE_M // 1000} km)"
        elif not r["photo"] and not (r["_unfit"] or r["_no_photo"]):
            why = f"no photo ({r['photo_rejected']})"
        else:
            why = coast_check(r, coast.get(r["id"], []))
        if why:
            stats[f"{why.split(' (')[0]}: {r['kind']}"] += 1
            leave_out(left_out, r, r["name"], why)
            continue
        kept.append(r)
    # the same photo on two cards nearby, among the cards kept only
    fresh = [r for r in kept if not r.get("reviewed")]
    lost = dedupe_photos(fresh, stats)
    if lost:
        fill_from_category(fresh, lost, stats)
    for r in kept:
        for k in [k for k in r if k.startswith("_")]:
            r.pop(k)
        r["match"].pop("point", None)
    records = kept
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # LF on every system: the committed file is compared line by line
    text = json.dumps(records, indent=1, ensure_ascii=False) + "\n"
    OUT.write_text(text, encoding="utf-8", newline="\n")
    kinds = collections.Counter(r["kind"] for r in records)
    print(f"{len(records)} cards -> {OUT.relative_to(REPO_ROOT)}")
    for k, n in kinds.most_common():
        print(f"  {k:16} {n}")
    print(f"  text only (no photo): {sum(1 for r in records if not r['photo'])}")
    print(f"  with a shore: {sum(1 for r in records if r.get('shore'))}")
    for k, n in sorted(stats.items()):
        print(f"  {k:48} {n}")
    report = REPO_ROOT / "build" / "placeinfo" / "dropped_sentences.json"
    report.write_text(json.dumps(dropped_examples, indent=1, ensure_ascii=False), "utf-8")
    report = REPO_ROOT / "build" / "placeinfo" / "left_out.json"
    report.write_text(json.dumps(left_out, indent=1, ensure_ascii=False), "utf-8")


def far_marina(kind: str, f: dict[str, Any], distance: float) -> bool:
    """Whether the OpenStreetMap feature tagged with a harbour item is a
    marina far from the item's point: then the item's point stands."""
    return KIND_GROUP[kind] == "harbour" and f["kind"] == "marina" and distance > FAR_MARINA_M


def dedupe_photos(
    records: list[dict[str, Any]], stats: collections.Counter
) -> list[dict[str, Any]]:
    """The same photo on two cards nearby (Odense Fjord and Tornø): one keeps
    it, the others lose it (text only, unless their category has another:
    fill_from_category). Run on the cards that are kept, so a card left out
    never takes a photo from one that stays. Returns the cards that lost it."""

    # who keeps it, in this order: the card whose own P18 it is and whose
    # name the file names, then the card whose own P18 it is, then the card
    # the file names; among those, the name the file names first
    # ("Tornoe Odense Fjord.jpg" is Tornø's, not Odense Fjord's), then by id
    def keeps_first(r: dict[str, Any]) -> tuple[bool, bool, int, str]:
        file = (r.get("photo") or {}).get("file", "")
        own = file == f"File:{r.get('_p18')}"
        core = name_core(r["name"])
        at = name_core(file.removeprefix("File:").rsplit(".", 1)[0]).find(core) if core else -1
        return (not own, at < 0, at if at >= 0 else 999, r["id"])

    kept: list[dict[str, Any]] = []
    lost: list[dict[str, Any]] = []
    for r in sorted(records, key=keeps_first):
        photo = r.get("photo")
        if not photo:
            continue
        nearby = [
            o
            for o in kept
            if o["photo"]["file"] == photo["file"]
            and distance_m((r["lon"], r["lat"]), (o["lon"], o["lat"])) < SAME_PHOTO_M
        ]
        if nearby and not r.get("_pinned_photo"):
            file = photo["file"].removeprefix("File:")
            r["photo"], r["photo_rejected"] = None, f"same photo as {nearby[0]['name']} ({file})"
            r.pop("photo_from", None)
            r["_unfit"] = True
            r["_tried"].append(file)
            stats["photo: shared with a card nearby"] += 1
            lost.append(r)
        else:
            kept.append(r)
    return lost


def fill_from_category(
    records: list[dict[str, Any]], only: list[dict[str, Any]], stats: collections.Counter
) -> None:
    """A photo for the cards whose own were rejected (a map, a painting, a
    crowd), or, given ``only``, for those cards (which lost theirs to a card
    nearby): the first landscape photo (one named after the place first) in
    the item's Commons category that
    passes the same checks and that no card nearby in ``records`` shows;
    else the card goes on as text only."""

    def used_nearby(r: dict[str, Any], file: str) -> bool:
        return any(
            o is not r
            and o.get("photo")
            and o["photo"]["file"] == f"File:{file}"
            and distance_m((r["lon"], r["lat"]), (o["lon"], o["lat"])) < SAME_PHOTO_M
            for o in records
        )

    for r in only or records:
        if r.get("photo") or r.get("_no_photo") or not r["_tried"]:
            continue
        if r.get("_category"):
            # a file named after the place first ("Odense Fjord 01.jpg" before
            # "Huset for enden af Vigerøvej.jpg"), then by name
            core = name_core(r["name"])
            files = sorted(
                category_files(r["_category"]).items(),
                key=lambda kv: (not core or core not in name_core(kv[0].rsplit(".", 1)[0]), kv[0]),
            )
            for name, info in files:
                if name in r["_tried"] or not photo_file_ok(name) or not landscape(info):
                    continue
                if only and used_nearby(r, name):
                    continue
                photo, _why = photo_record(name, info)
                if photo:
                    r["photo"], r["photo_rejected"] = photo, None
                    r["photo_from"] = f"Category:{r['_category']}"
                    stats["photo: from the Commons category"] += 1
                    break
        if not r.get("photo"):
            stats["photo: none fit (text only)"] += 1


def coast_check(r: dict[str, Any], lines: list[list[tuple[float, float]]]) -> str | None:
    """Why a record is not a coast place (None when it is). A peninsula or
    islet gets its shore (``r["shore"]``) in place of its outline, and a bay
    with a point only the coastline round its point that can be seen from it
    (placeinfo.bay_shore)."""
    p = (r["lon"], r["lat"])
    edges = r.get("_edges") or []
    pts = [q for line in edges for q in line]
    big = r["kind"] in SHORE_KINDS or (
        r["kind"] in ("headland", "spit", "cliff") and pts and extent_m(pts) > SHORE_EXTENT_M
    )
    if big and len(pts) >= 3:
        shore = shore_lines(edges, lines)
        if not shore:
            return "inland (no coastline along the outline)"
        r["shore"] = simplify_lines(shore)
        r["geom"] = None
        return None
    if r["kind"] == "bay" and r["geom"] is None:
        # a big bay with a point only (Faxe Bugt, Kalø Vig): its point is
        # Wikidata's, out in the water (OpenStreetMap's centre of a bay's
        # outline can lie on land), and its shore the coastline round it
        wp = r["_wikidata_point"]
        r["lon"], r["lat"] = round(wp[0], 5), round(wp[1], 5)
        near, off = bay_shore(lines, wp)
        if not near:
            return f"bay point ({off:.0f} m from the coastline, over {BAY_POINT_MAX_M} m)"
        r["shore"] = simplify_lines(near)
        return None
    index = SegmentIndex(lines, p[1]) if lines else None
    reach = _coast_radius(r)
    if index is None or not any(index.nearest_m(q, reach) <= reach for q in _test_points(r)):
        return "inland (no coastline near)"
    # a point only: it must lie at the coast, not 2 km inland on a peninsula
    if r["geom"] is None and index.nearest_m(p, SHORE_RADIUS_M) > SHORE_RADIUS_M:
        return f"point inland (over {SHORE_RADIUS_M} m from the coastline)"
    return None


if __name__ == "__main__":
    main()
