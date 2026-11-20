import json
import pathlib

import pytest

from pipeline.ingest import coast

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "coast.osm"


def test_classify():
    assert coast.classify({"natural": "beach"}) == "beach"
    assert coast.classify({"natural": "wetland", "wetland": "tidalflat"}) == "tidalflat"
    assert coast.classify({"natural": "wetland", "wetland": "bog"}) is None
    assert coast.classify({"wetland": "saltmarsh"}) is None  # needs natural=wetland
    assert coast.classify({"leisure": "marina", "harbour": "yes"}) == "marina"
    assert coast.classify({"harbour": "yes"}) == "harbour"
    assert coast.classify({"landuse": "harbour"}) == "harbour"
    assert coast.classify({"landuse": "industrial", "industrial": "port"}) == "harbour"
    assert coast.classify({"seamark:type": "harbour", "leisure": "marina"}) == "marina"
    assert coast.classify({"man_made": "groyne"}) == "groyne"
    assert coast.classify({"man_made": "quay"}) is None
    assert coast.classify({"building": "yes"}) is None


def test_detail():
    assert coast.detail("beach", {"surface": " Pebblestone "}) == "pebblestone"
    assert coast.detail("beach", {}) is None
    assert coast.detail("pier", {"name": "Risskov Badebro"}) == "bade"
    assert coast.detail("pier", {"leisure": "bathing_place"}) == "bade"
    assert coast.detail("pier", {"name": "Lystbådehavnens bro"}) is None
    assert coast.detail("cliff", {"surface": "clay"}) is None


def test_encode_is_delta_in_1e5_degrees():
    assert coast.encode([(10.2, 56.15), (10.20001, 56.14998)]) == [1020000, 5615000, 1, -2]


def test_thin_ring_survives_simplification():
    # 5 m wide, 110 m long: an 8 m tolerance alone would collapse it
    ring = [(10.1999, 56.145), (10.19998, 56.145), (10.19998, 56.146), (10.1999, 56.146)]
    ring.append(ring[0])
    assert len(coast.simplify_ring(ring, 8.0)) >= 4


def test_line_runs_split_at_cell_borders():
    # crosses from cell 50_280 into 51_280 (border at 10.2 E)
    runs = coast._line_runs([(10.15, 56.1), (10.19, 56.1), (10.21, 56.1), (10.25, 56.1)], 0.2)
    assert runs["50_280"] == [[(10.15, 56.1), (10.19, 56.1), (10.21, 56.1)]]
    assert runs["51_280"] == [[(10.19, 56.1), (10.21, 56.1), (10.25, 56.1)]]


def test_coast_index_near():
    index = coast.CoastIndex([[(10.2, 56.14), (10.2, 56.16)]])
    assert index.near((10.205, 56.15))  # ~310 m east
    assert not index.near((10.21, 56.15))  # ~620 m east


def test_cells_in():
    assert coast.cells_in([(10.1, 56.1, 10.3, 56.1)], 0.2) == ["50_280", "51_280"]


def test_islet_coastline_keeps_its_ring():
    # a 40 x 30 m islet: as a line, 8 m Douglas-Peucker leaves A-B-A
    islet = [(10.3, 56.1), (10.3006, 56.1), (10.3006, 56.10027), (10.3, 56.10027)]
    islet.append(islet[0])
    ring = coast.simplify_coastline(islet)
    assert len(ring) >= 4 and ring[0] == ring[-1]
    assert coast._area_m2(ring) > 0.5 * coast._area_m2(islet)
    # a speck under a metre across is dropped rather than kept as a sliver
    speck = [(10.3, 56.1), (10.300001, 56.1), (10.300001, 56.100001), (10.3, 56.1)]
    assert coast.simplify_coastline(speck) == []
    # an open coastline stays a line
    assert coast.simplify_coastline([(10.2, 56.14), (10.2, 56.15), (10.2, 56.16)]) == [
        (10.2, 56.14),
        (10.2, 56.16),
    ]


def test_ring_is_simple():
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]
    bow_tie = [(0.0, 0.0), (1.0, 1.0), (1.0, 0.0), (0.0, 1.0), (0.0, 0.0)]
    assert coast.ring_is_simple(square)
    assert not coast.ring_is_simple(bow_tie)


