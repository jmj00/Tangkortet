import json

import pytest

from pipeline.placeinfo import (
    allowed_licence,
    clean_lead,
    convex_hull,
    is_station,
    lead_sentences,
    licence_url,
    match_by_name,
    normalise_name,
    photo_file_ok,
    pick_kind,
    published_card,
    same_name,
    split_sentences,
    strip_html,
    unsafe_reason,
    upload_url,
    wikidata_sentence,
)

# More tests for round 2 (softening, kinds, credits, photos, shores) live in
# test_placeinfo_review.py.
from pipeline.publish import publish_place_info

# --- sentence trimming ---


def test_split_sentences_keeps_abbreviations_ordinals_and_initials():
    text = (
        "Havnen blev bl.a. udvidet i 1880 af H.C. Hansen. Den ligger ca. 2 km fra byen, "
        "og under 2. Verdenskrig var den lukket. Her er f.eks. en mole."
    )
    assert split_sentences(text) == [
        "Havnen blev bl.a. udvidet i 1880 af H.C. Hansen.",
        "Den ligger ca. 2 km fra byen, og under 2. Verdenskrig var den lukket.",
        "Her er f.eks. en mole.",
    ]


def test_split_sentences_ends_on_a_year_and_on_question_marks():
    assert split_sentences("Den blev bygget i 1932. Den er fredet! Hvorfor? Ingen ved det") == [
        "Den blev bygget i 1932.",
        "Den er fredet!",
        "Hvorfor?",
        "Ingen ved det",
    ]


def test_clean_lead_drops_parentheses_and_later_paragraphs():
    text = "Grenen (også kaldet Skagen Odde) er Danmarks nordligste punkt.\nAnden paragraf."
    assert clean_lead(text) == "Grenen er Danmarks nordligste punkt."


def test_lead_takes_two_sentences_when_they_fit():
    text = (
        "Egå Marina er en lystbådehavn nord for Aarhus. Den blev anlagt i 1980'erne. "
        "En tredje sætning kommer aldrig med."
    )
    assert lead_sentences(text)[0] == (
        "Egå Marina er en lystbådehavn nord for Aarhus. Den blev anlagt i 1980'erne."
    )


def test_lead_stops_at_one_sentence_when_two_are_too_long():
    first = "Helgenæs er en halvø på Mols, " + "lang " * 40 + "og bakket."
    second = "Den har mange bakker og en lang kyst mod Kattegat og Begtrup Vig."
    text, _ = lead_sentences(f"{first} {second}", max_chars=300)
    assert text == first


def test_lead_never_cuts_mid_sentence():
    long = "Stranden " + "er meget lang og " * 40 + "slutter her."
    assert lead_sentences(long)[0] is None


# --- the safety filter ---


@pytest.mark.parametrize(
    "sentence",
    [
        "Stranden har Blå Flag.",
        "Stranden har haft det blå flag siden 1990.",
        "Badevandskvaliteten er udmærket.",
        "Her er rent vand og hvidt sand.",
        "Vandet er krystalklart.",
        "Det er en børnevenlig badestrand.",
        "Den er populær badestrand om sommeren.",
        "Stranden er sikker for børn.",
        "Havnen er en sikker havn i storm.",
        "Tangen herfra er sund at spise.",
        "Stranden er velegnet til badning.",
        "Der er livredder i sommermånederne.",
        "The beach has a Blue Flag and clean water.",
        "It is a safe place for children.",
        "Kommunen anbefaler stranden.",
    ],
)
def test_unsafe_sentences_are_caught(sentence):
    assert unsafe_reason(sentence) is not None


@pytest.mark.parametrize(
    "sentence",
    [
        "Den Permanente blev bygget i Aarhus i 1932.",
        "Havnen ligger ved Guldborg Sund.",
        "Øresund skiller Sjælland fra Skåne.",
        "Grenen er Danmarks nordligste punkt.",
        "Marinaen har plads til 600 både.",
    ],
)
def test_factual_sentences_pass(sentence):
    assert unsafe_reason(sentence) is None


def test_lead_drops_unsafe_sentences_and_reports_them():
    text = (
        "Bellevue Strand er en strand i Aarhus. Stranden har Blå Flag og rent vand. "
        "Den ligger ved Riis Skov."
    )
    kept, dropped = lead_sentences(text)
    # never skips over a dropped sentence to join two
    assert kept == "Bellevue Strand er en strand i Aarhus."
    assert dropped == [{"sentence": "Stranden har Blå Flag og rent vand.", "reason": "blue flag"}]


