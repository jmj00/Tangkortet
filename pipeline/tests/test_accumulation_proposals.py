"""data/expert/accumulation_proposals.json stays consistent with the registry."""

import json

from pipeline.config import REPO_ROOT
from pipeline.publish import slugify
from pipeline.species import TARGET_SPECIES

PROPOSALS = json.loads(
    (REPO_ROOT / "data" / "expert" / "accumulation_proposals.json").read_text("utf-8")
)
FLAGS = {"jod", "arsen", "cadmium"}
EVIDENCE = {"dansk", "udenlandsk", "usikker", "ingen"}


def test_one_proposal_per_registered_species():
    assert set(PROPOSALS["species"]) == {slugify(s["scientific_name"]) for s in TARGET_SPECIES}


def test_proposals_are_well_formed():
    for slug, p in PROPOSALS["species"].items():
        assert p["evidence"] in EVIDENCE, slug
        assert p["flags"] is None or set(p["flags"]) <= FLAGS, slug
        assert len(p["text"]) > 40, slug
        for source in p["sources"]:
            assert source in PROPOSALS["sources"], (slug, source)
        # No data means no flags claimed, and claimed data must cite a source.
        assert (p["evidence"] == "ingen") == (p["flags"] is None), slug
        assert (p["evidence"] == "ingen") == (not p["sources"]), slug


def test_every_source_is_cited_and_has_a_doi():
    cited = {s for p in PROPOSALS["species"].values() for s in p["sources"]}
    assert cited == set(PROPOSALS["sources"])
    for key, source in PROPOSALS["sources"].items():
        assert source["doi"].startswith("10."), key
