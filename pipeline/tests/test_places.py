import json
import re
from datetime import date

import pytest

from pipeline.places import (
    DEFAULT_OUT,
    bbox_gap,
    build_index,
    coast_sites,
    main,
    nearest_town_postal,
    postal_for,
    read_towns,
    tidy_name,
)

POSTAL = [
    ["4640", "Faxe", 12.0, 55.1, 12.3, 55.3],
    ["4654", "Faxe Ladeplads", 12.1, 55.2, 12.3, 55.3],
]
# [name, lon, lat, radiusKm, postal index, type]
TOWNS = [
    ["Faxe", 12.12, 55.25, 1.5, 0, 0],
    ["Faxe Ladeplads", 12.16, 55.22, 0.8, 1, 0],
    ["Vemmetofte Strand", 12.24, 55.24, 0.5, 0, 2],
]


@pytest.mark.parametrize(
    ("raw", "tidy"),
    [
        ("VEMMETOFTE STRAND", "Vemmetofte Strand"),
        ("HULSIG V/KARREDVEJ", "Hulsig v/Karredvej"),
        ("GNIBEN,SEJERØ", "Gniben, Sejerø"),
        ("STIBJERG HUSE STR.", "Stibjerg Huse Strand"),
        ("KONGSTRUP STR.,SEJERØ", "Kongstrup Strand, Sejerø"),
        ("HALBJERG-VANGEN SYD", "Halbjerg-Vangen Syd"),
        ("SYD FOR MARBÆKGAARD", "Syd for Marbækgaard"),
        ("VED LUNDEN", "Ved Lunden"),
        ("HUSBY KLIT (ODBJERG STRAND)", "Husby Klit (Odbjerg Strand)"),
        ("HV.SANDE NORD", "Hv. Sande Nord"),
        ("GL. GULDAGERVEJ", "Gl. Guldagervej"),
        ("BADEBRO UD FOR RUNGSTED STR.VEJ 193A", "Badebro ud for Rungsted Strandvej 193a"),
        ("  ØRESUND,  SKODSBORG STRAND ", "Øresund, Skodsborg Strand"),
        # source noise: distances, compass letters, "F.", station codes, years
        ("100 M. N. FOR GL. LÆGTEN STRANDKRO", "100 m nord for Gl. Lægten Strandkro"),
        ("200 M. Ø. F. BØNNERUP HAVN", "200 m øst for Bønnerup Havn"),
        ("100 METER SV FOR UDLØB AF VESTERBÆK", "100 m sydvest for Udløb af Vesterbæk"),
        ("500M NORD FOR AALBÆK", "500 m nord for Aalbæk"),
        ("LOHALS STRAND 50 M S", "Lohals Strand 50 m syd"),
        ("ØGAVL 50M Ø", "Øgavl 50 m øst"),
        ("LANGØ N F. BASBJERG", "Langø nord for Basbjerg"),
        ("V. F. BØNNERUP HAVN (STRØMRENDE)", "Vest for Bønnerup Havn (Strømrende)"),
        ("DAGELÆKKE S", "Dagelække Syd"),
        ("TANGRENDEN N", "Tangrenden Nord"),
        ("URHØJGÅRD CAMPING N.", "Urhøjgård Camping Nord"),
        ("HELNÆS SOMMERLAND NØ", "Helnæs Sommerland Nordøst"),
        ("FALSLED S F. HAVN", "Falsled, syd for havnen"),
        ("Å Å 150M S (FRA 1990)", "Å, 150 m syd"),
        ("Å Å N", "Å Nord"),
        ("STAUNINGS Ø", "Staunings Ø"),
        ("ENDELAVE HAVNEMOLE 2015", "Endelave Havnemole"),
        ("VESTER LANGELAND, MOU (4261)", "Vester Langeland, Mou"),
        (
            "BJØRNEBÆK - UNDERSTATION DKBW1124 KRISTIANSHOLM PLANTAGE STRAND",
            "Bjørnebæk - Kristiansholm Plantage Strand",
        ),
        ('NOVOSTRANDEN - Ø.HURUP V/"NOVO-AREALET"', 'Novostranden - Øster Hurup v/"Novo-Arealet"'),
        ("BUGGYOMRÅDET ML. BADESTI 22 OG 23", "Buggyområdet mellem Badesti 22 og 23"),
        ("GEDSER SYD, 100 M. FRA MOLEN", "Gedser Syd, 100 m fra Molen"),
    ],
)
def test_tidy_name(raw, tidy):
    assert tidy_name(raw) == tidy


def test_nearest_town_postal_prefers_a_town_proper():
    # nearer to the holiday-home area (in 4640), but Faxe Ladeplads (4654) is a
    # town within a kilometre more
    assert nearest_town_postal((12.20, 55.23), TOWNS) == 1
    assert nearest_town_postal((12.12, 55.25), TOWNS) == 0
    assert nearest_town_postal((12.12, 55.25), [["X", 12.1, 55.2, 1.0, -1, 0]]) == -1


