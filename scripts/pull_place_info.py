"""Seed the place cards: data/places_info/places_info.json (see its README).

A well-known Danish beach, harbour, marina, headland, spit, cliff, bay or islet
gets a card when open sources say something about it and show it:

- **Wikidata** (CC0): the places, their kind (P31/P279*), coordinates (P625),
  photo (P18) and Danish Wikipedia article. One SPARQL query per class.
- **Danish Wikipedia** (English only without a Danish article): the lead,
  trimmed to one or two sentences at a sentence boundary, run through the
  safety filter (pipeline/placeinfo.py). Text licence CC BY-SA 4.0.
- **Wikimedia Commons**: the photo (P18, else the article's free page image),
  only under CC0, public domain, CC BY or CC BY-SA, read from ``extmetadata``;
  thumbnails at about 320 and 800 px, hotlinked from upload.wikimedia.org.
- **OpenStreetMap** via the Overpass API (ODbL): the features tagged
  ``wikidata=<item>`` (the match, the point and the outline), else a beach,
  harbour, marina, cape ... of the same name within 1 km; and the committed
  Danske Stednavne cells (web/public/data/names) for a name match inside the
  dev sample. Only places that match one of the app's coast features are kept.

    py -3.10 scripts/pull_place_info.py            # fetch (cached) and write
    py -3.10 scripts/pull_place_info.py --offline  # from the cache only

Raw responses are cached under build/placeinfo/cache (git-ignored), so a
re-run is fast and does not touch the APIs. Requests are throttled and carry a
descriptive User-Agent. A content-authoring tool, not part of the pipeline:
the build only reads the committed file. Records the owner has reviewed or
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
    KIND_GROUP,
    KIND_LABEL,
    STEDNAVNE_GROUP,
    WIKIDATA_CLASSES,
    allowed_licence,
    convex_hull,
    distance_m,
    is_station,
    lead_sentences,
    licence_url,
    match_by_name,
    osm_kind,
    photo_file_ok,
    pick_kind,
    strip_html,
    upload_url,
    wikidata_sentence,
)

USER_AGENT = "Tangkortet-data-script/1.0 (+https://github.com/jmj00/Tangkortet)"
CACHE = REPO_ROOT / "build" / "placeinfo" / "cache"
OUT = REPO_ROOT / "data" / "places_info" / "places_info.json"
SPARQL = "https://query.wikidata.org/sparql"
OVERPASS = "https://overpass-api.de/api/interpreter"
COMMONS = "https://commons.wikimedia.org/w/api.php"
THROTTLE_S = 1.0
SMALL_W, LARGE_W = 320, 800
#: An outline larger than this (its bounding box's diagonal) is dropped and
#: the card keeps only its point: a pin anywhere in a big bay is not "at" it.
MAX_OUTLINE_M = 12000
#: Larger still (Kattegat, Jylland, Køge Bugt), the place gets no card at all.
MAX_PLACE_M = 25000
MAX_OUTLINE_POINTS = 60

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
#: mapped this close to its Wikidata point stands for it.
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


def osm_geometry(el: dict[str, Any]) -> tuple[str, list[tuple[float, float]]] | None:
    """("ring" | "line", points) of a way or a relation's outer members."""
    if el["type"] == "way" and el.get("geometry"):
        pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
        return ("ring" if pts[0] == pts[-1] and len(pts) >= 4 else "line"), pts
    if el["type"] == "relation":
        pts = [
            (g["lon"], g["lat"])
            for m in el.get("members", [])
            if m.get("role") in ("outer", "") and m.get("geometry")
            for g in m["geometry"]
        ]
        if len(pts) >= 3:
            return "ring", convex_hull(pts)
    return None


def outline(geometry: tuple[str, list[tuple[float, float]]] | None) -> dict[str, Any] | None:
    """The simplified outline the app tests the pin against, or None when it
    is a point or too large."""
    if geometry is None:
        return None
    kind, pts = geometry
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    extent = distance_m((min(lons), min(lats)), (max(lons), max(lats)))
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