def test_lead_with_an_unsafe_first_sentence_gives_no_text():
    # the second leans on the first ("It is located ...")
    text = "Bellevue Beach is a Blue Flag beach in Aarhus. It is located in Aarhus N."
    kept, dropped = lead_sentences(text)
    assert kept is None
    assert dropped[0]["reason"] == "blue flag"


def test_lead_skips_a_disambiguation_note():
    text = "For alternative betydninger, se Helgenæs.\nHelgenæs er en halvø på Mols i Østjylland."
    assert lead_sentences(text)[0] == "Helgenæs er en halvø på Mols i Østjylland."


def test_wikidata_description_as_a_sentence():
    assert wikidata_sentence("X", "strand i Aarhus Kommune") == "Strand i Aarhus Kommune."
    assert wikidata_sentence("X", "havn i Danmark") is None  # says no more than the kind
    assert wikidata_sentence("X", "havn") is None
    assert wikidata_sentence("X", "sikker badestrand ved Aarhus") is None
    assert wikidata_sentence("X", None) is None


# --- licences ---


@pytest.mark.parametrize(
    ("short", "expected"),
    [
        ("CC BY-SA 4.0", "CC BY-SA 4.0"),
        ("CC BY-SA 3.0 de", "CC BY-SA 3.0 DE"),
        ("CC BY 2.0", "CC BY 2.0"),
        ("cc-by-sa-3.0-migrated", "CC BY-SA 3.0"),
        ("CC BY-SA 3.0, GFDL", "CC BY-SA 3.0"),
        ("CC0", "CC0"),
        ("Public domain", "Public domain"),
        ("CC BY-NC-SA 2.0", None),
        ("CC BY-ND 4.0", None),
        ("CC BY-NC 4.0", None),
        ("GFDL", None),
        ("Attribution", None),
        ("Fair use", None),
        ("", None),
        (None, None),
    ],
)
def test_licence_allow_list(short, expected):
    assert allowed_licence(short) == expected


def test_licence_url():
    assert licence_url("CC BY-SA 4.0", None) == "https://creativecommons.org/licenses/by-sa/4.0/"
    assert licence_url("CC BY 2.0", "http://x/") == "https://x/"
    assert licence_url("Public domain", None) is None


def test_photo_file_names():
    assert photo_file_ok("File:Grenen 2019.jpg")
    assert photo_file_ok("Egå Marina.JPEG")
    assert not photo_file_ok("Aarhus Kommune våben.svg")
    assert not photo_file_ok("Helgenæs map.jpg")
    assert not photo_file_ok("Strand.png")


def test_bathing_water_stations_are_not_places():
    assert is_station("Tversted Strand, 500m Øst For Nedkørsel")
    assert is_station("Skagen Søndre Strand, V.vippefyr")
    assert is_station("Skiveren Strand, syd for Skiverrenden")
    assert not is_station("Odense Havn, Lindø")
    assert not is_station("Bellevue Strand")


def test_strip_html_drops_signatures():
    assert strip_html("Nico ( talk ) 10:40, 16 July 2008 (UTC)") == "Nico"
    assert strip_html("Original uploader was Hansjorn at da.wikipedia") == "Hansjorn"


def test_strip_html():
    html = '<a href="//commons.wikimedia.org/wiki/User:Jens">Jens Hansen</a> &amp; Co'
    assert strip_html(html) == "Jens Hansen & Co"
    assert strip_html(None) == ""


# --- names and matching ---


def test_normalise_name_folds_danish_letters_and_hyphens():
    assert normalise_name("Egå  Marina") == "egaa marina"
    assert normalise_name("Rømø-Lakolk") == "roemoe lakolk"
    assert normalise_name("Æbelø") == "aebeloe"


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Egå Marina", "Egaa Lystbådehavn"),
        ("Bellevue Strand", "Bellevue Beach"),
        ("Rømø-Lakolk", "Rømø Lakolk"),
        ("Ebeltoft Lystbådehavn", "Ebeltoft Marina"),
        ("GRENEN", "Grenen"),
    ],
)
def test_same_name(a, b):
    assert same_name(a, b)


@pytest.mark.parametrize(
    ("a", "b"),
    [("Egå Marina", "Aarhus Lystbådehavn"), ("Havn", "Strand"), ("Bellevue", "Moesgård")],
)
def test_different_names(a, b):
    assert not same_name(a, b)


