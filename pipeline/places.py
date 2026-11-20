"""The place index for the search box (web/src/data/places.json, placeindex.ts).

Adressevælgeren, the address service, knows streets and house numbers only, and
Tangkortet has no Datafordeler key yet anyway. So the app carries its own list
of places it can fly to without any service:

- towns, parts of towns and holiday-home areas (Danske Stednavne,
  ``sn:Bebyggelse``) and postal districts (DAGI ``Postnummerinddeling``), both
  Klimadatastyrelsen, CC BY 4.0. They are read from a file in Svampekortet's
  ``places.json`` layout (``--towns``; Svampekortet 624fb8b builds it with
  ``web/scripts/gen-places.mjs`` from Datafordeler). Without ``--towns`` the
  towns and districts already in the output are kept, so refreshing the coast
  needs no key;
- named coastal bathing sites (Miljøstyrelsen, MiljøGIS ``vp4basis2026``
  badevand, CC BY 4.0), fetched anonymously: the beaches a forager names;
- official coastal names (Danske Stednavne, Klimadatastyrelsen, CC BY 4.0):
  beaches, harbours, landforms (pynt, næs, odde, ø ...) and waters (bugt,
  fjord, sund ...), from the file ``pipeline.ingest.stednavne`` writes
  (``--names``). Without ``--names`` the ones already in the output are kept.
  A beach of the same name as a bathing site within 2 km is left out (the
  bathing site says it already).

Run by hand (postal districts change a few times a year, bathing sites yearly)::

    py -m pipeline.places [--towns PATH] [--names PATH] [--out web/src/data/places.json]
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path
from typing import Any

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "web" / "src" / "data" / "places.json"

ABOUT = (
    "Byer, bydele og sommerhusområder (Danske Stednavne, sn:Bebyggelse) og postnumre "
    "(DAGI Postnummerinddeling), Klimadatastyrelsen, CC BY 4.0; badesteder ved kysten "
    "(Miljøstyrelsen, MiljøGIS vp4basis2026 badevand, CC BY 4.0); strande, havne, "
    "pynter, næs, øer og farvande (Danske Stednavne, Klimadatastyrelsen, CC BY 4.0). "
    "Lavet af pipeline/places.py."
)

#: The Stednavne groups the search offers (pipeline/ingest/stednavne.py
#: GROUPS); shore areas, shallow stones and sea baths are only for the card.
NAME_GROUPS = ("beach", "harbour", "landform", "water")

# Small words that stay lower case inside a name ("Syd for Marbækgaard").
_SMALL = {"ved", "v", "for", "og", "fra", "til", "i", "på", "af", "med", "mod", "ud", "mellem"}
# Abbreviations spelled out where they are unambiguous.
_EXPAND = {"str": "Strand", "camp": "Camping", "off": "Offentlig"}
# Compass abbreviations, where they are directions ("200 M. Ø. F. BØNNERUP HAVN").
_DIRS = {
    "N": "nord",
    "S": "syd",
    "Ø": "øst",
    "V": "vest",
    "NØ": "nordøst",
    "NV": "nordvest",
    "SØ": "sydøst",
    "SV": "sydvest",
}
_DIR = r"(NØ|NV|SØ|SV|N|S|Ø|V)\.?"
_DIR_WORD = r"(NORD|SYD|ØST|VEST|NØ|NV|SØ|SV|N|S|Ø|V)\.?"
# Names the rules can't read, as people would write them (keys: raw, upper case).
_OVERRIDES = {
    "Å Å N": "Å Nord",
    "Å Å 150M S (FRA 1990)": "Å, 150 m syd",
    "V CAMPINGPLADS SV FOR NIBE": "Campingplads sydvest for Nibe",
    "STAUNINGS Ø": "Staunings Ø",  # an island, not "øst"
    "AARHUS Ø, OPEN WATER": "Aarhus Ø, Open Water",  # the district
    "FALSLED S F. HAVN": "Falsled, syd for havnen",
    "LUNDEBORG N F. HAVN": "Lundeborg, nord for havnen",
    "LØKKEBY STRAND M": "Løkkeby Strand Midt",
}
# A street address or a number alone says nothing without the district.
_BARE = re.compile(r"(?i)strand \d+|\S+(?:vej|vejen|alle|alleen|allé|gade) \d+\w?")

Postal = list[Any]  # [postnr, name, west, south, east, north]
Town = list[Any]  # [name, lon, lat, radiusKm, postal index, type]
Coast = list[Any]  # [name, lon, lat, postal index]
Named = list[Any]  # [name, lon, lat, radiusKm, postal index, kind]


def _dir(m: re.Match[str], group: int = 1) -> str:
    word = m.group(group).upper()
    return _DIRS.get(word, word.lower())


def tidy_name(raw: str) -> str:
    """A bathing site's name as people write it: "VEMMETOFTE STRAND" ->
    "Vemmetofte Strand", "HULSIG V/KARREDVEJ" -> "Hulsig v/Karredvej",
    "GNIBEN,SEJERØ" -> "Gniben, Sejerø", "STIBJERG HUSE STR." -> "Stibjerg Huse
    Strand", "200 M. Ø. F. BØNNERUP HAVN" -> "200 m øst for Bønnerup Havn";
    station codes and years are dropped."""
    s = re.sub(r"\s+", " ", raw.strip()).upper()
    if s in _OVERRIDES:
        return _OVERRIDES[s]
    s = re.sub(r"\s*\((?:FRA )?\d{4}\)", "", s)  # "(FRA 1990)", "(4261)"
    s = re.sub(r"(?<=[^\W\d_]) (?:19|20)\d\d$", "", s)  # "ENDELAVE HAVNEMOLE 2015"
    s = re.sub(r"UNDERSTATION DKBW\d+\s*", "", s)
    s = re.sub(r"\bSTR\.VEJ\b", "STRANDVEJ", s)
    s = re.sub(r",(?=\S)", ", ", s)  # "GNIBEN,SEJERØ"
    s = re.sub(r"\.(?=[^\W\d_]{2})", ". ", s)  # "FR.HAVN" -> "FR. HAVN" (not "S.")
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\bØ\. ?HURUP\b", "ØSTER HURUP", s)
    s = re.sub(r"\bML\.", "mellem", s)
    s = re.sub(r"\bAFGRÆNS\.", "AFGRÆNSNING", s)
    # distances: "100 M.", "150M", "100 METER" -> "100 m"
    s = re.sub(r"\b(\d+) ?(?:METER|M)\b\.?", r"\1 m", s)
    # a direction after a distance or before "for": "50 m syd", "N F. HAVN"
    s = re.sub(rf"(\d+ m) {_DIR_WORD}(?=[ ,]|$)", lambda m: f"{m.group(1)} {_dir(m, 2)}", s)
    s = re.sub(rf"\b{_DIR} (?:FOR|F\.)(?= )", lambda m: f"{_dir(m)} for", s)
    s = re.sub(r"(?<=[a-zø]) F\. ", " for ", s)  # "200 m øst F. BØNNERUP"
    # a direction at the end is part of the name: "DAGELÆKKE S" -> "Dagelække Syd"
    s = re.sub(rf"(?<=\S) {_DIR}$", lambda m: " " + _dir(m).upper(), s)
    out: list[str] = []
    for i, word in enumerate(s.split(" ")):
        out.append(_tidy_word(word, first=i == 0))
    return " ".join(out)


def _tidy_word(word: str, *, first: bool) -> str:
    if word != word.upper():  # spelled out above, already as it should read
        return word[:1].upper() + word[1:] if first else word
    letters = re.sub(r"[^\w]", "", word).lower()
    if letters in _EXPAND and word.lower().rstrip(",)").endswith("."):
        tail = word[len(word.rstrip(",)")) :]
        lead = "(" if word.startswith("(") else ""
        return f"{lead}{_EXPAND[letters]}{tail}"
    if not first and letters in _SMALL and not word.startswith("("):
        return word.lower()
    # capitalise the first letter of each part ("HALBJERG-VANGEN", "V/KARREDVEJ")
    parts = re.split(r"([-/(\"])", word.lower())
    word = "".join(part[:1].upper() + part[1:] for part in parts)
    if not first:
        word = re.sub(r"^V/", "v/", word)  # "Hulsig v/Karredvej"
    return word


def distance_km(a: Sequence[float], b: Sequence[float]) -> float:
    """Equirectangular distance between two [lon, lat] points; fine below ~50 km."""
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(lat), (a[1] - b[1]) * 110.57)


def bbox_gap(point: Sequence[float], p: Postal) -> float:
    """How far (degrees) the point lies outside the district's box; 0 inside."""
    dx = max(p[2] - point[0], 0.0, point[0] - p[4])
    dy = max(p[3] - point[1], 0.0, point[1] - p[5])
    return max(dx, dy)


