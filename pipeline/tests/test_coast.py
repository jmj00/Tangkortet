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


osmium = pytest.importorskip("osmium")


def test_read_and_prepare_fixture():
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
    stale = tmp_path / "coast" / "1_1.json"
    stale.parent.mkdir()
    stale.write_text("{}")
    index = coast.publish_coast(tmp_path, FIXTURE, 0.2, coverage=[(10.0, 56.0, 10.3, 56.19)])
    assert index["cells"] == ["50_280", "51_280"]
    assert index["coverage"] == ["50_280", "51_280"]
    assert index["license"] == "ODbL 1.0"
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
