import json

from pipeline.ingest.gbif import normalise
from pipeline.publish import observed_depth, publish_species, species_doc, write_manifest
from pipeline.species import TARGET_SPECIES

RECORD = {
    "key": 42,
    "decimalLongitude": 10.123456,
    "decimalLatitude": 56.654321,
    "year": 1993,
    "depth": 9.0,
    "license": "http://creativecommons.org/licenses/by/4.0/legalcode",
    "datasetKey": "x",
}


def obs(**overrides):
    result = normalise({**RECORD, **overrides}, overrides.pop("_dataset", "NHMD"))
    assert result is not None
    return result


def test_normalise_rounds_and_classifies():
    o = obs()
    assert (o["lon"], o["lat"]) == (10.1235, 56.6543)
    assert o["attachment"] == "attached"
    assert o["depth_m"] == 9.0


def test_normalise_drops_uncertain_and_coordless():
    assert normalise({**RECORD, "coordinateUncertaintyInMeters": 20000}, "d") is None
    assert normalise({**RECORD, "decimalLatitude": None}, "d") is None


def test_zero_depth_is_not_a_depth():
    assert obs(depth=0.0)["depth_m"] is None


def test_observed_depth_needs_ten_records():
    assert observed_depth([obs(key=i) for i in range(9)]) is None
    many = [obs(key=i, depth=float(i + 1)) for i in range(10)]
    assert observed_depth(many) == {"n": 10, "p10": 2.0, "median": 5.5, "p90": 10.0}


def test_species_doc_packs_observations_and_datasets(tmp_path):
    sp = TARGET_SPECIES[0]
    beach = normalise({**RECORD, "key": 43, "depth": None, "habitat": "Beach"}, "iNat")
    assert beach is not None
    doc = species_doc(sp, [obs(), beach])
    assert doc["observations"] == [
        [10.1235, 56.6543, 1993, 0, 9.0, 0],
        [10.1235, 56.6543, 1993, 1, None, 1],
    ]
    assert [d["title"] for d in doc["datasets"]] == ["NHMD", "iNat"]
    assert doc["attachment_counts"] == {"attached": 1, "drift": 1, "unknown": 0}
    assert doc["expert"]["harvest_method"] is None

    summaries = publish_species(tmp_path, [doc])
    manifest = write_manifest(tmp_path, summaries, risk=None, version="test")
    entry = manifest["species"][0]
    assert entry["file"] == f"species/{doc['slug']}.json"
    assert json.loads((tmp_path / entry["file"]).read_text("utf-8")) == doc
    assert json.loads((tmp_path / "manifest.json").read_text("utf-8")) == manifest


def test_every_species_has_distinct_name_and_gbif_key():
    names = [s["scientific_name"] for s in TARGET_SPECIES]
    keys = [s["gbif_usage_key"] for s in TARGET_SPECIES]
    assert len(set(names)) == len(names)
    assert len(set(keys)) == len(keys)