def _segment_m(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    kx = 111320 * math.cos(math.radians(p[1]))
    ax, ay, bx, by = (
        (a[0] - p[0]) * kx,
        (a[1] - p[1]) * 110574,
        (b[0] - p[0]) * kx,
        (b[1] - p[1]) * 110574,
    )
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
    return math.hypot(ax + t * dx, ay + t * dy)


def _coast_radius(r: dict[str, Any]) -> int:
    return COASTLINE_BAY_M if r["kind"] == "bay" else COASTLINE_M


def _test_points(r: dict[str, Any]) -> list[tuple[float, float]]:
    coords = (r.get("geom") or {}).get("coords") or []
    step = max(1, len(coords) // 12)
    return [(r["lon"], r["lat"]), *(tuple(c) for c in coords[::step])]


def _query_radius(r: dict[str, Any]) -> int:
    p = (r["lon"], r["lat"])
    reach = max((distance_m(p, q) for q in _test_points(r)), default=0.0)
    return round(_coast_radius(r) + reach)


def near_coastline(records: list[dict[str, Any]]) -> set[str]:
    """The ids of the records with OpenStreetMap's coastline within reach;
    20 places per Overpass query, the distances measured here."""
    ok: set[str] = set()
    for i in range(0, len(records), 20):
        batch = records[i : i + 20]
        # around the point and the outline's corners (a peninsula's centre
        # can lie far inland; its shore is the coast)
        # (a polyline "around" of the corners lost results on Overpass, so
        # the circle round the point is widened to take in the outline)
        parts = "".join(
            f'way(around:{_query_radius(r)},{r["lat"]},{r["lon"]})["natural"="coastline"];'
            for r in batch
        )
        lines = [
            [(g["lon"], g["lat"]) for g in el.get("geometry", [])]
            for el in overpass(f"({parts});out geom;")
        ]
        for r in batch:
            radius = _coast_radius(r)
            if any(
                _segment_m(p, a, b) <= radius
                for p in _test_points(r)
                for line in lines
                for a, b in zip(line, line[1:], strict=False)
            ):
                ok.add(r["id"])
    return ok


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
        back = {r["to"]: r["from"] for r in q.get("redirects", []) + q.get("normalized", [])}
        for page in q.get("pages", []):
            title = page.get("title", "")
            original = back.get(title, title)
            original = back.get(original, original)
            out[original] = page.get("extract") or ""
            if page.get("pageimage"):
                out[f"image:{original}"] = page["pageimage"]
    return out


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
                    "iiprop": "url|size|extmetadata",
                    "iiurlwidth": width,
                    "titles": "|".join(f"File:{f}" for f in batch),
                    "format": "json",
                    "formatversion": 2,
                },
            )
            q = res.get("query", {})
            back = {n["to"]: n["from"] for n in q.get("normalized", [])}
            for page in q.get("pages", []):
                info = (page.get("imageinfo") or [None])[0]
                if not info:
                    continue
                name = back.get(page["title"], page["title"]).removeprefix("File:")
                rec = out.setdefault(name, {"info": info})
                if info.get("thumburl"):
                    size = (info["thumburl"], info.get("thumbwidth"), info.get("thumbheight"))
                else:
                    size = (info.get("url"), info.get("width"), info.get("height"))
                rec[width] = size
    return out


