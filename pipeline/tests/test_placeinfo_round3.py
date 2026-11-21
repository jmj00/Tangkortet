"""Round 3 of the place cards: ported licences, pictures whose subject is not
the shore, big bays' shores, the OpenStreetMap credit and the checks on
overrides.json (pipeline/placeinfo.py, scripts/pull_place_info.py)."""

import importlib.util
import pathlib

import pytest

from pipeline.placeinfo import (
    BAY_POINT_MAX_M,
    allowed_licence,
    bay_shore,
    licence_url,
    lines_distance_m,
    photo_meta_reason,
    published_card,
)

_SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "pull_place_info.py"
_spec = importlib.util.spec_from_file_location("pull_place_info", _SCRIPT)
pull = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pull)

# --- ported licences ---


@pytest.mark.parametrize(
    ("short", "url", "expected"),
    [
        (
            "CC BY-SA 3.0 de",
            "https://creativecommons.org/licenses/by-sa/3.0/de/deed.en",
            "CC BY-SA 3.0 DE",
        ),
        (
            "CC BY-SA 3.0",
            "https://creativecommons.org/licenses/by-sa/3.0/de/deed.en",
            "CC BY-SA 3.0 DE",
        ),
        ("CC BY 2.5 dk", None, "CC BY 2.5 DK"),
        ("CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0", "CC BY-SA 3.0"),
        ("CC BY-SA 3.0", None, "CC BY-SA 3.0"),
        ("CC BY-SA 3.0 migrated", None, "CC BY-SA 3.0"),
        ("CC0", "http://creativecommons.org/publicdomain/zero/1.0/deed.en", "CC0"),
    ],
)
def test_a_ported_licence_keeps_its_port(short, url, expected):
    assert allowed_licence(short, url) == expected


def test_the_deed_of_a_ported_licence():
    assert licence_url("CC BY-SA 3.0 DE", None) == (
        "https://creativecommons.org/licenses/by-sa/3.0/de/"
    )


# --- not the shore ---


@pytest.mark.parametrize(
    ("categories", "name", "word"),
    [
        ("Havnsø Havn|Motorhome stopovers in Denmark", "", "Motorhome"),
        ("Restaurants in Denmark|Faldsled Havn", "", "Restaurants"),
        ("Sønderborg Airport|Photographs by Erik Christensen", "", "Airport"),
        ("Shipyards in Denmark|Havnsø Havn", "", "Shipyards"),
        ("Agernæs (Nordfyn)|Yellow houses in Denmark", "", "houses"),
        ("Frederiksø (Svendborg)", "Svendborg Skibsværft 1973", "Skibsværft"),
    ],
)
def test_a_picture_of_something_else_is_not_the_shore(categories, name, word):
    reason = photo_meta_reason({"Categories": categories, "ObjectName": name})
    assert reason == f"not the shore ({word})"


def test_a_lighthouse_is_not_a_house():
    assert photo_meta_reason({"Categories": "Lighthouses in Denmark|Dueodde"}) is None


# --- a big bay's shore ---

# a bay opening to the east: the coast runs north, west and south of the
# point; a headland to the north-east hides the next bay's coast behind it
_K = 111320 * 0.5592  # metres per degree of longitude at 56°
_LAT = 110574


def _at(east_m: float, north_m: float) -> tuple[float, float]:
    return (10.0 + east_m / _K, 56.0 + north_m / _LAT)


_BAY = [_at(2000, 2000), _at(-2000, 2000), _at(-2000, -2000), _at(2000, -2000)]
# a headland reaching east from the north shore, then the next bay north of it
_BEHIND = [_at(2000, 2000), _at(2600, 2400), _at(2000, 2800), _at(-1500, 2800)]


def test_a_bay_shore_is_the_coast_round_its_point():
    shore, nearest = bay_shore([_BAY], _at(0, 0))
    assert nearest == pytest.approx(2000, abs=5)
    assert shore
    # a pin on the west shore is at it
    assert lines_distance_m(shore, _at(-2000, 0)) < 5


def test_a_coast_behind_a_headland_is_not_the_bay_shore():
    shore, _ = bay_shore([_BAY, _BEHIND], _at(0, 0))
    # the next bay's coast (north of the headland) is hidden from the point
    assert lines_distance_m(shore, _at(-1000, 2800)) > 500


def test_a_bay_point_far_out_gets_no_shore():
    far = _at(0, -(2000 + BAY_POINT_MAX_M + 500))
    shore, nearest = bay_shore([_BAY], far)
    assert shore == []
    assert nearest > BAY_POINT_MAX_M


def test_a_point_further_out_reaches_further():
    # 4 km from the nearest coast: the shore reaches 1.5 km beyond that
    shore, nearest = bay_shore([[_at(-4000, -3000), _at(-4000, 3000)]], _at(0, 0))
    assert nearest == pytest.approx(4000, abs=5)
    assert lines_distance_m(shore, _at(-4000, 0)) < 5


# --- the OpenStreetMap credit ---

_RECORD = {"id": "Q1", "name": "X", "kind": "harbour", "lon": 10.0, "lat": 56.0}


@pytest.mark.parametrize(
    ("by", "osm"),
    [("osm_wikidata", True), ("osm_name", True), ("osm_nearby", True), ("stednavne_name", False)],
)
def test_published_card_says_when_openstreetmap_matched_it(by, osm):
    card = published_card({**_RECORD, "match": {"by": by}})
    assert card.get("osm", False) is osm


# --- overrides.json ---


def test_an_override_photo_gets_its_file_prefix():
    o = pull.check_override("Q1", {"reason": "r", "photo": "Kær Vig.jpg"})
    assert o["photo"] == "File:Kær Vig.jpg"
    o = pull.check_override("Q1", {"reason": "r", "photo": "file: Kær Vig.jpg"})
    assert o["photo"] == "File:Kær Vig.jpg"


@pytest.mark.parametrize(
    ("qid", "entry", "message"),
    [
        ("Q1", {"reason": "r", "drop": "yes"}, "drop must be a bool"),
        ("Q1", {"reason": "r", "no_photo": 1}, "no_photo must be a bool"),
        ("Q1", {"reason": "r", "photo": "File:A.jpg", "no_photo": True}, "photo and no_photo"),
        ("Q1", {"reason": "r", "photo": "File: "}, "photo is empty"),
        ("Q1", {"reason": " "}, "needs a reason"),
        ("Q1", {"reason": "r", "colour": "red"}, "unknown keys"),
        ("Q1", {"reason": "r", "kind": "lagoon"}, "unknown kind"),
        ("Kær", {"reason": "r"}, "Wikidata id"),
    ],
)
def test_a_bad_override_stops_the_run(qid, entry, message):
    with pytest.raises(SystemExit, match=message):
        pull.check_override(qid, entry)


def test_a_far_marina_does_not_place_a_harbour():
    marina = {"kind": "marina"}
    assert pull.far_marina("harbour", marina, 984)
    assert not pull.far_marina("harbour", marina, 120)
    assert not pull.far_marina("marina", marina, 984)
    assert not pull.far_marina("harbour", {"kind": "harbour"}, 984)
