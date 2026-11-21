"""Place cards: the pure logic behind ``scripts/pull_place_info.py``.

A well-known beach, harbour or headland gets a short card in the app (photo,
one or two sentences, credits). The text comes from the lead of its Danish
Wikipedia article (CC BY-SA 4.0), the photo from Wikimedia Commons under an
open licence; see ``data/places_info/README.md``.

Everything here is network-free so it can be tested: the sentence trimming,
the safety filter (the app never says a spot is clean or safe), the licence
allow-list, the name matching and the published form of a card.
"""

from __future__ import annotations

import html
import math
import re
import unicodedata
from collections.abc import Iterable, Sequence
from typing import Any

Point = tuple[float, float]

# --- kinds ---------------------------------------------------------------

#: Wikidata classes (matched through P31/P279*), most specific first: an item
#: that is both a marina and a harbour is a marina.
WIKIDATA_CLASSES: tuple[tuple[str, str], ...] = (
    ("Q721207", "marina"),
    ("Q1420027", "fishing_harbour"),
    ("Q1478783", "ferry_harbour"),
    ("Q283202", "harbour"),
    ("Q44782", "harbour"),
    ("Q11959973", "beach"),
    ("Q40080", "beach"),
    ("Q217101", "spit"),
    ("Q185113", "headland"),
    ("Q191992", "headland"),
    ("Q107679", "cliff"),
    ("Q207524", "islet"),
    ("Q34763", "peninsula"),
    ("Q39594", "bay"),
)

KIND_ORDER = tuple(dict.fromkeys(kind for _, kind in WIKIDATA_CLASSES))

#: The app's label per kind (Danish UI).
KIND_LABEL = {
    "marina": "Lystbådehavn",
    "fishing_harbour": "Fiskerihavn",
    "ferry_harbour": "Færgehavn",
    "harbour": "Havn",
    "beach": "Strand",
    "spit": "Odde",
    "headland": "Pynt",
    "cliff": "Klint",
    "islet": "Holm",
    "peninsula": "Halvø",
    "bay": "Bugt",
}


def pick_kind(kinds: Iterable[str]) -> str | None:
    """The most specific of an item's kinds (:data:`KIND_ORDER`)."""
    found = set(kinds)
    return next((k for k in KIND_ORDER if k in found), None)


#: OpenStreetMap tags -> kind, for the name matching and the polygon.
def osm_kind(tags: dict[str, str]) -> str | None:
    natural = tags.get("natural")
    if tags.get("leisure") == "marina":
        return "marina"
    if (
        tags.get("landuse") == "harbour"
        or tags.get("harbour") == "yes"
        or tags.get("industrial") == "port"
    ):
        return "harbour"
    if natural == "beach" or tags.get("leisure") in ("beach_resort", "bathing_place"):
        return "beach"
    if natural == "cape":
        return "headland"
    if natural == "spit":
        return "spit"
    if natural == "cliff":
        return "cliff"
    if natural == "peninsula":
        return "peninsula"
    if natural == "bay":
        return "bay"
    if tags.get("place") == "islet":
        return "islet"
    return None


#: Kinds that may stand for each other in a name match (a Wikidata "harbour"
#: is often a marina in OpenStreetMap; a headland is a "pynt", "næs" or "odde").
KIND_GROUP = {
    "marina": "harbour",
    "fishing_harbour": "harbour",
    "ferry_harbour": "harbour",
    "harbour": "harbour",
    "beach": "beach",
    "spit": "land",
    "headland": "land",
    "cliff": "land",
    "islet": "land",
    "peninsula": "land",
    "bay": "water",
}

#: Danske Stednavne types (web/src/names.ts KINDS) -> kind group.
STEDNAVNE_GROUP = {
    "strand": "beach",
    "havbad": "beach",
    "lystbådehavn": "harbour",
    "fiskerihavn": "harbour",
    "trafikhavn": "harbour",
    "pynt": "land",
    "odde": "land",
    "næs": "land",
    "hage": "land",
    "tange": "land",
    "halvø": "land",
    "klint": "land",
    "skræntNaturlig": "land",
    "ø": "land",
    "bugt": "water",
    "vig": "water",
    "nor": "water",
    "bredning": "water",
}

