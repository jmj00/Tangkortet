"""Round 2 of the place cards: softening texts, kinds, names, credits, photos
and shores (pipeline/placeinfo.py). The examples are the review's own."""

import pytest

from pipeline.placeinfo import (
    balance_parentheses,
    classify_kind,
    clean_author,
    ends_sentence,
    lead_sentences,
    lines_distance_m,
    name_kind,
    non_public_class,
    photo_meta_reason,
    photo_year,
    published_card,
    same_name,
    shore_lines,
    simplify_lines,
    text_from_override,
    trimmed_protection,
    unsafe_reason,
)

# --- softening texts ---


@pytest.mark.parametrize(
    ("sentence", "reason"),
    [
        (
            "Dets placering ved Flensborg Fjord gør den særdeles attraktiv for sejlere.",
            "praise",
        ),
        (
            "Knude Klint regnes for et af de smukkeste kystpartier ved Limfjorden.",
            "praise",
        ),
        ("Langs kysten går strandengene over i meget fine skovbryn.", "fine"),
        ("Stranden besøges årligt af 500.000 mennesker.", "visited"),
        (
            "Havnen er en udviklingsorienteret og moderne erhvervshavn med 30 virksomheder.",
            "marketing",
        ),
        ("Snekkersten strand er en badestrand i Helsingør Kommune.", "bathing place"),
        ("Den Permanente er en havbadeanstalt og strand i Aarhus.", "bathing place"),
        ("Blokhus Strand er en badestrand ved Jammerbugt.", "bathing place"),
        ("Halvøen er fredet på grund af sin landskabelige skønhed.", "praise"),
        ("Bolund er en meget iøjefaldende lille halvø.", "praise"),
        ("Det er et idyllisk fiskerleje.", "praise"),
        ("Stranden er populær om sommeren.", "praise"),
    ],
)
def test_praise_and_bathing_are_dropped(sentence, reason):
    assert unsafe_reason(sentence) == reason


@pytest.mark.parametrize(
    "sentence",
    [
        "Bognæs er en fredet halvø i bunden af Roskilde Fjord.",
        "Stranden er 300 meter lang og 20 meter bred.",
        "Grenen dannes af sand, der transporteres nordpå langs Jyllands vestkyst.",
        "Kolding Havn har eksisteret siden 1843.",
        "Havnen ligger i Finsensvej.",
    ],
)
def test_plain_facts_still_pass(sentence):
    assert unsafe_reason(sentence) is None


def test_a_protected_place_keeps_the_fact_without_the_praise():
    sentence = (
        "Halvøen og strandengen ud til og ved kysten er fredet i 1941 på grund af sin "
        "landskabelige skønhed og egenart."
    )
    assert trimmed_protection(sentence) == (
        "Halvøen og strandengen ud til og ved kysten er fredet i 1941."
    )
    assert trimmed_protection("Stranden er smuk og besøges af mange.") is None


def test_bolund_falls_back_to_the_protection_fact():
    text = (
        "Bolund er en meget iøjefaldende lille halvø der går ud fra østbredden af Roskilde "
        "Fjord, lidt nord for Risø. Halvøen og strandengen ud til og ved kysten er fredet i "
        "1941 på grund af sin landskabelige skønhed og egenart."
    )
    kept, dropped = lead_sentences(text)
    assert kept == "Halvøen og strandengen ud til og ved kysten er fredet i 1941."
    assert [d["reason"] for d in dropped] == ["praise", "praise"]


def test_after_a_dropped_first_sentence_the_next_clean_one_is_used():
    text = (
        "Snekkersten strand er en badestrand som ligger i Helsingør Kommune, i Nordsjælland. "
        "Stranden er 300 meter lang og 20 meter bred."
    )
    kept, dropped = lead_sentences(text)
    assert kept == "Stranden er 300 meter lang og 20 meter bred."
    assert dropped[0]["reason"] == "bathing place"


def test_a_sentence_leaning_on_a_dropped_one_is_not_used():
    text = "Palmestranden er en badestrand i Frederikshavn. Den er 500 m lang."
    assert lead_sentences(text)[0] is None


def test_a_dropped_second_sentence_ends_the_text():
    text = (
        "Marina Minde er en dansk lystbådehavn ved Egernsund, Sønderjylland. Dets placering ved "
        "Flensborg Fjord gør den særdeles attraktiv for sejlere."
    )
    kept, dropped = lead_sentences(text)
    assert kept == "Marina Minde er en dansk lystbådehavn ved Egernsund, Sønderjylland."
    assert dropped[0]["reason"] == "praise"