def photo_record(name: str, info: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    meta = info["info"].get("extmetadata", {})

    def m(key: str) -> str:
        return (meta.get(key) or {}).get("value") or ""

    licence = allowed_licence(m("LicenseShortName"))
    if not licence:
        return None, f"licence {m('LicenseShortName') or '?'}"
    if m("Restrictions").strip():
        return None, f"restrictions {m('Restrictions')}"
    author = strip_html(m("Artist")) or strip_html(m("Credit")) or "ukendt"
    if len(author) > 80:
        author = author[:77].rsplit(" ", 1)[0] + " …"
    i = info["info"]
    if SMALL_W not in info or LARGE_W not in info:
        return None, "no thumbnail"
    return {
        "file": f"File:{name}",
        "page": i.get("descriptionurl"),
        "small": upload_url(info[SMALL_W][0]),
        "large": upload_url(info[LARGE_W][0]),
        "width": info[LARGE_W][1],
        "height": info[LARGE_W][2],
        "author": author,
        "license": licence,
        "license_url": licence_url(licence, m("LicenseUrl") or None),
    }, "ok"


# --- assembling -------------------------------------------------------------------


def in_denmark(p: tuple[float, float]) -> bool:
    return DK_BBOX[0] <= p[0] <= DK_BBOX[2] and DK_BBOX[1] <= p[1] <= DK_BBOX[3]


def main() -> None:
    global OFFLINE
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--offline", action="store_true", help="use the cache only")
    OFFLINE = parser.parse_args().offline

    print("wikidata")
    items = wikidata_items()
    stats: collections.Counter[str] = collections.Counter()
    candidates = []
    for rec in items.values():
        rec["kind"] = pick_kind(rec["kinds"])
        label = rec.get("da_label") or rec.get("en_label") or ""
        if not in_denmark(rec["point"]):
            stats["outside Denmark"] += 1
        elif is_station(label):
            stats["bathing-water station"] += 1
        elif rec.get("ended"):
            stats["dissolved (P576)"] += 1
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
    places = [f for f in osm if f["group"] in ("beach", "harbour")]
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
    infos = commons_info(sorted(set(files.values())))
    # the article's free page image for items without (a usable) P18
    fallback: dict[str, str] = {}
    for r in candidates:
        lang = "da" if r.get("da_title") else "en"
        title = r.get(f"{lang}_title")
        image = leads[lang].get(f"image:{title}") if title else None
        if image:
            fallback[r["id"]] = image.replace("_", " ")
    infos.update(commons_info(sorted(set(fallback.values()) - set(infos))))

    existing = {}
    if OUT.exists():
        existing = {r["id"]: r for r in json.loads(OUT.read_text("utf-8"))}
    records = []
    dropped_examples: list[dict[str, str]] = []
    left_out: list[dict[str, str]] = []
    for r in sorted(candidates, key=lambda r: r["id"]):
        old = existing.get(r["id"])
        if old and (old.get("reviewed") or old.get("rejected")):
            records.append(old)
            stats["kept as reviewed"] += 1
            continue
        kind = r["kind"]
        label = r.get("da_label") or r.get("da_title") or r.get("en_label") or r["id"]
        # the match: an OSM feature tagged with the item, else the same name
        # (OSM, then Danske Stednavne) within 1 km
        match: dict[str, Any] | None = None
        point = r["point"]
        tagged = by_qid.get(r["id"], [])
        if tagged:
            f = min(tagged, key=lambda f: distance_m(point, f["point"]))
            match = {
                "by": "osm_wikidata",
                "osm": f["osm"],
                "osm_name": f["name"] or None,
                "distance_m": round(distance_m(point, f["point"])),
            }
            if f["name"] and not r.get("da_label"):
                label = f["name"]
        else:
            names = [n for n in (r.get("da_label"), r.get("en_label"), r.get("da_title")) if n]
            for source, pool in (("osm_name", named), ("stednavne_name", sted)):
                hit = next(
                    (
                        h
                        for n in names
                        if (h := match_by_name(n, point, KIND_GROUP[kind], pool)) is not None
                    ),
                    None,
                )
                if hit:
                    match = {
                        "by": source,
                        **{k: hit[k] for k in ("osm", "stednavne") if k in hit},
                        "matched_name": hit["name"],
                        "distance_m": hit["distance_m"],
                    }
                    if not r.get("da_label"):
                        label = hit["name"]
                    break
            if match is None and KIND_GROUP[kind] in ("beach", "harbour"):
                near = [
                    (distance_m(point, f["point"]), f)
                    for f in places
                    if f["group"] == KIND_GROUP[kind]
                ]
                d, f = min(near, key=lambda x: x[0], default=(1e9, None))
                if f is not None and d <= NEARBY_M:
                    match = {"by": "osm_nearby", "osm": f["osm"], "distance_m": round(d)}
        if match is None:
            stats[f"no match: {kind}"] += 1
            left_out.append({"id": r["id"], "name": label, "kind": kind, "why": "no match"})
            continue
        stats[f"matched {match['by']}"] += 1

        # the text
        description, source, article, dropped = None, None, None, []
        lang = "da" if r.get("da_title") else ("en" if r.get("en_title") else None)
        if lang:
            title = r[f"{lang}_title"]
            description, dropped = lead_sentences(leads[lang].get(title, ""))
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

        # the photo
        photo, why = None, "no photo"
        for file in (files.get(r["id"]), fallback.get(r["id"])):
            if not file:
                continue
            if not photo_file_ok(file):
                why = "not a photo"
                continue
            if file not in infos:
                why = "not on commons"
                continue
            photo, why = photo_record(file, infos[file])
            if photo:
                break
        if photo is None:
            stats[f"photo rejected: {why.split(' ')[0]}"] += 1

        good_text = source and source.startswith("wikipedia")
        if not photo or not (good_text or source == "wikidata"):
            why = f"no photo ({why})" if not photo else "no text"
            stats[f"skipped: {why.split(' (')[0]}"] += 1
            left_out.append({"id": r["id"], "name": label, "kind": kind, "why": why})
            continue
        p = point
        if match["by"] == "osm_wikidata":
            p = min(tagged, key=lambda f: distance_m(point, f["point"]))["point"]
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
                "fetched": TODAY,
                "reviewed": False,
            }
        )
    # the outline of the matched OpenStreetMap way or relation
    fresh = [r for r in records if not r.get("reviewed") and r["match"].get("osm")]
    geoms = osm_geometries(sorted({r["match"]["osm"] for r in fresh}))
    for r in fresh:
        el = geoms.get(r["match"]["osm"])
        r["geom"] = outline(osm_geometry(el)) if el else None
        if r["geom"] and r["geom"]["type"] == "too_large":
            r["geom"] = None
            r["too_large"] = True
    # by the sea, not a lake: OpenStreetMap's coastline near the place
    kept = []
    coastal = near_coastline([r for r in records if not r.get("reviewed")])
    for r in records:
        if r.pop("too_large", False):
            # Kattegat, Jylland, Køge Bugt: no single spot to be "at"
            stats[f"too large (over {MAX_PLACE_M // 1000} km): {r['kind']}"] += 1
            left_out.append(
                {"id": r["id"], "name": r["name"], "kind": r["kind"], "why": "too large"}
            )
        elif r.get("reviewed") or r["id"] in coastal:
            kept.append(r)
        else:
            stats[f"inland (no coastline near): {r['kind']}"] += 1
            left_out.append({"id": r["id"], "name": r["name"], "kind": r["kind"], "why": "inland"})
    records = kept
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(records, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    kinds = collections.Counter(r["kind"] for r in records)
    print(f"{len(records)} cards -> {OUT.relative_to(REPO_ROOT)}")
    for k, n in kinds.most_common():
        print(f"  {k:16} {n}")
    for k, n in sorted(stats.items()):
        print(f"  {k:32} {n}")
    report = REPO_ROOT / "build" / "placeinfo" / "dropped_sentences.json"
    report.write_text(json.dumps(dropped_examples, indent=1, ensure_ascii=False), "utf-8")
    report = REPO_ROOT / "build" / "placeinfo" / "left_out.json"
    report.write_text(json.dumps(left_out, indent=1, ensure_ascii=False), "utf-8")


if __name__ == "__main__":
    main()