# --- text ----------------------------------------------------------------

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


_SIGNATURE = re.compile(
    r"\(\s*talk\s*\)|\d{1,2}:\d{2}, \d{1,2} \w+ \d{4}(?: \(UTC\))?"
    r"|^original uploader was\s+",
    re.IGNORECASE,
)


def strip_html(text: str | None) -> str:
    """Plain text from Commons' HTML fields (Artist, Credit), without talk-page
    signatures ("Nico (talk) 10:40, 16 July 2008") and upload boilerplate."""
    if not text:
        return ""
    plain = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", text))).strip(" ,;")
    plain = _SIGNATURE.sub(" ", plain)
    plain = re.sub(r"\s+at\s+\w+\.wikipedia\b.*$", "", plain)
    return _SPACE.sub(" ", plain).strip(" ,;")


#: Wikidata items that are bathing-water monitoring points, not places
#: ("Tversted Strand, 500m Øst For Nedkørsel").
_STATION = re.compile(
    r"nedkørsel|\b(ud|syd|nord|øst|vest) for\b|\b\d+ ?m\b|,\s*[A-ZÆØÅ]\.", re.IGNORECASE
)


def is_station(label: str) -> bool:
    return bool(_STATION.search(label))


#: Words that end in a full stop without ending the sentence (lower case,
#: without the final dot). Danish first, a few English for the fallback.
ABBREVIATIONS = frozenset(
    [
        "bl.a",
        "f.eks",
        "fx",
        "ca",
        "km",
        "m",
        "nr",
        "st",
        "sct",
        "skt",
        "dvs",
        "mht",
        "osv",
        "m.fl",
        "m.m",
        "jf",
        "jvf",
        "pga",
        "evt",
        "inkl",
        "ekskl",
        "cirka",
        "omkr",
        "kl",
        "mio",
        "mia",
        "mill",
        "e.kr",
        "f.kr",
        "ndr",
        "sdr",
        "vestl",
        "østl",
        "hhv",
        "vha",
        "iflg",
        "ift",
        "gl",
        "ny",
        "mr",
        "mrs",
        "dr",
        "prof",
        "no",
        "vs",
        "etc",
        "approx",
        "e.g",
        "i.e",
        "incl",
    ]
)

_END = re.compile(r"[.!?](?=[\"'»”)]?(?:\s+|$))")


def _ends_sentence(text: str, i: int) -> bool:
    """Whether the punctuation at ``text[i]`` ends a sentence."""
    rest = text[i + 1 :].lstrip("\"'»”) ")
    if rest and not (rest[0].isupper() or rest[0].isdigit() or rest[0] in "\"'«“("):
        return False
    if text[i] != ".":
        return True
    before = re.search(r"(\S+)$", text[:i])
    if not before:
        return True
    word = before.group(1).lstrip("(\"'«“").lower()
    if word in ABBREVIATIONS:
        return False
    # an ordinal ("2. Verdenskrig") or initials ("H.C. Andersen", "A. Jensen")
    return not (re.fullmatch(r"\d{1,2}", word) or re.fullmatch(r"(?:[^\W\d]\.)*[^\W\d]", word))


def split_sentences(text: str) -> list[str]:
    """Sentences of a plain-text paragraph, abbreviation- and ordinal-aware."""
    text = _SPACE.sub(" ", text).strip()
    out: list[str] = []
    start = 0
    for m in _END.finditer(text):
        i = m.start()
        if not _ends_sentence(text, i):
            continue
        end = i + 1
        while end < len(text) and text[end] in "\"'»”)":
            end += 1
        sentence = text[start:end].strip()
        if sentence:
            out.append(sentence)
        start = end
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return out


_PARENS = re.compile(r"\s*\([^()]*\)")
#: Disambiguation notes that open some leads ("For alternative betydninger, se ...").
_HATNOTE = re.compile(
    r"(for (alternative|andre) betydning|denne artikel|se også|ikke at forveksle"
    r"|this article is about|for other uses|not to be confused|.*kildehenvisning"
    r"|.*du kan hjælpe|.*wikificer|.*bør opdateres)",
    re.IGNORECASE,
)


