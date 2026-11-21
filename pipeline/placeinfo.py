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

from pipeline.geo import simplify

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


CLASS_KIND = dict(WIKIDATA_CLASSES)

#: The last word of a name that says what the place is ("Gedser Odde",
#: "Blåvands Huk", "Ordrup Næs"), folded as :func:`normalise_name` folds it.
NAME_KIND_SUFFIX: tuple[tuple[str, str], ...] = (
    ("odde", "spit"),
    ("huk", "headland"),
    ("pynt", "headland"),
    ("naes", "headland"),
)


def name_kind(name: str) -> str | None:
    """The kind a place's name gives (its last word, or the end of a compound:
    "Enebærodde"), or None."""
    words = normalise_name(name).split()
    if not words:
        return None
    last = words[-1]
    return next((kind for suffix, kind in NAME_KIND_SUFFIX if last.endswith(suffix)), None)


def classify_kind(direct_p31: Iterable[str], inherited: Iterable[str], name: str) -> str | None:
    """An item's kind: its direct P31 classes first (not the classes it only
    inherits through P279*), then the name's words (odde, huk, pynt, næs), and
    only then "beach", which Wikidata hands out to spits and headlands too
    (Blåvands Huk, Gedser Odde, Hovens Odde)."""
    direct = {CLASS_KIND[q] for q in direct_p31 if q in CLASS_KIND}
    inherited_kinds = set(inherited)
    if direct - {"beach"}:
        return pick_kind(direct - {"beach"})
    by_name = name_kind(name)
    if by_name:
        return by_name
    if direct:
        return pick_kind(direct)
    return pick_kind(inherited_kinds - {"beach"}) or pick_kind(inherited_kinds)


#: Wikidata classes (English labels of the direct P31) of places that are not
#: open to the public or are not a shore at all: a naval base, a museum, a
#: shipyard, a reserve. Matched on the label so a subclass is caught too.
NON_PUBLIC_CLASS = re.compile(
    r"naval|military|\barmy\b|air base|museum|fortress|shipyard|prison|power station"
    r"|bird (sanctuary|reserve)|wildlife (refuge|reserve)|nature reserve|restricted",
    re.IGNORECASE,
)


def non_public_class(labels: Iterable[str]) -> str | None:
    """The first P31 label that marks a non-public place, or None."""
    return next((label for label in labels if NON_PUBLIC_CLASS.search(label)), None)


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


def osm_groups(tags: dict[str, str]) -> frozenset[str]:
    """The kind groups an OpenStreetMap feature can match: its own kind's,
    and "harbour" too for a marina that is also mapped as a harbour area
    (``landuse=harbour`` + ``leisure=marina``) or is named one ("Hasle Havn",
    a small harbour OpenStreetMap tags as a marina). A marina named
    "Lystbådehavn" or "Marina" stays a marina only."""
    kind = osm_kind(tags)
    if kind is None:
        return frozenset()
    groups = {KIND_GROUP[kind]}
    if kind == "marina" and (
        tags.get("landuse") == "harbour"
        or tags.get("harbour") == "yes"
        or tags.get("industrial") == "port"
        or generic_types(tags.get("name") or "") & {"havn", "fiskerihavn", "trafikhavn"}
    ):
        groups.add("harbour")
    return frozenset(groups)