# A big city whose radius reaches a beach in the next district, as Aarhus
# reached Risskov and Copenhagen's centre reached Islands Brygge.
CITY_POSTAL = [
    ["8000", "Aarhus C", 10.17, 56.13, 10.22, 56.17],
    ["8240", "Risskov", 10.20, 56.17, 10.26, 56.23],
    ["8230", "Åbyhøj", 10.12, 56.14, 10.17, 56.17],
]
CITY_TOWNS = [
    ["Aarhus", 10.15, 56.155, 9.0, 2, 0],  # its centre sits in Åbyhøj's box
    ["Risskov", 10.235, 56.19, 1.2, 1, 1],
]


def test_postal_for_a_city_beach_is_the_district_it_lies_in():
    assert postal_for((10.24, 56.18), CITY_POSTAL, CITY_TOWNS) == 1  # Risskov Strandpark
    assert postal_for((10.21, 56.15), CITY_POSTAL, CITY_TOWNS) == 0  # Tangkrogen: no Åbyhøj
    # the name settles two boxes that both hold the site
    both = [
        ["3060", "Espergærde", 12.50, 55.95, 12.60, 56.02],
        ["3070", "Snekkersten", 12.55, 55.98, 12.62, 56.05],
    ]
    near = [["Skotterup", 12.571, 56.0, 0.1, 1, 1], ["Espergærde", 12.542, 55.992, 1.3, 0, 1]]
    assert postal_for((12.562, 55.994), both, near) == 1
    assert postal_for((12.562, 55.994), both, near, "Nord for Espergærde Havn") == 0
    # in no box (a harbour bath off the quay): the nearest box
    assert postal_for((10.225, 56.16), CITY_POSTAL, CITY_TOWNS) == 0
    assert postal_for((10.16, 56.16), [], CITY_TOWNS) == 2  # no boxes: the nearest town


def test_every_site_in_the_index_lies_in_its_district():
    index = json.loads(DEFAULT_OUT.read_text(encoding="utf-8"))
    postal = index["postal"]
    for name, lon, lat, i in index["coast"]:
        assert i >= 0, name
        assert bbox_gap((lon, lat), postal[i]) <= 0.01, (name, postal[i][:2])
    names = [c[0] for c in index["coast"]]
    assert not [n for n in names if re.search(r"Dkbw|\(Fra \d|\(\d{4}\)|M\.|F\. |^Å Å", n)]


def test_bare_names_get_their_district():
    sites = coast_sites([[12.13, 55.24, "STRAND 1"], [12.13, 55.24, "SKANSEVEJ 13"]], TOWNS, POSTAL)
    assert [s[0] for s in sites] == ["Skansevej 13 (Faxe)", "Strand 1 (Faxe)"]


def test_coast_sites_tidies_merges_and_sorts():
    rows = [
        [12.2401, 55.2402, "VEMMETOFTE STRAND", "1 - Excellent", "2024", "https://p"],
        [12.2451, 55.2410, "VEMMETOFTE STRAND", "1 - Excellent", "2024", "https://q"],  # 0.3 km
        [10.5, 57.7, "VEMMETOFTE STRAND", None, None, None],  # same name, far away: kept
        [12.15, 55.21, "FAXE LADEPLADS STR.", None, None, None],
        [12.0, 55.0, None, None, None, None],  # no name
    ]
    sites = coast_sites(rows, TOWNS)
    assert [s[0] for s in sites] == [
        "Faxe Ladeplads Strand",
        "Vemmetofte Strand",
        "Vemmetofte Strand",
    ]
    assert sites[2] == ["Vemmetofte Strand", 12.2401, 55.2402, 0]
    assert sites[0][3] == 1


def test_build_index_shape_and_roundtrip(tmp_path):
    index = build_index(POSTAL, TOWNS, [[12.24, 55.24, "VEMMETOFTE STRAND"]], date(2026, 11, 20))
    assert index["generated"] == "2026-11-20"
    assert "CC BY 4.0" in index["about"]
    assert index["coast"] == [["Vemmetofte Strand", 12.24, 55.24, 0]]
    path = tmp_path / "places.json"
    path.write_text(json.dumps(index), encoding="utf-8")
    assert read_towns(path) == (POSTAL, TOWNS)


def test_read_towns_rejects_a_bad_file(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"postal": POSTAL, "towns": [["X", 1, 2, 3, 9, 0]]}))
    with pytest.raises(ValueError, match="bad town"):
        read_towns(path)
    path.write_text(json.dumps({"postal": [], "towns": TOWNS}))
    with pytest.raises(ValueError, match="no postal"):
        read_towns(path)


def test_main_keeps_towns_and_refreshes_the_coast(tmp_path, monkeypatch):
    out = tmp_path / "places.json"
    out.write_text(json.dumps({"postal": POSTAL, "towns": TOWNS, "coast": []}), encoding="utf-8")
    monkeypatch.setattr(
        "pipeline.places.fetch_bathing_rows", lambda: [[12.24, 55.24, "VEMMETOFTE STRAND"]]
    )
    main(["--out", str(out)])
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["towns"] == TOWNS
    assert written["coast"][0][0] == "Vemmetofte Strand"