def clean_lead(text: str) -> str:
    """The first paragraph of a Wikipedia lead, without parentheses (the
    pronunciation, other-language names and years read badly on a card)."""
    paras = [p.strip() for p in text.split("\n")]
    para = next((p for p in paras if p and not _HATNOTE.match(p)), "")
    prev = None
    while prev != para:
        prev, para = para, _PARENS.sub("", para)
    para = _SPACE.sub(" ", para)
    return re.sub(r"\s+([,.;:])", r"\1", para).strip()


# --- the safety filter ---------------------------------------------------

#: A sentence matching any of these says or suggests the water, beach or
#: seaweed is clean, safe, healthy or good for bathing, which Tangkortet must
#: never say (CLAUDE.md). Deliberately broad: a dropped harmless sentence
#: costs little; a kept claim of safety next to the risk verdict costs a lot.
UNSAFE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (label, re.compile(pattern, re.IGNORECASE))
    for label, pattern in (
        ("blue flag", r"bl(å|aa)(t|e)?\s*flag|blue\s*flag|blaue\s*flagge"),
        ("bathing water", r"badevand|bathing\s*water|water\s*quality|vandkvalitet"),
        ("bathing conditions", r"badeforhold|bademulighed|badeegnet|badevenlig"),
        ("good for bathing", r"(vel)?egne[dt]e?\s+til\s+(bad|svøm|leg|børn)"),
        ("good for", r"\bgod[et]?\s+(til|for|at)\s+(bad|svøm|børn|familie|leg)"),
        ("popular beach", r"(populær|dejlig|fin|god|smuk|perfekt|ideel)e?\s+(bade)?strand"),
        ("child-friendly", r"børnevenlig|familievenlig|child[\s-]*friendly|family[\s-]*friendly"),
        ("clean", r"(?<![\wæøå])(ren|rene|rent|renere|reneste|renhed)(?![\wæøå])|\bclean"),
        ("clear water", r"krystalklar|klar[te]?\s+vand|clear\s+water"),
        ("safe", r"sikker|sikre|ufarlig|farefri|tryg|\bsafe|\bsafety"),
        ("healthy", r"(?<![\wæøåÆØÅ])sund(t|e|hed)?(?![\wæøå])|healthy|health"),
        ("lifeguard", r"livredn|livredder|lifeguard"),
        ("recommended", r"anbefal|recommend|ideel|ideal"),
        ("best", r"\bbedste\b|\bbest\b"),
        ("unpolluted", r"uforuren|forurening|pollut|contamina"),
    )
)


def unsafe_reason(sentence: str) -> str | None:
    """Why a sentence must not be shown, or None. "healthy" is case-sensitive
    on the capital: "Sund" alone is a strait (Guldborg Sund)."""
    for label, pattern in UNSAFE_PATTERNS:
        for m in pattern.finditer(sentence):
            if label == "healthy" and m.group(0)[:1].isupper() and m.group(0).lower() == "sund":
                continue
            return label
    return None


def lead_sentences(
    text: str, max_chars: int = 300, hard_max: int = 360
) -> tuple[str | None, list[dict[str, str]]]:
    """One or two sentences from a Wikipedia lead, trimmed at a sentence
    boundary (never mid-sentence), with the sentences the safety filter
    dropped (for the review). The second sentence only joins when the two
    stay within ``max_chars``; a first sentence over ``hard_max`` gives no
    text at all rather than a cut one."""
    dropped: list[dict[str, str]] = []
    kept: list[str] = []
    for sentence in split_sentences(clean_lead(text))[:4]:
        reason = unsafe_reason(sentence)
        if reason:
            dropped.append({"sentence": sentence, "reason": reason})
            # never skip over a dropped sentence: the next one leans on it
            # ("It is located ...") and two around it would join badly
            break
        if not kept:
            if len(sentence) > hard_max or len(sentence) < 25:
                break
            kept.append(sentence)
            continue
        if len(sentence) >= 25 and len(kept[0]) + 1 + len(sentence) <= max_chars:
            kept.append(sentence)
        break
    if not kept:
        return None, dropped
    return " ".join(kept), dropped