def nearest_town_postal(point: Sequence[float], towns: Sequence[Town]) -> int:
    """The postal district of the town whose centre is nearest (a town proper
    before a part of one or a holiday-home area within 1 km more), or -1."""
    best, best_d = -1, math.inf
    for town in towns:
        if town[4] < 0:
            continue
        d = distance_km(point, (town[1], town[2])) + (1.0 if town[5] != 0 else 0.0)
        if d < best_d:
            best, best_d = town[4], d
    return best


def postal_for(
    point: Sequence[float], postal: Sequence[Postal], towns: Sequence[Town], name: str = ""
) -> int:
    """The postal district a point lies in, from the districts' boxes: among
    the boxes that hold it, one the site's name names ("Nord for Espergærde
    Havn"), else the nearest town's district if it is one of them, else the one
    whose centre is nearest. A point in no box (a pier, a harbour bath) takes
    the box it is nearest; with no boxes at all, the nearest town's district.
    -1 when there is nothing to go by.

    (Measuring to a town's *edge* let a big city win sites far from its
    centre: Islands Brygge got 1879 Frederiksberg C that way.)"""
    town = nearest_town_postal(point, towns)
    inside = [i for i, p in enumerate(postal) if bbox_gap(point, p) == 0]
    words = name.casefold()
    named = [i for i in inside if re.search(rf"\b{re.escape(postal[i][1].casefold())}\b", words)]
    if named:
        return town if town in named else named[0]
    if town in inside:
        return town
    if inside:

        def centre_km(i: int) -> float:
            p = postal[i]
            return distance_km(point, ((p[2] + p[4]) / 2, (p[3] + p[5]) / 2))

        return min(inside, key=centre_km)
    if postal:
        return min(range(len(postal)), key=lambda i: bbox_gap(point, postal[i]))
    return town