def test_text_cut_off_mid_sentence_is_never_emitted():
    # Venø Bugt: the extract ends in "... i bunden af bugten mod sydvest byen"
    text = "Venø Bugt er en ca. 100 km2 stor og op til 7 m dyb sydvendt bugt i Limfjorden byen"
    assert lead_sentences(text)[0] is None
    assert not ends_sentence("mod sydvest byen")
    assert ends_sentence("Den er fredet.")
    assert ends_sentence('Han sagde "ja."')


def test_an_override_text_must_be_whole_sentences_of_the_lead():
    lead = "Bratten Strand er en badestrand nord for Frederikshavn. Den ligger ved Kattegat."
    assert text_from_override("Den ligger ved Kattegat.", lead) == "Den ligger ved Kattegat."
    assert text_from_override("Den ligger ved Ålbæk Bugt.", lead) is None  # not in the lead
    assert text_from_override("Den ligger ved", lead) is None  # not a sentence
    # never a sentence the filter drops
    badestrand = "Bratten Strand er en badestrand nord for Frederikshavn."
    assert text_from_override(badestrand, lead) is None


# --- kinds ---


def test_kind_from_the_direct_p31_first():
    # Helgenæs: P31 peninsula
    assert classify_kind({"Q34763"}, {"peninsula", "beach"}, "Helgenæs") == "peninsula"
    # an item that is a marina by P31 and a harbour by P279*
    assert classify_kind({"Q721207"}, {"marina", "harbour"}, "Egå Marina") == "marina"


def test_kind_from_the_name_before_beach():
    # Blåvands Huk, Gedser Odde, Hovens Odde are "beaches" in Wikidata
    assert classify_kind({"Q40080"}, {"beach"}, "Blåvands Huk") == "headland"
    assert classify_kind({"Q40080"}, {"beach"}, "Gedser Odde") == "spit"
    assert classify_kind(set(), {"beach"}, "Hovens Odde") == "spit"
    assert classify_kind({"Q40080"}, {"beach"}, "Moesgård Strand") == "beach"
    assert name_kind("Enebærodde") == "spit"
    assert name_kind("Ordrup Næs") == "headland"
    assert name_kind("Svanemøllestranden") is None


def test_non_public_classes():
    assert non_public_class(["naval base", "harbour"]) == "naval base"
    assert non_public_class(["maritime museum"]) == "maritime museum"
    assert non_public_class(["port", "marina"]) is None


# --- names ---


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Fredericia Havn", "Fredericia Lystbådehavn"),
        ("Søby Havn", "Søby Lystbådehavn"),
        ("Gedser Havn", "Gedser Færgehavn"),
        ("Nakskov Havn", "Nakskov"),
        ("Stubbekøbing Havn", "Stubbekøbing"),
        ("Mommark Havn", "Mommark Marina"),
    ],
)
def test_different_generic_words_never_match(a, b):
    assert not same_name(a, b)


def test_a_beach_may_drop_its_generic_word():
    assert same_name("Bellevue Strand", "Bellevue")
    assert same_name("Hasle Havn", "Hasle havn")


# --- photo credits ---


@pytest.mark.parametrize(
    ("artist", "credit", "user", "expected"),
    [
        ("USer:Nico-dk / Nils Jepsen", None, None, "Nico-dk / Nils Jepsen"),
        ("Nils Jepsen /user: Nils Jepsen /user:Nico", None, None, "Nils Jepsen / Nico"),
        ("Nils Jepsen /bruger:Nico", None, None, "Nils Jepsen / Nico"),
        (
            "No machine-readable author provided. Ultramandk assumed (based on copyright claims).",
            None,
            None,
            "Ultramandk",
        ),
        ("heb @ Wikimedia Commons ( mail )", None, None, "heb"),
        ("Image: Mich Berg", None, None, "Mich Berg"),
        ("© Ra Boe / Wikipedia", None, None, "Ra Boe"),
        ("Stig Nygaard's", None, None, "Stig Nygaard"),
        ("Rasmus Brask Sørensen ( Brask", None, None, "Rasmus Brask Sørensen"),
        ("http://www.danskehavnelods.dk/", None, "Havnelods", "Havnelods"),
        ("", None, "Kristine Riskær", "Kristine Riskær"),
        ("ukendt", None, "Uploader", "Uploader"),
        ("", "", None, "ukendt"),
        ('<a href="//commons.wikimedia.org/wiki/User:Hjart">Hjart</a>', None, None, "Hjart"),
    ],
)
def test_clean_author(artist, credit, user, expected):
    assert clean_author(artist, credit, user) == expected