def wikidata_sentence(label: str, description: str | None) -> str | None:
    """Wikidata's Danish description as a sentence ("strand i Aarhus" ->
    "Strand i Aarhus."), when it says more than a bare class and passes the
    safety filter."""
    if not description:
        return None
    d = description.strip().rstrip(".")
    words = d.split()
    # "havn i Danmark" says nothing the kind label doesn't
    bare = len(words) <= 3 and d.lower().endswith("i danmark")
    if len(words) < 3 or bare or unsafe_reason(d):
        return None
    return d[0].upper() + d[1:] + "."


# --- licences ------------------------------------------------------------

_CC = re.compile(r"^cc[\s_-]*by(?P<sa>[\s_-]*sa)?(?:[\s_-]*(?P<v>\d(?:\.\d)?))?(?:[\s_-]+\S+)*$")
_DEEDS = {
    "CC BY": "https://creativecommons.org/licenses/by/{v}/",
    "CC BY-SA": "https://creativecommons.org/licenses/by-sa/{v}/",
}


def allowed_licence(short_name: str | None) -> str | None:
    """The normalised licence ("CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public
    domain") when Commons' LicenseShortName is on the allow-list, else None.
    Only CC0, public domain, CC BY and CC BY-SA: no NC, ND, GFDL-only,
    "Attribution" (a Commons template, not CC BY) or fair use."""
    if not short_name:
        return None
    s = _SPACE.sub(" ", short_name.strip()).lower()
    if re.search(r"\bnc\b|\bnd\b|non[\s-]*commercial|no[\s-]*deriv|fair use", s):
        return None
    if s in ("cc0", "cc0 1.0", "cc-zero", "cc zero", "cc-0"):
        return "CC0"
    if s.startswith("public domain") or s in ("pd", "pdm", "pd-self", "no restrictions"):
        return "Public domain"
    # "CC BY-SA 3.0, GFDL" style dual licences: the CC part is enough
    first = s.split(",")[0].split(" or ")[0].strip()
    m = _CC.match(first)
    if not m:
        return None
    base = "CC BY-SA" if m.group("sa") else "CC BY"
    v = m.group("v")
    return f"{base} {v}" if v else base


def licence_url(licence: str, given: str | None) -> str | None:
    """The deed a credit links to: Commons' LicenseUrl, else the CC deed."""
    if given:
        return given.replace("http://", "https://", 1)
    m = re.fullmatch(r"(CC BY(?:-SA)?) (\d\.\d)", licence)
    if m:
        return _DEEDS[m.group(1)].format(v=m.group(2))
    if licence == "CC0":
        return "https://creativecommons.org/publicdomain/zero/1.0/"
    return None


def upload_url(url: str | None) -> str | None:
    """A Commons thumbnail on upload.wikimedia.org without tracking parameters.
    The API hands out thumb.wikimedia.org URLs with ``utm_*``; the same path is
    served (with CORS) by upload.wikimedia.org, which the app's service worker
    caches."""
    if not url:
        return url
    url = url.split("?", 1)[0]
    return re.sub(r"^https?://thumb\.wikimedia\.org/", "https://upload.wikimedia.org/", url)


#: File names that are not photos of the place (maps, coats of arms, logos).
_NOT_A_PHOTO = re.compile(
    r"map|kort|locator|location|logo|v[åa]ben|coat[_ ]of[_ ]arms|flag|diagram|plan\b|sign",
    re.IGNORECASE,
)


def photo_file_ok(name: str) -> bool:
    """A Commons file name that is likely a photograph of the place."""
    base = name.removeprefix("File:").removeprefix("Fil:")
    ext = base.rsplit(".", 1)[-1].lower()
    return ext in ("jpg", "jpeg", "tif", "tiff", "webp") and not _NOT_A_PHOTO.search(base)


# --- names and distances -------------------------------------------------

