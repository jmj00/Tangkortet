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
    assert doc["expert"]["harvest_method"] == "hel_plade"  # expert, round 2
    assert doc["warnings"] and doc["invasive"] is False

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


def test_lookalikes_and_extra_keys_are_consistent():
    names = {s["scientific_name"] for s in TARGET_SPECIES}
    keys = [k for s in TARGET_SPECIES for k in [s["gbif_usage_key"], *s["gbif_extra_keys"]]]
    assert len(set(keys)) == len(keys)
    for sp in TARGET_SPECIES:
        assert set(sp["lookalikes"]) <= names, sp["scientific_name"]
        assert all(w.strip() for w in sp["warnings"])
        assert sp["danish_name"] or not sp["danish_name_verified"]


def test_manifest_sorts_by_shown_name(tmp_path):
    def summary(dk, sci):
        return {"danish_name": dk, "scientific_name": sci}

    manifest = write_manifest(
        tmp_path,
        [
            summary("Sukkertang", "Saccharina latissima"),
            summary("", "Ulva lacinulata"),
            summary("Almindelig søsalat", "Ulva fenestrata"),
        ],
        risk=None,
        version="test",
    )
    assert [s["scientific_name"] for s in manifest["species"]] == [
        "Ulva fenestrata",
        "Saccharina latissima",
        "Ulva lacinulata",
    ]


def test_observations_for_merges_keys_without_duplicates(monkeypatch):
    from pipeline.ingest import gbif

    records = {1: [obs(key=10), obs(key=11)], 2: [obs(key=11), obs(key=12)]}
    monkeypatch.setattr(gbif, "observations", lambda key: records[key])
    assert [o["gbif_id"] for o in gbif.observations_for([1, 2])] == [10, 11, 12]


def test_species_images_skip_rejected_and_thumbnail_uses_small(tmp_path, monkeypatch):
    import json

    from pipeline import publish

    monkeypatch.setattr(publish, "IMAGES_DIR", tmp_path)
    large = "https://inaturalist-open-data.s3.amazonaws.com/photos/123/large.jpg"
    (tmp_path / "palmaria-palmata.json").write_text(
        json.dumps(
            [
                {"url": large, "credit": "A", "license": "CC BY 4.0", "reviewed": True},
                {"url": "https://x/y.jpg", "credit": "B", "license": "CC0 1.0", "rejected": True},
            ]
        ),
        encoding="utf-8",
    )
    images = publish.species_images("palmaria-palmata")
    assert [i["credit"] for i in images] == ["A"]
    assert images[0]["reviewed"] is True
    assert publish.thumbnail(images) == large.replace("/large.", "/small.")
    assert publish.species_images("no-such-species") == []
    assert publish.thumbnail([]) is None


def test_every_images_file_belongs_to_a_species_and_is_well_formed():
    import json

    from pipeline.publish import IMAGES_DIR, slugify
    from pipeline.species import TARGET_SPECIES

    slugs = {slugify(sp["scientific_name"]) for sp in TARGET_SPECIES}
    for path in IMAGES_DIR.glob("*.json"):
        assert path.stem in slugs, path.name
        for img in json.loads(path.read_text(encoding="utf-8")):
            assert img["url"].startswith("https://")
            assert img["license"] in {"CC BY 4.0", "CC0 1.0"}
            assert img["credit"]
