import json

import pytest

from pipeline.ingest.risk import (
    LAYERS,
    badevand_row,
    klapplads_row,
    point_row,
    rbu_row,
    rens_row,
)
from pipeline.publish import publish_risk

# Rold Skovvej 10, Horsens (pipeline/tests/test_geo.py) in EPSG:25832.
X, Y = 556004.23, 6186277.17


def point(**props):
    return {"geometry": {"type": "Point", "coordinates": [X, Y]}, "properties": props}


def square(size=100.0):
    ring = [[X, Y], [X + size, Y], [X + size, Y + size], [X, Y + size], [X, Y]]
    return ring


def test_rbu_row_classifies_overflow_vs_rainwater():
    row = rbu_row(point(bgv_type="OV", pkt_navn="BK34U", ejer="X A/S", udl_va_sta="14102"))
    assert row[0] == pytest.approx(9.8938, abs=1e-3)
    assert row[2:] == ["overloeb", "OV", "BK34U", "X A/S", 14102.0]
    assert rbu_row(point(bgv_type="SE"))[2] == "regnvand"
    assert rbu_row(point(bgv_type="UR"))[2] == "ukendt"
    assert rbu_row(point(bgv_type=None))[2:4] == ["ukendt", None]


def test_rens_row_parses_capacity():
    row = rens_row(point(pkt_navn="Boderne", ejer="BS", godk_pe="5000", rens_sta="MBK"))
    assert row[2:] == ["Boderne", "BS", 5000, "MBK"]
    assert rens_row(point(godk_pe="None"))[4] is None


def test_point_row_blank_text_is_none():
    assert point_row("navn", "typetekst")(point(navn=" Agernæs Havn ", typetekst=""))[2:] == [
        "Agernæs Havn",
        None,
    ]


def test_badevand_skips_lakes_and_uses_wgs84_fields():
    coastal = point(
        bathingwatertype="coastalBathingWater",
        bathingwatername="VEMMETOFTE STRAND",
        quality="1 - Excellent",
        season="2024",
        bwprofile="https://x",
        lon="12.23799",
        lat="55.2357",
    )
    assert badevand_row(coastal) == [
        12.23799,
        55.2357,
        "VEMMETOFTE STRAND",
        "1 - Excellent",
        "2024",
        "https://x",
    ]
    assert badevand_row(point(bathingwatertype="lakeBathingWater")) is None


def test_klapplads_row_centroid_and_radius():
    f = {
        "geometry": {"type": "MultiPolygon", "coordinates": [[square(1000.0)]]},
        "properties": {"navn": "Kolby Kås", "klapplads": "K_143_01"},
    }
    row = klapplads_row(active=True)(f)
    assert row[2:] == [564, "Kolby Kås", "K_143_01", True]  # sqrt(1e6 / pi)


def test_publish_risk_splits_into_cells_and_applies_bbox(tmp_path):
    rbu = next(layer for layer in LAYERS if layer.key == "rbu")
    rows = [
        [10.41, 56.21, "overloeb", "OV", "a", None, 1.0],
        [10.45, 56.25, "regnvand", "SE", "b", None, 2.0],
        [12.5, 55.7, "overloeb", "OS", "c", None, 3.0],
    ]
    index = publish_risk(tmp_path, [(rbu, rows)], 0.2, bbox=(10.0, 56.0, 11.0, 57.0))
    assert index["cells"] == ["52_281"]
    assert index["layers"]["rbu"]["count"] == 2
    assert index["layers"]["rbu"]["fields"][:3] == ["lon", "lat", "kind"]
    cell = json.loads((tmp_path / "risk" / "52_281.json").read_text("utf-8"))
    assert [r[4] for r in cell["rbu"]] == ["a", "b"]


def test_layer_keys_are_unique():
    keys = [layer.key for layer in LAYERS]
    assert len(set(keys)) == len(keys)