def test_match_by_name_wants_the_kind_group_and_1_km():
    pool = [
        {"name": "Egå Lystbådehavn", "point": (10.2610, 56.2205), "group": "marina", "osm": "w1"},
        {"name": "Egå Strand", "point": (10.2610, 56.2205), "group": "beach", "osm": "w2"},
        {"name": "Egå Marina", "point": (10.40, 56.22), "group": "marina", "osm": "w3"},  # 9 km
    ]
    hit = match_by_name("Egå Marina", (10.2620, 56.2210), "marina", pool)
    assert hit is not None and hit["osm"] == "w1" and hit["distance_m"] < 100
    assert match_by_name("Egå Marina", (10.2620, 56.2210), "land", pool) is None
    # a harbour item never matches a marina feature
    assert match_by_name("Egå Marina", (10.2620, 56.2210), "harbour", pool) is None
    assert match_by_name("Egå Marina", (10.30, 56.22), "marina", pool) is None


def test_pick_kind_prefers_the_specific_one():
    assert pick_kind({"harbour", "marina"}) == "marina"
    assert pick_kind({"bay", "beach"}) == "beach"
    assert pick_kind(set()) is None


def test_convex_hull_is_closed():
    hull = convex_hull([(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.5)])
    assert hull[0] == hull[-1] and len(hull) == 5


# --- publishing ---


RECORD = {
    "id": "Q5256478",
    "name": "Den Permanente",
    "kind": "beach",
    "kind_label": "Strand",
    "lon": 10.22,
    "lat": 56.17,
    "geom": None,
    "match": {"by": "osm_wikidata", "osm": "w1"},
    "description": "Den Permanente er en badeanstalt i Aarhus.",
    "description_source": "wikipedia_da",
    "dropped_sentences": [],
    "article": {"title": "Den Permanente", "lang": "da", "url": "https://da.wikipedia.org/x"},
    "photo": {
        "file": "File:x.jpg",
        "small": "https://upload.wikimedia.org/s.jpg",
        "large": "https://upload.wikimedia.org/l.jpg",
        "width": 800,
        "height": 533,
        "author": "Jens",
        "license": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "page": "https://commons.wikimedia.org/wiki/File:x.jpg",
    },
    "fetched": "2026-11-21",
    "reviewed": False,
}


def test_published_card_is_lean_and_skips_rejected():
    card = published_card(RECORD)
    assert card is not None
    assert "match" not in card and "dropped_sentences" not in card
    assert card["text"] == RECORD["description"]
    assert card["photo"]["large"].endswith("l.jpg") and "file" not in card["photo"]
    assert card["reviewed"] is False
    assert published_card({**RECORD, "rejected": True}) is None


def test_publish_place_info(tmp_path):
    src = tmp_path / "places_info.json"
    src.write_text(json.dumps([RECORD, {**RECORD, "id": "Q2", "rejected": True}]), "utf-8")
    index = publish_place_info(tmp_path / "out", src)
    assert index is not None
    assert index["count"] == 1 and index["fetched"] == "2026-11-21"
    assert index["license"] == "CC BY-SA 4.0"
    doc = json.loads((tmp_path / "out" / "place_info.json").read_text("utf-8"))
    assert [p["id"] for p in doc["places"]] == ["Q5256478"]
    assert publish_place_info(tmp_path / "out", tmp_path / "missing.json") is None


def test_lead_skips_maintenance_banners_and_short_tails():
    text = (
        "Der er for få eller ingen kildehenvisninger i denne artikel. Du kan hjælpe.\n"
        "Norsminde Fjord er en fjord beliggende ca. 20 km syd for Aarhus. Den er lav."
    )
    assert (
        lead_sentences(text)[0]
        == "Norsminde Fjord er en fjord beliggende ca. 20 km syd for Aarhus."
    )
    assert split_sentences("Den er cirka. 2 km lang.") == ["Den er cirka. 2 km lang."]


def test_compass_words_end_sentences():
    assert split_sentences("Den går til Hals Barre i syd. Badestranden har laguner.") == [
        "Den går til Hals Barre i syd.",
        "Badestranden har laguner.",
    ]


def test_upload_url():
    thumb = (
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/X.jpg/330px-X.jpg"
        "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo"
    )
    assert upload_url(thumb) == (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/X.jpg/330px-X.jpg"
    )
    assert upload_url("https://upload.wikimedia.org/a.jpg") == "https://upload.wikimedia.org/a.jpg"
