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
  badevand, CC BY 4.0), fetched anonymously: the beaches a forager names.

Run by hand (postal districts change a few times a year, bathing sites yearly)::

    py -m pipeline.places [--towns PATH] [--out web/src/data/places.json]
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
    "(Miljøstyrelsen, MiljøGIS vp4basis2026 badevand, CC BY 4.0). "
    "Lavet af pipeline/places.py."
)

# Small words that stay lower case inside a name ("Syd for Marbækgaard").
_SMALL = {"ved", "v", "for", "og", "fra", "til", "i", "på", "af", "med", "mod", "ud", "mellem"}
# Abbreviations spelled out where they are unambiguous.
_EXPAND = {"str": "Strand", "camp": "Camping", "off": "Offentlig"}

Postal = list[Any]  # [postnr, name, west, south, east, north]
Town = list[Any]  # [name, lon, lat, radiusKm, postal index, type]
Coast = list[Any]  # [name, lon, lat, postal index]


def tidy_name(raw: str) -> str:
    """A bathing site's name as people write it: "VEMMETOFTE STRAND" ->
    "Vemmetofte Strand", "HULSIG V/KARREDVEJ" -> "Hulsig v/Karredvej",
    "GNIBEN,SEJERØ" -> "Gniben, Sejerø", "STIBJERG HUSE STR." -> "Stibjerg Huse
    Strand"."""
    s = re.sub(r"\s+", " ", raw.strip())
    s = re.sub(r"\bSTR\.VEJ\b", "STRANDVEJ", s)
    s = re.sub(r",(?=\S)", ", ", s)  # "GNIBEN,SEJERØ"
    s = re.sub(r"\.(?=[^\W\d_]{2})", ". ", s)  # "FR.HAVN" -> "FR. HAVN" (not "S.")
    s = re.sub(r"\(\s+", "(", s)
    out: list[str] = []
    for i, word in enumerate(s.split(" ")):
        out.append(_tidy_word(word, first=i == 0))
    return " ".join(out)


def _tidy_word(word: str, *, first: bool) -> str:
    letters = re.sub(r"[^\w]", "", word).lower()
    if letters in _EXPAND and word.lower().rstrip(",)").endswith("."):
        tail = word[len(word.rstrip(",)")) :]
        lead = "(" if word.startswith("(") else ""
        return f"{lead}{_EXPAND[letters]}{tail}"
    if not first and letters in _SMALL and not word.startswith("("):
        return word.lower()
    if re.fullmatch(r"\d+M", word):  # "150M" -> "150 m" would change the token count
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


def nearest_postal(point: Sequence[float], towns: Sequence[Town]) -> int:
    """The postal district of the town nearest the point (a town proper before
    a part of one or a holiday-home area within 1 km more), or -1."""
    best = -1
    best_d = math.inf
    for town in towns:
        if town[4] < 0:
            continue
        d = distance_km(point, (town[1], town[2])) - town[3]
        if town[5] != 0:
            d += 1.0
        if d < best_d:
            best_d = d
            best = town[4]
    return best


def coast_sites(rows: Iterable[Sequence[Any]], towns: Sequence[Town]) -> list[Coast]:
    """Bathing-site rows (``[lon, lat, name, ...]`` as risk.badevand_row gives
    them) as ``[name, lon, lat, postal index]``, tidied, sorted by name. Two
    sites of one name within 2 km (two sampling points of one beach) are one."""
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
        site[3] = nearest_postal((site[1], site[2]), towns)
    out.sort(key=lambda c: (c[0].casefold(), c[1]))
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
    postal: list[Postal], towns: list[Town], bathing: Iterable[Sequence[Any]], today: date
) -> dict[str, Any]:
    return {
        "about": ABOUT,
        "generated": today.isoformat(),
        # [postnr, name, west, south, east, north]
        "postal": postal,
        # [name, lon, lat, radiusKm, postal index (-1: none), type: 0 by, 1 bydel, 2 sommerhus]
        "towns": towns,
        # [name, lon, lat, postal index of the nearest town (-1: none)]
        "coast": coast_sites(bathing, towns),
    }


def fetch_bathing_rows() -> list[list[Any]]:
    from pipeline.ingest.risk import VP4, badevand_row, wfs_features

    return [r for f in wfs_features(VP4 + "badevand") if (r := badevand_row(f)) is not None]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--towns", type=Path, help="towns + postal districts (places.json layout)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    postal, towns = read_towns(args.towns or args.out)
    rows = fetch_bathing_rows()
    index = build_index(postal, towns, rows, date.today())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {args.out}: {len(postal)} postal districts, {len(towns)} towns, "
        f"{len(index['coast'])} coastal bathing sites (from {len(rows)})"
    )


if __name__ == "__main__":
    main()