_FOLD = {"æ": "ae", "ø": "oe", "å": "aa", "ä": "ae", "ö": "oe", "ü": "ue", "é": "e", "ß": "ss"}

#: Generic words left out when comparing names ("Egå Marina" = "Egå Havn").
GENERIC_WORDS = frozenset(
    [
        "strand",
        "strande",
        "stranden",
        "badestrand",
        "badestranden",
        "badeanstalt",
        "badeanstalten",
        "havbad",
        "havbadet",
        "soebad",
        "havn",
        "havnen",
        "lystbaadehavn",
        "lystbaadehavnen",
        "marina",
        "fiskerihavn",
        "faergehavn",
        "trafikhavn",
        "beach",
        "harbour",
        "harbor",
        "port",
        "of",
        "the",
        "bugt",
        "vig",
        "pynt",
        "odde",
        "naes",
        "klint",
        "holm",
        "halvoe",
    ]
)


def normalise_name(name: str) -> str:
    """Lower case, Danish letters folded, hyphens and spaces as one space."""
    s = name.strip().lower()
    s = "".join(_FOLD.get(ch, ch) for ch in s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[-‐–—_/.,']+", " ", s)
    return _SPACE.sub(" ", s).strip()


def name_core(name: str) -> str:
    """The distinctive part of a name, generic words removed, run together."""
    words = [w for w in normalise_name(name).split() if w not in GENERIC_WORDS]
    return "".join(words)


def same_name(a: str, b: str) -> bool:
    """Whether two place names are the same, ignoring case, æøå spelling,
    hyphens, spaces and generic words ("Egå Marina" ~ "Egaa Lystbådehavn")."""
    na, nb = normalise_name(a).replace(" ", ""), normalise_name(b).replace(" ", "")
    if na and na == nb:
        return True
    ca, cb = name_core(a), name_core(b)
    return bool(ca) and len(ca) >= 3 and ca == cb


def distance_m(a: Point, b: Point) -> float:
    """Great-circle distance in metres (haversine)."""
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def match_by_name(
    name: str,
    point: Point,
    group: str,
    candidates: Sequence[dict[str, Any]],
    radius_m: float = 1000.0,
) -> dict[str, Any] | None:
    """The nearest candidate (``{"name", "point", "group", ...}``) with the same
    name and kind group within ``radius_m``, or None."""
    best: tuple[float, dict[str, Any]] | None = None
    for c in candidates:
        if c.get("group") != group or not same_name(name, c["name"]):
            continue
        d = distance_m(point, c["point"])
        if d <= radius_m and (best is None or d < best[0]):
            best = (d, c)
    if best is None:
        return None
    return {**best[1], "distance_m": round(best[0])}


def convex_hull(points: Iterable[Point]) -> list[Point]:
    """Andrew's monotone chain; a closed ring (first point repeated)."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return list(pts)

    def cross(o: Point, a: Point, b: Point) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[Point] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[Point] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    ring = lower[:-1] + upper[:-1]
    return [*ring, ring[0]]


# --- the published form --------------------------------------------------


PHOTO_FIELDS = ("small", "large", "width", "height", "author", "license", "license_url", "page")


def published_card(rec: dict[str, Any]) -> dict[str, Any] | None:
    """A record of ``data/places_info/places_info.json`` as the app reads it
    (web/src/placecard.ts), or None for a rejected one."""
    if rec.get("rejected"):
        return None
    card: dict[str, Any] = {
        "id": rec["id"],
        "name": rec["name"],
        "kind": rec["kind"],
        "lon": rec["lon"],
        "lat": rec["lat"],
    }
    if rec.get("geom"):
        card["geom"] = rec["geom"]
    if rec.get("description"):
        card["text"] = rec["description"]
        card["text_source"] = rec["description_source"]
    article = rec.get("article")
    if article:
        card["article"] = {"url": article["url"], "lang": article["lang"]}
    photo = rec.get("photo")
    if photo:
        card["photo"] = {k: photo[k] for k in PHOTO_FIELDS if photo.get(k) is not None}
    card["reviewed"] = bool(rec.get("reviewed"))
    return card
