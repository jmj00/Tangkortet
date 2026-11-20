"""One command: ingest -> publish.

    py -m pipeline.build                         # -> build/publish/
    py -m pipeline.build --out web/public/data --sample   # refresh the committed dev payload

Network only (GBIF, MiljøGIS). Species take ~20 s; the risk
layers ~15 s.
"""

from __future__ import annotations

import argparse
import json
import pathlib
from typing import Any

from pipeline.config import PUBLISH_DIR, RISK_CELL_DEG
from pipeline.ingest import gbif, risk
from pipeline.publish import publish_risk, publish_species, species_doc, write_manifest
from pipeline.species import published_species

# Aarhus Bugt, Mols and Djursland: coast, harbours, overflows and a dumping
# site, small enough to commit as the dev sample (web/public/data).
SAMPLE_BBOX = (10.0, 56.0, 10.8, 56.45)


def build_species(out: pathlib.Path) -> list[dict[str, Any]]:
    docs = []
    for sp in published_species():
        obs = gbif.observations(sp["gbif_usage_key"])
        doc = species_doc(sp, obs)
        docs.append(doc)
        print(f"  {sp['scientific_name']:24} {len(obs):5} obs  {doc['attachment_counts']}")
    return publish_species(out, docs)


def build_risk(out: pathlib.Path, bbox: tuple[float, float, float, float] | None) -> dict:
    layers = []
    for layer in risk.LAYERS:
        rows = list(layer.fetch())
        print(f"  {layer.key:12} {len(rows):6} features")
        layers.append((layer, rows))
    index = publish_risk(out, layers, RISK_CELL_DEG, bbox)
    print(f"  {len(index['cells'])} cells")
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Tangkortet payload.")
    parser.add_argument("--out", type=pathlib.Path, default=PUBLISH_DIR)
    parser.add_argument("--sample", action="store_true", help="risk layers for SAMPLE_BBOX only")
    parser.add_argument("--skip-risk", action="store_true", help="keep the existing risk index")
    args = parser.parse_args()

    print(f"species -> {args.out}")
    species = build_species(args.out)
    if args.skip_risk:
        previous = args.out / "manifest.json"
        risk_index = json.loads(previous.read_text("utf-8"))["risk"] if previous.exists() else None
    else:
        print("risk layers")
        risk_index = build_risk(args.out, SAMPLE_BBOX if args.sample else None)
    write_manifest(args.out, species, risk_index)


if __name__ == "__main__":
    main()