def test_balance_parentheses():
    assert balance_parentheses("Jens (Hansen") == "Jens "
    assert balance_parentheses("Jens) Hansen") == "Jens Hansen"
    assert balance_parentheses("Jens (J.) Hansen") == "Jens (J.) Hansen"


# --- photos ---


def test_maps_paintings_and_old_pictures_are_not_photos():
    ho_bugt = {
        "Categories": "Ho Bugt|PD Old|Maps of counties of Denmark from Frems Amtskort",
        "ImageDescription": "Map of <b>Ho Bugt</b> in Ribe County",
        "DateTimeOriginal": 'circa 1900<div style="display: none;">date QS:P,+1900</div>',
    }
    assert photo_meta_reason(ho_bugt).startswith("not a photo")
    assert photo_meta_reason({"DateTimeOriginal": "1870", "Categories": "Lammefjorden"}) == (
        "before 1950 (1870)"
    )
    painting = {"Artist": "A. Thorenfeldt (1839-1907)", "Categories": "Hjarbæk Fjord"}
    assert photo_meta_reason(painting).startswith("before 1950")
    assert photo_meta_reason({"Categories": "Paintings by Anton Thorenfeld"}).startswith(
        "not a photo"
    )
    assert photo_meta_reason({"Categories": "1930s photographs of Denmark"}).startswith("before")


def test_crowds_and_cars_are_not_the_subject():
    assert photo_meta_reason({"Categories": "Svanemøllestranden|People on beaches"}).startswith(
        "people"
    )
    assert photo_meta_reason({"Categories": "Automobiles in Frederikshavn"}).startswith("people")


def test_a_present_day_landscape_passes():
    meta = {
        "Categories": "Grenen|Beaches of Skagen|Sand dunes in Denmark",
        "ImageDescription": "Grenen seen from the lighthouse",
        "DateTimeOriginal": "2019-07-01 12:00:00",
    }
    assert photo_meta_reason(meta) is None
    assert photo_year("2009-06-27 09:22:25") == 2009
    assert photo_year("") is None


# --- shores ---

# A square peninsula 0.01° (~620 m by ~1.1 km) whose west side joins the
# mainland: the coastline runs along its north, east and south sides.
PENINSULA = [[(10.0, 56.0), (10.01, 56.0), (10.01, 56.01), (10.0, 56.01), (10.0, 56.0)]]
COAST = [
    [(9.99, 56.01), (10.0, 56.01), (10.01, 56.01), (10.01, 56.0), (10.0, 56.0), (9.99, 56.0)],
]


def test_the_shore_is_the_coastline_along_the_outline():
    shore = shore_lines(PENINSULA, COAST)
    assert len(shore) == 1
    # the inland west edge (10.0, 56.0..56.01) is not shore; the coastline
    # beyond the outline (9.99) is not either
    pts = shore[0]
    assert (9.99, 56.01) not in pts and (9.99, 56.0) not in pts
    assert (10.01, 56.01) in pts and (10.01, 56.0) in pts


def test_a_pin_inland_on_the_peninsula_is_far_from_its_shore():
    shore = shore_lines(PENINSULA, COAST)
    centre = (10.005, 56.005)  # ~310 m from the east side, ~550 m from north and south
    assert lines_distance_m(shore, centre) > 300
    assert lines_distance_m(shore, (10.009, 56.005)) < 100
    assert shore_lines(PENINSULA, []) == []


def test_simplified_shore_is_rounded_and_small():
    shore = simplify_lines(shore_lines(PENINSULA, COAST), max_points=10)
    assert sum(len(line) for line in shore) <= 10
    assert all(len(p) == 2 and p[0] == round(p[0], 5) for line in shore for p in line)


def test_published_card_carries_the_shore():
    rec = {
        "id": "Q1",
        "name": "Næsset",
        "kind": "peninsula",
        "lon": 10.0,
        "lat": 56.0,
        "shore": [[[10.0, 56.0], [10.01, 56.0]]],
        "description": "Næsset er en halvø.",
        "description_source": "wikipedia_da",
    }
    assert published_card(rec)["shore"] == rec["shore"]
    assert published_card({**rec, "dropped": True}) is None


def test_a_marina_named_havn_is_also_a_harbour():
    from pipeline.placeinfo import osm_groups

    assert osm_groups({"leisure": "marina", "name": "Hasle Havn"}) == {"marina", "harbour"}
    assert osm_groups({"leisure": "marina", "name": "Fredericia Lystbådehavn"}) == {"marina"}
    assert osm_groups({"leisure": "marina", "landuse": "harbour"}) == {"marina", "harbour"}
    assert osm_groups({"leisure": "marina", "name": "Nyborg Marina"}) == {"marina"}