#: Kinds that may stand for each other in a name match (a headland is a
#: "pynt", "næs" or "odde"). A harbour and a marina never do: a town's
#: commercial harbour is not its marina.
KIND_GROUP = {
    "marina": "marina",
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
    "lystbådehavn": "marina",
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
#: never say (CLAUDE.md), or praises the place (beautiful, popular, much
#: visited, modern): a place card is background, never a recommendation or a
#: quality stamp next to the risk verdict. Deliberately broad: a dropped
#: harmless sentence costs little; a kept claim of safety costs a lot.
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
        # an implicit bathing-quality claim: "X er en badestrand", "havbadeanstalt"
        (
            "bathing place",
            r"(?<![\wæøå])(bade\w*|havbad\w*|\w*badeanstalt\w*|søbad\w*|badning|bader)(?![\wæøå])"
            r"|svømme|\bbathing|\bswimm|\bbeach resort",
        ),
        # beauty, charm and popularity
        (
            "praise",
            r"attraktiv|smuk|skøn|idyl|populær|yndet|charmerende|hyggelig|malerisk|pragtfuld"
            r"|storslå|betagende|imponerende|enestående|naturperle|iøjefaldende|særdeles"
            r"|\bunik|\bperle\b|\bikon\b|seværdig|turistattraktion|beautiful|scenic|picturesque"
            r"|popular|attractive|stunning",
        ),
        ("visited", r"besøg(es|t|te)\b|\bvisited\b|\bvisitors\b"),
        ("fine", r"(?<![\wæøå])fin[et]?\s+\w"),
        # marketing copy (Kolding Havn: "udviklingsorienteret og moderne")
        (
            "marketing",
            r"udviklingsorienteret|\bmoderne\b|innovativ|dynamisk|førende|verdensklasse"
            r"|oplevelse|eftertragt|\bmodern\b|world[\s-]*class",
        ),
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


#: The reason a protected place is protected ("fredet i 1941 på grund af sin
#: landskabelige skønhed"): the fact stays, the praise goes.
_JUSTIFICATION = re.compile(
    r",?\s+(på grund af|pga\.|grundet|for sin|for dens|for dets|for at bevare|som følge af"
    r"|takket være|because of|for its)(?![\wæøå])"
)
_PROTECTED = re.compile(r"\bfrede[dt]|\bfredning|\bprotected\b", re.IGNORECASE)


def trimmed_protection(sentence: str) -> str | None:
    """A sentence that says a place is protected ("fredet") and then why, in
    words the filter drops, trimmed to the fact before the reason, when that
    part reads as a sentence and passes the filter; else None. Trimming only,
    never rewording."""
    if not _PROTECTED.search(sentence):
        return None
    m = _JUSTIFICATION.search(sentence)
    if not m:
        return None
    head = sentence[: m.start()].rstrip(" ,;:")
    if len(head) < 25 or not _PROTECTED.search(head) or unsafe_reason(head):
        return None
    return head + "."


_FINAL = re.compile(r"[.!?][\"'»”)]*$")

#: A sentence that opens like this leans on the one before ("Den ligger ...",
#: "Her ...", "It is ..."): after a dropped sentence it would not stand alone.
_ANAPHORIC = re.compile(
    r"^(den|det|de|denne|dette|disse|dens|dets|deres|her|der|han|hun|også|men|og|samtidig"
    r"|desuden|derudover|heraf|herfra|dermed|derfor|dog|it|its|this|these|they|there|he|she"
    r"|but|and|also)(?![\wæøå])",
    re.IGNORECASE,
)


def ends_sentence(text: str) -> bool:
    """Whether ``text`` ends on sentence-final punctuation (never cut off)."""
    return bool(_FINAL.search(text.strip()))


def lead_sentences(
    text: str, max_chars: int = 300, hard_max: int = 360
) -> tuple[str | None, list[dict[str, str]]]:
    """One or two sentences from a Wikipedia lead, trimmed at a sentence
    boundary (never mid-sentence: the text must end on ".", "!" or "?"), with
    the sentences the safety filter dropped (for the review).

    - The second sentence only joins when the two stay within ``max_chars``;
      a first sentence over ``hard_max`` gives no text rather than a cut one.
    - A dropped first sentence makes way for the next clean one, if that one
      stands alone (it does not open with "Den", "Her", "It" ...). A dropped
      sentence after a kept one ends the text: the card never joins two
      sentences across a dropped one.
    - A "fredet" sentence whose reason is praise keeps the fact
      (:func:`trimmed_protection`).
    """
    dropped: list[dict[str, str]] = []
    kept: list[str] = []
    for sentence in split_sentences(clean_lead(text))[:5]:
        reason = unsafe_reason(sentence)
        if reason:
            trimmed = trimmed_protection(sentence)
            dropped.append({"sentence": sentence, "reason": reason})
            if not trimmed:
                if kept:
                    break
                continue
            sentence = trimmed
        if not ends_sentence(sentence):
            break
        if not kept:
            if len(sentence) > hard_max or len(sentence) < 25:
                if dropped:
                    continue
                break
            if dropped and _ANAPHORIC.match(sentence):
                continue
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


def text_from_override(text: str, lead: str) -> str | None:
    """An override's ``text`` when it is one or more whole sentences of the
    article's cleaned lead, in order, that pass the filter; else None. An
    override picks source text, it never brings its own."""
    sentences = split_sentences(clean_lead(lead))
    wanted = split_sentences(text)
    if not wanted:
        return None
    for i in range(len(sentences) - len(wanted) + 1):
        if sentences[i : i + len(wanted)] == wanted:
            break
    else:
        return None
    if any(unsafe_reason(w) for w in wanted) or not ends_sentence(wanted[-1]):
        return None
    return " ".join(wanted)


# --- photo credits ---------------------------------------------------------

_NO_MACHINE = re.compile(
    r"no machine-readable author provided\.?\s*(?P<who>.*?)\s+assumed\b.*$", re.IGNORECASE
)
_USER_PREFIX = re.compile(r"\b(user|bruger|benutzer|utilisateur)\s*:\s*", re.IGNORECASE)
_CONTACT = re.compile(
    r"\(\s*(mail|e-?mail|talk|diskussion|contribs?|bidrag)\s*\)"
    r"|\s*@\s*(wikimedia commons|\w+\.wikipedia(\.org)?|commons)\b",
    re.IGNORECASE,
)
_URL = re.compile(r"^(https?://|www\.)\S+$", re.IGNORECASE)
_UNKNOWN = re.compile(r"^(ukendt|unknown|unknown author|anonymous|anonym|n/?a|\?)$", re.IGNORECASE)


def balance_parentheses(text: str) -> str:
    """Without stray ")" and without an unclosed "(" and what follows it."""
    out: list[str] = []
    opened: list[int] = []
    for ch in text:
        if ch == "(":
            opened.append(len(out))
        elif ch == ")":
            if not opened:
                continue
            opened.pop()
        out.append(ch)
    if opened:
        out = out[: opened[0]]
    return "".join(out)


def clean_author(artist: str | None, credit: str | None = None, user: str | None = None) -> str:
    """The photographer as the card credits them: Commons' Artist (else
    Credit) as plain text, without wiki noise ("user:", "( mail )", "Image:",
    "© … / Wikipedia", "No machine-readable author provided"), duplicates or
    a possessive "'s"; the uploader when the author is a URL, unknown or
    missing; "ukendt" when there is neither."""
    name = strip_html(artist) or strip_html(credit)
    # a web address names no one; a part that is one is left out
    name = re.sub(r"(https?://|www\.)\S+", "", name, flags=re.I)
    m = _NO_MACHINE.match(name)
    if m:
        name = m.group("who")
    name = _USER_PREFIX.sub("", name)
    name = _CONTACT.sub("", name)
    name = re.sub(r"^(image|foto|photo|fotograf|photographer)\s*:\s*", "", name, flags=re.I)
    name = re.sub(r"©|\(c\)|copyright", "", name, flags=re.I)
    name = re.sub(r"\s*/\s*(wikipedia|wikimedia commons|commons)\b.*$", "", name, flags=re.I)
    name = re.sub(r"(?<=\w)['’]s\b", "", name)
    name = balance_parentheses(name)
    parts: list[str] = []
    for part in re.split(r"\s*/\s*", name):
        part = _SPACE.sub(" ", part).strip(" ,;:-")
        if part and part.lower() not in (p.lower() for p in parts):
            parts.append(part)
    name = " / ".join(parts)
    uploader = _USER_PREFIX.sub("", (user or "").strip())
    if not name or _URL.match(name) or _UNKNOWN.match(name):
        name = uploader or "ukendt"
    if len(name) > 80:
        name = name[:77].rsplit(" ", 1)[0] + " …"
    return name


# --- licences ------------------------------------------------------------

_CC = re.compile(r"^cc[\s_-]*by(?P<sa>[\s_-]*sa)?(?:[\s_-]*(?P<v>\d(?:\.\d)?))?(?:[\s_-]+\S+)*$")
_DEEDS = {
    "CC BY": "https://creativecommons.org/licenses/by/{v}/",
    "CC BY-SA": "https://creativecommons.org/licenses/by-sa/{v}/",
}


#: A ported licence's jurisdiction in its deed's URL (".../by-sa/3.0/de/").
_PORT_URL = re.compile(r"/licenses/by(?:-sa)?/\d\.\d/([a-z]{2,3})(?:/|$)", re.IGNORECASE)
#: Not a port: the words that may follow the version in a short name.
_NOT_PORT = frozenset(["sa", "by", "or", "and", "gfdl", "migrated", "self"])


def _port(first: str, url: str | None) -> str | None:
    """The jurisdiction of a ported CC licence ("DE" for "CC BY-SA 3.0 de"),
    from the short name's word after the version, else the deed's URL."""
    m = re.search(r"\d\.\d[\s_-]+([a-z]{2,3})\b", first)
    if m and m.group(1) not in _NOT_PORT:
        return m.group(1).upper()
    m = _PORT_URL.search(url or "")
    return m.group(1).upper() if m else None


def allowed_licence(short_name: str | None, url: str | None = None) -> str | None:
    """The normalised licence ("CC BY-SA 4.0", "CC BY 2.0", "CC BY-SA 3.0 DE",
    "CC0", "Public domain") when Commons' LicenseShortName is on the
    allow-list, else None. Only CC0, public domain, CC BY and CC BY-SA: no NC,
    ND, GFDL-only, "Attribution" (a Commons template, not CC BY) or fair use.
    A ported licence keeps its port, from the short name or ``url`` (its
    LicenseUrl): "CC BY-SA 3.0 DE" is not "CC BY-SA 3.0"."""
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
    if not v:
        return base
    port = _port(first, url)
    return f"{base} {v} {port}" if port else f"{base} {v}"


def licence_url(licence: str, given: str | None) -> str | None:
    """The deed a credit links to: Commons' LicenseUrl, else the CC deed."""
    if given:
        return given.replace("http://", "https://", 1)
    m = re.fullmatch(r"(CC BY(?:-SA)?) (\d\.\d)(?: ([A-Z]{2,3}))?", licence)
    if m:
        deed = _DEEDS[m.group(1)].format(v=m.group(2))
        return f"{deed}{m.group(3).lower()}/" if m.group(3) else deed
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


#: The oldest photo a card uses: older ones are archive pictures of how the
#: place looked, not of how it looks.
MIN_PHOTO_YEAR = 1950

#: Commons categories and descriptions of pictures that are not a present-day
#: photo of the place: maps, engravings, paintings, drawings, postcards.
_NOT_A_PHOTO_META = re.compile(
    r"\bmaps?\b|\bmap of|\bkort over|\bkort\b|\bengraving|\bkobberstik|\bpainting|\bmaleri"
    r"|\bdrawing|\btegning|\blithograph|\blitografi|\billustration|\bpostcards?\b|\bpostkort"
    r"|\bwatercolou?r|\bakvarel|\betching|\bradering|\bwoodcut|\bscans? of\b|\bpd[\s-]old\b"
    r"|\bartworks?\b|\bsketch",
    re.IGNORECASE,
)

#: Categories that put people, cars or crowds in the picture: a place card's
#: photo shows the shore, not a bathing crowd or a number plate.
_PEOPLE_META = re.compile(
    r"\bpeople\b|\bcrowds?\b|\bbathers\b|\bbathing\b|\bsunbath|\bswimm(ers|ing)\b"
    r"|\bbeachgoers\b|\btourists\b|\bnaturis|\bnudis|\bautomobiles\b|\bcars\b|\bvehicles\b"
    r"|\blicen[cs]e plates\b|\bnumber plates\b|\bkitesurf|\bkite surf|\bchildren\b|\bwomen\b"
    r"|\bmen\b|\bportraits?\b|\bfestival",
    re.IGNORECASE,
)

#: Categories (and file titles) of a picture whose subject is not the shore:
#: a motorhome site, a café, an airport, a shipyard, village houses.
_OFF_SUBJECT_META = re.compile(
    r"\bmotorhomes?\b|\bcamper ?vans?\b|\bautocamper|\brestaurants?\b|\bcaf[eé]s?\b"
    r"|\bairports?\b|\blufthavn|\bshipyards?\b|\bshipbuilding|skibsv(æ|ae)rft|\bhouses\b",
    re.IGNORECASE,
)

#: "1900 in Denmark", "1930s photographs of Copenhagen": the picture's year.
_YEAR_CATEGORY = re.compile(
    r"(?<!\d)(1[0-8]\d\d|19[0-4]\d)s?\s+(in|photographs|photos|images|maps)\b"
    r"|\b(photographs|photos|images) (taken )?in (1[0-8]\d\d|19[0-4]\d)\b"
    r"|\b(1[0-9]|1[0-9]th)[\s-]century\b|\b19th\b|\b18th\b",
    re.IGNORECASE,
)


def photo_year(date_original: str | None) -> int | None:
    """The year in Commons' DateTimeOriginal ("2009-06-27 09:22:25",
    "circa 1900<div ...>", "1870"), or None."""
    if not date_original:
        return None
    m = re.search(r"(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)", strip_html(date_original))
    return int(m.group(1)) if m else None


def photo_meta_reason(meta: dict[str, str]) -> str | None:
    """Why a Commons file is not a usable present-day photo of the place, from
    its extmetadata (``Categories``, ``ImageDescription``, ``ObjectName``,
    ``DateTimeOriginal``, ``Artist``), or None. Maps, engravings, paintings,
    drawings; pictures from before :data:`MIN_PHOTO_YEAR`; people, cars and
    crowds as the subject; a motorhome site, café, airport, shipyard or houses
    in place of the shore."""
    cats = strip_html(meta.get("Categories")).replace("|", " | ")
    desc = strip_html(meta.get("ImageDescription"))
    name = strip_html(meta.get("ObjectName"))
    for label, text in (("categories", cats), ("description", f"{desc} {name}")):
        m = _NOT_A_PHOTO_META.search(text)
        if m:
            return f"not a photo ({label}: {m.group(0).strip()})"
    year = photo_year(meta.get("DateTimeOriginal"))
    if year is not None and year < MIN_PHOTO_YEAR:
        return f"before {MIN_PHOTO_YEAR} ({year})"
    m = _YEAR_CATEGORY.search(cats)
    if m:
        return f"before {MIN_PHOTO_YEAR} (categories: {m.group(0).strip()})"
    # the painter's life years ("A. Thorenfeldt (1839-1907)")
    m = re.search(r"\((1[5-9]\d\d)\s*[-–]\s*(1[5-9]\d\d)\)", strip_html(meta.get("Artist")))
    if m and int(m.group(2)) < MIN_PHOTO_YEAR:
        return f"before {MIN_PHOTO_YEAR} (artist {m.group(0)})"
    m = _PEOPLE_META.search(cats)
    if m:
        return f"people as the subject ({m.group(0).strip()})"
    m = _OFF_SUBJECT_META.search(cats) or _OFF_SUBJECT_META.search(name)
    if m:
        return f"not the shore ({m.group(0).strip()})"
    return None


# --- names and distances -------------------------------------------------

_FOLD = {"æ": "ae", "ø": "oe", "å": "aa", "ä": "ae", "ö": "oe", "ü": "ue", "é": "e", "ß": "ss"}

#: Generic words left out when comparing names, each with its type: two names
#: compare without them only when their types agree ("Egå Marina" =
#: "Egå Lystbådehavn", but never "Fredericia Havn" = "Fredericia
#: Lystbådehavn"). "of" and "the" have no type.
GENERIC_WORDS: dict[str, str | None] = {
    "strand": "strand",
    "strande": "strand",
    "stranden": "strand",
    "beach": "strand",
    "badestrand": "strand",
    "badestranden": "strand",
    "badeanstalt": "bad",
    "badeanstalten": "bad",
    "havbad": "bad",
    "havbadet": "bad",
    "soebad": "bad",
    "havn": "havn",
    "havnen": "havn",
    "harbour": "havn",
    "harbor": "havn",
    "port": "havn",
    "lystbaadehavn": "marina",
    "lystbaadehavnen": "marina",
    "baadehavn": "marina",
    "baadehavnen": "marina",
    "marina": "marina",
    "fiskerihavn": "fiskerihavn",
    "fiskerihavnen": "fiskerihavn",
    "faergehavn": "faergehavn",
    "faergehavnen": "faergehavn",
    "faergeleje": "faergehavn",
    "trafikhavn": "trafikhavn",
    "trafikhavnen": "trafikhavn",
    "of": None,
    "the": None,
    "bugt": "bugt",
    "vig": "vig",
    "pynt": "pynt",
    "odde": "odde",
    "naes": "naes",
    "klint": "klint",
    "holm": "holm",
    "halvoe": "halvoe",
}

#: The generic types of a harbour: a name with one never matches a name
#: without it (the bare town name "Nakskov" is not "Nakskov Havn").
HARBOUR_TYPES = frozenset(["havn", "marina", "fiskerihavn", "faergehavn", "trafikhavn"])


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


def generic_types(name: str) -> frozenset[str]:
    """The types of a name's generic words ({"havn"} for "Vejle Havn")."""
    return frozenset(
        t for w in normalise_name(name).split() if (t := GENERIC_WORDS.get(w)) is not None
    )


def same_name(a: str, b: str) -> bool:
    """Whether two place names are the same, ignoring case, æøå spelling,
    hyphens, spaces and generic words ("Egå Marina" ~ "Egaa Lystbådehavn").
    The generic words are only left out when they agree: "Havn",
    "Lystbådehavn" and "Færgehavn" differ, and a harbour's name never matches
    a name without a harbour word ("Nakskov Havn" is not "Nakskov")."""
    na, nb = normalise_name(a).replace(" ", ""), normalise_name(b).replace(" ", "")
    if na and na == nb:
        return True
    ta, tb = generic_types(a), generic_types(b)
    if ta != tb and (ta and tb or (ta | tb) & HARBOUR_TYPES):
        return False
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
    """The nearest candidate (``{"name", "point", "group" | "groups", ...}``)
    with the same name and kind group within ``radius_m``, or None."""
    best: tuple[float, dict[str, Any]] | None = None
    for c in candidates:
        groups = c.get("groups") or {c.get("group")}
        if group not in groups or not same_name(name, c["name"]):
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


# --- the shore of a large place ---------------------------------------------

#: Kinds whose outline is land the pin can be far inside: the card shows
#: only near their shore (the coastline along the outline), never for a pin
#: inland on them (Løjt Kirkeby on Løjt Land, Hvidbjerg on Thyholm).
SHORE_KINDS = frozenset(["peninsula", "islet"])
#: A headland, spit or cliff this large (its outline's extent) is treated so too.
SHORE_EXTENT_M = 1500
#: How near the shore (or, without an outline, the coastline) the pin must be.
SHORE_RADIUS_M = 300
#: How near the outline's edge a stretch of coastline must lie to be its shore.
SHORE_MATCH_M = 80


def _xy(p: Point, lat0: float) -> tuple[float, float]:
    return p[0] * 111320 * math.cos(math.radians(lat0)), p[1] * 110574


def _seg_dist(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    t = 0.0 if not len2 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


class SegmentIndex:
    """The segments of some polylines in a metre grid, for "how far to the
    nearest segment" from many points (pure Python, fast enough here)."""

    def __init__(self, lines: Iterable[Sequence[Point]], lat0: float, cell_m: float = 500.0):
        self.lat0, self.cell = lat0, cell_m
        self.grid: dict[tuple[int, int], list[tuple[tuple[float, float], tuple[float, float]]]] = {}
        for line in lines:
            xy = [_xy(p, lat0) for p in line]
            for a, b in zip(xy, xy[1:], strict=False):
                x0, x1 = sorted((a[0], b[0]))
                y0, y1 = sorted((a[1], b[1]))
                for i in range(int(x0 // cell_m), int(x1 // cell_m) + 1):
                    for j in range(int(y0 // cell_m), int(y1 // cell_m) + 1):
                        self.grid.setdefault((i, j), []).append((a, b))

    def nearest_m(self, p: Point, limit_m: float) -> float:
        """Metres to the nearest segment, or ``math.inf`` beyond ``limit_m``."""
        x, y = _xy(p, self.lat0)
        reach = int(limit_m // self.cell) + 1
        ci, cj = int(x // self.cell), int(y // self.cell)
        best = math.inf
        for i in range(ci - reach, ci + reach + 1):
            for j in range(cj - reach, cj + reach + 1):
                for a, b in self.grid.get((i, j), ()):
                    best = min(best, _seg_dist((x, y), a, b))
        return best if best <= limit_m else math.inf


def shore_lines(
    outline: Sequence[Sequence[Point]],
    coastline: Sequence[Sequence[Point]],
    match_m: float = SHORE_MATCH_M,
) -> list[list[Point]]:
    """The stretches of coastline that run along a place's outline (within
    ``match_m`` of its edge): a peninsula's or islet's shore, without the
    inland edge where it joins the mainland. Consecutive coastline vertices
    near the edge make one stretch."""
    pts = [p for line in outline for p in line]
    if not pts:
        return []
    lat0 = sum(p[1] for p in pts) / len(pts)
    edge = SegmentIndex(outline, lat0)
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    pad = 0.01
    box = (min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)
    out: list[list[Point]] = []
    for line in coastline:
        run: list[Point] = []
        for p in line:
            inside_box = box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]
            if inside_box and edge.nearest_m(p, match_m) <= match_m:
                run.append(p)
                continue
            if len(run) >= 2:
                out.append(run)
            run = []
        if len(run) >= 2:
            out.append(run)
    return out


def simplify_lines(
    lines: Sequence[Sequence[Point]], max_points: int = 200, tolerance_m: float = 25.0
) -> list[list[list[float]]]:
    """Douglas-Peucker in metres, the tolerance raised until all the lines
    together have at most ``max_points``; coordinates rounded to 5 decimals."""
    if not lines:
        return []
    lat0 = lines[0][0][1]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110574
    metres = [[(x * kx, y * ky) for x, y in line] for line in lines]
    tol = tolerance_m
    while True:
        kept = [simplify(m, tol) for m in metres]
        if sum(len(k) for k in kept) <= max_points or tol > 2000:
            break
        tol *= 1.4
    return [[[round(x / kx, 5), round(y / ky, 5)] for x, y in k] for k in kept if len(k) >= 2]


#: A bay with only a point: its shore is the coastline this close to the
#: point, or, when the point lies further out, the coastline up to this much
#: beyond the nearest; a point further than BAY_POINT_MAX_M from any
#: coastline gets no shore.
BAY_SHORE_M = 3000
BAY_SHORE_EXTRA_M = 1500
BAY_POINT_MAX_M = 5000


def _crosses(
    p: tuple[float, float], q: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> bool:
    """Whether the segments pq and ab cross (properly, not at an end)."""

    def side(o: tuple[float, float], u: tuple[float, float], v: tuple[float, float]) -> float:
        return (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])

    d1, d2 = side(p, q, a), side(p, q, b)
    d3, d4 = side(a, b, p), side(a, b, q)
    return d1 * d2 < 0 and d3 * d4 < 0


def bay_shore(
    coastline: Sequence[Sequence[Point]], point: Point
) -> tuple[list[list[Point]], float]:
    """A big bay's shore round its point (Faxe Bugt, Kalø Vig), whose card
    then shows near that shore, not only in a disc out in the water: the
    coastline within BAY_SHORE_M of the point (further when the point lies
    further out: up to BAY_SHORE_EXTRA_M beyond the nearest coastline) that
    can be seen from the point across the water, so a shore behind a
    headland, in the next bay, is not this bay's. Returns the stretches and
    the metres to the nearest coastline (``math.inf`` without any)."""
    lat0 = point[1]
    centre = _xy(point, lat0)
    lines = [[_xy(p, lat0) for p in line] for line in coastline]
    nearest = min(
        (_seg_dist(centre, a, b) for line in lines for a, b in zip(line, line[1:], strict=False)),
        default=math.inf,
    )
    if nearest > BAY_POINT_MAX_M:
        return [], nearest
    radius = max(BAY_SHORE_M, nearest + BAY_SHORE_EXTRA_M)
    near: list[list[tuple[float, float]]] = []
    for line in lines:
        run: list[tuple[float, float]] = []
        for p in simplify(line, 20.0) if len(line) > 2 else line:
            if math.hypot(p[0] - centre[0], p[1] - centre[1]) <= radius:
                run.append(p)
                continue
            if len(run) >= 2:
                near.append(run)
            run = []
        if len(run) >= 2:
            near.append(run)
    segments = [(a, b) for line in near for a, b in zip(line, line[1:], strict=False)]

    def seen(v: tuple[float, float]) -> bool:
        # the sight line, stopped 2 m short of the shore point
        dx, dy = v[0] - centre[0], v[1] - centre[1]
        length = math.hypot(dx, dy) or 1.0
        end = (v[0] - 2 * dx / length, v[1] - 2 * dy / length)
        return not any(_crosses(centre, end, a, b) for a, b in segments)

    kx = 111320 * math.cos(math.radians(lat0))
    out: list[list[Point]] = []
    for line in near:
        run_ll: list[Point] = []
        for v in line:
            if seen(v):
                run_ll.append((v[0] / kx, v[1] / 110574))
                continue
            if len(run_ll) >= 2:
                out.append(run_ll)
            run_ll = []
        if len(run_ll) >= 2:
            out.append(run_ll)
    return out, nearest


def lines_distance_m(lines: Sequence[Sequence[Point]], p: Point) -> float:
    """Metres from ``p`` to the nearest of some polylines (``math.inf`` without any)."""
    best = math.inf
    xy = _xy(p, p[1])
    for line in lines:
        pts = [_xy(q, p[1]) for q in line]
        for a, b in zip(pts, pts[1:], strict=False):
            best = min(best, _seg_dist(xy, a, b))
    return best


# --- the published form --------------------------------------------------


PHOTO_FIELDS = ("small", "large", "width", "height", "author", "license", "license_url", "page")


def published_card(rec: dict[str, Any]) -> dict[str, Any] | None:
    """A record of ``data/places_info/places_info.json`` as the app reads it
    (web/src/placecard.ts), or None for a rejected one."""
    if rec.get("rejected") or rec.get("dropped"):
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
    if rec.get("shore"):
        card["shore"] = rec["shore"]
    # matched to (and placed by) OpenStreetMap: the card credits it (ODbL)
    if str((rec.get("match") or {}).get("by", "")).startswith("osm_"):
        card["osm"] = True
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
