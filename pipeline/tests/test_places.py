import json
from datetime import date

import pytest

from pipeline.places import build_index, coast_sites, main, nearest_postal, read_towns, tidy_name

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
    ],
)
def test_tidy_name(raw, tidy):
    assert tidy_name(raw) == tidy


def test_nearest_postal_prefers_a_town_proper():
    # nearer to the holiday-home area (in 4640), but Faxe Ladeplads (4654) is a
    # town within a kilometre more
    assert nearest_postal((12.20, 55.23), TOWNS) == 1
    assert nearest_postal((12.12, 55.25), TOWNS) == 0
    assert nearest_postal((12.12, 55.25), [["X", 12.1, 55.2, 1.0, -1, 0]]) == -1


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