def coast_sites(
    rows: Iterable[Sequence[Any]], towns: Sequence[Town], postal: Sequence[Postal] = ()
) -> list[Coast]:
    """Bathing-site rows (``[lon, lat, name, ...]`` as risk.badevand_row gives
    them) as ``[name, lon, lat, postal index]``, tidied, sorted by name. Two
    sites of one name within 2 km (two sampling points of one beach) are one.
    A bare "Strand 1" or "Skansevej 13" gets its district: "Strand 1 (Nakskov)"."""
    out: list[Coast] = []
    for row in rows:
        lon, lat, name = row[0], row[1], row[2]
        if not name or lon is None or lat is None:
            continue
        tidy = tidy_name(str(name))
        if any(c[0] == tidy and distance_km((c[1], c[2]), (lon, lat)) < 2 for c in out):
            continue
        out.append([tidy, round(lon, 4), round(lat, 4), -1])
    for site in out:
        site[3] = postal_for((site[1], site[2]), postal, towns, site[0])
        if postal and site[3] >= 0 and _BARE.fullmatch(site[0]):
            site[0] = f"{site[0]} ({postal[site[3]][1]})"
    out.sort(key=lambda c: (c[0].casefold(), c[1]))
    return out


def named_places(
    features: Iterable[Any],
    towns: Sequence[Town],
    postal: Sequence[Postal],
    bathing: Sequence[Coast] = (),
) -> list[Named]:
    """Stednavne features (``pipeline.ingest.stednavne.NameFeature``) as
    ``[name, lon, lat, radiusKm, postal index, kind]``: the radius of a
    circle of the place's area (0 for a point), the postal district it lies
    in (-1 for a water: a bay is in no district). One of a name and kind
    within 2 km; no beach that repeats a bathing site's name within 2 km."""
    from pipeline.ingest.stednavne import GROUP_OF

    out: list[Named] = []
    for f in features:
        group = GROUP_OF.get(f.kind)
        if group not in NAME_GROUPS:
            continue
        lon, lat = round(f.point[0], 4), round(f.point[1], 4)
        key = f.name.casefold()
        # a beach the bathing site names already (a harbour keeps its own
        # entry: "Egå Marina" is a bathing site and a marina)
        if group == "beach" and any(
            b[0].casefold() == key and distance_km((b[1], b[2]), (lon, lat)) < 2 for b in bathing
        ):
            continue
        if any(
            n[5] == f.kind and n[0] == f.name and distance_km((n[1], n[2]), (lon, lat)) < 2
            for n in out
        ):
            continue
        radius = round(math.sqrt(max(f.area_m2, 0.0) / math.pi) / 1000, 2)
        district = -1 if group == "water" else postal_for((lon, lat), postal, towns, f.name)
        out.append([f.name, lon, lat, radius, district, f.kind])
    out.sort(key=lambda n: (n[0].casefold(), n[5], n[1]))
    return out