def test_lake_features_are_dropped():
    coastline = coast.Feature("w1", "coastline", "l", [(10.2, 56.14), (10.2, 56.16)])
    near = coast.Feature("n2", "marina", "p", [(10.21, 56.15)])  # ~620 m
    lake = coast.Feature("n3", "marina", "p", [(10.0, 56.15)])  # ~12 km inland
    # a beach whose vertices are all >1 km away but whose edge crosses the coast
    long_edge = [(10.18, 56.15), (10.22, 56.15), (10.22, 56.1501), (10.18, 56.15)]
    crossing = coast.Feature("w4", "beach", "a", long_edge)
    extract = coast.Extract(features=[coastline, near, lake, crossing])
    kept = {f.id for f in coast.prepare(extract)}
    assert kept == {"w1", "n2", "w4"}
    assert extract.dropped_inland == {"marina": 1}


def test_read_and_prepare_fixture():
    pytest.importorskip("osmium")
    extract = coast.read_pbf(FIXTURE)
    kinds = sorted(f.kind for f in extract.features)
    assert kinds == sorted(
        ["coastline", "beach", "pier", "sand", "sand", "tidalflat", "harbour", "cliff", "groyne"]
    )
    features = {f.id: f for f in coast.prepare(extract)}
    assert extract.dropped_inland == {"sand": 1, "cliff": 1}
    beach = features["w101"]
    assert (beach.kind, beach.type, beach.name, beach.detail) == (
        "beach",
        "a",
        "Testby Strand",
        "sand",
    )
    assert len(beach.geom) >= 4 and beach.geom[0] == beach.geom[-1]
    assert features["w102"].detail == "bade"
    assert features["r200"].kind == "tidalflat"
    assert features["n50"].type == "p" and features["n50"].name == "Testby Havn"
    assert "w103" not in features and "w106" not in features
    assert features["w104"].kind == "sand"


def test_publish_coast(tmp_path):
    pytest.importorskip("osmium")
    stale = tmp_path / "coast" / "1_1.json"
    stale.parent.mkdir()
    stale.write_text("{}")
    index = coast.publish_coast(tmp_path, FIXTURE, 0.2, coverage=[(10.0, 56.0, 10.3, 56.19)])
    assert index["cells"] == ["50_280", "51_280"]
    assert index["coverage"] == ["50_280", "51_280"]
    assert index["license"] == "ODbL 1.0"
    assert index["license_url"].startswith("https://opendatacommons.org/licenses/odbl/")
    assert not stale.exists()
    west = json.loads((tmp_path / "coast" / "50_280.json").read_text("utf-8"))
    east = json.loads((tmp_path / "coast" / "51_280.json").read_text("utf-8"))
    # 10.2 / 0.2 is 50.999... in floating point, as in the browser (geo.ts)
    assert west["coastline"] == [
        [1020000, 5614000, 0, 2000]
    ]  # the straight middle point simplified away
    rows = {row[0]: row for row in west["features"]}
    assert rows["w101"][1:3] == ["beach", "a"]
    assert rows["w101"][4:] == ["Testby Strand", "sand"]
    rows = {row[0]: row for row in east["features"]}
    assert rows["n50"] == ["n50", "harbour", "p", [1020050, 5615500], "Testby Havn"]
    # the jetty starts on the coastline (cell 50) and runs into the sea (51)
    assert "w102" in rows and "r200" in rows


def test_build_without_extract_keeps_the_committed_coast_index(tmp_path, monkeypatch):
    # The deploy when Geofabrik is down and nothing is cached: no --coast.
    from pipeline import build

    sample = {"cell_deg": 0.2, "cells": ["51_280"], "coverage": ["51_280"], "license": "ODbL 1.0"}
    (tmp_path / "manifest.json").write_text(
        json.dumps({"species": [], "risk": {"cells": []}, "coast": sample}), "utf-8"
    )
    monkeypatch.setattr(build, "build_species", lambda out: [])
    monkeypatch.delenv("TANGKORTET_OSM_PBF", raising=False)
    monkeypatch.setattr("sys.argv", ["build", "--out", str(tmp_path), "--skip-risk"])
    build.main()
    manifest = json.loads((tmp_path / "manifest.json").read_text("utf-8"))
    assert manifest["coast"] == sample
    assert manifest["risk"] == {"cells": []}