def read_towns(path: Path) -> tuple[list[Postal], list[Town]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    postal, towns = raw["postal"], raw["towns"]
    if not postal or not towns:
        raise ValueError(f"{path}: no postal districts or towns")
    for p in postal:
        if not (isinstance(p[0], str) and re.fullmatch(r"\d{4}", p[0]) and len(p) == 6):
            raise ValueError(f"{path}: bad postal district {p!r}")
    for t in towns:
        if len(t) != 6 or not -1 <= t[4] < len(postal):
            raise ValueError(f"{path}: bad town {t!r}")
    return postal, towns


def build_index(
    postal: list[Postal],
    towns: list[Town],
    bathing: Iterable[Sequence[Any]],
    today: date,
    names: Iterable[Any] | list[Named] = (),
) -> dict[str, Any]:
    coast = coast_sites(bathing, towns, postal)
    names = list(names)
    named = (
        names if names and isinstance(names[0], list) else named_places(names, towns, postal, coast)
    )
    return {
        "about": ABOUT,
        "generated": today.isoformat(),
        # [postnr, name, west, south, east, north]
        "postal": postal,
        # [name, lon, lat, radiusKm, postal index (-1: none), type: 0 by, 1 bydel, 2 sommerhus]
        "towns": towns,
        # [name, lon, lat, postal index of the district it lies in (-1: none)]
        "coast": coast,
        # [name, lon, lat, radiusKm, postal index (-1: none), kind (Stednavne
        # type: "strand", "lystbådehavn", "pynt", "bugt", ...)]
        "names": named,
    }


def fetch_bathing_rows() -> list[list[Any]]:
    from pipeline.ingest.risk import VP4, badevand_row, wfs_features

    return [r for f in wfs_features(VP4 + "badevand") if (r := badevand_row(f)) is not None]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--towns", type=Path, help="towns + postal districts (places.json layout)")
    parser.add_argument(
        "--names", type=Path, help="coastal names from pipeline.ingest.stednavne (its JSON file)"
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    postal, towns = read_towns(args.towns or args.out)
    rows = fetch_bathing_rows()
    if args.names:
        from pipeline.ingest.stednavne import read

        names: list[Any] = read(args.names)[1]
    else:
        names = json.loads(args.out.read_text(encoding="utf-8")).get("names", [])
    index = build_index(postal, towns, rows, date.today(), names)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(
        f"wrote {args.out}: {len(postal)} postal districts, {len(towns)} towns, "
        f"{len(index['coast'])} coastal bathing sites (from {len(rows)}), "
        f"{len(index['names'])} coastal names"
    )


if __name__ == "__main__":
    main()
