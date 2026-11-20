"""One command: ingest -> publish.

    py -m pipeline.build                         # -> build/publish/
    py -m pipeline.build --out web/public/data --sample   # refresh the committed dev payload

    # with the coast cells from an OpenStreetMap extract (downloaded there if absent):
    py -m pipeline.build --coast build/osm/denmark-latest.osm.pbf
    # only the coast cells, keeping species and risk from the existing manifest:
    py -m pipeline.build --out web/public/data --sample --coast <pbf> --coast-only

Network only (GBIF, MiljøGIS), plus the local OSM extract for the coast.
Species take ~20 s; the risk layers ~15 s; the coast ~30 s for all of Denmark.
The coast PBF can also come from the environment variable TANGKORTET_OSM_PBF.
Without either, the coast index of the existing manifest is kept.

    # official coastal place names (Danske Stednavne, CC BY 4.0), from the
    # file pipeline.ingest.stednavne writes, build/stednavne/stednavne.json (it needs
    # Datafordeler credentials):
    py -m pipeline.build --out web/public/data --sample --names-only --names <file>

The names file can also come from TANGKORTET_STEDNAVNE; without either, the
names index of the existing manifest is kept.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
from typing import Any

from pipeline.config import PUBLISH_DIR, RISK_CELL_DEG
from pipeline.ingest import coast, gbif, risk, stednavne
from pipeline.publish import publish_risk, publish_species, species_doc, write_manifest
from pipeline.species import published_species

# Aarhus Bugt, Mols and Djursland: coast, harbours, overflows and a dumping
# site, small enough to commit as the dev sample (web/public/data).
SAMPLE_BBOX = (10.0, 56.0, 10.8, 56.45)
# The coast sample adds a piece of the Wadden Sea (Mandø, the tidal flats),
# which the Aarhus area has none of.
COAST_SAMPLE_BBOXES = (SAMPLE_BBOX, (8.45, 55.22, 8.75, 55.38))


def build_species(out: pathlib.Path) -> list[dict[str, Any]]:
    docs = []
    for sp in published_species():
        obs = gbif.observations_for([sp["gbif_usage_key"], *sp["gbif_extra_keys"]])
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


def build_coast(out: pathlib.Path, pbf: pathlib.Path, sample: bool) -> dict:
    if not pbf.exists():
        print(f"  downloading {coast.GEOFABRIK_URL} -> {pbf}")
        coast.download(pbf)
    return coast.publish_coast(out, pbf, RISK_CELL_DEG, COAST_SAMPLE_BBOXES if sample else None)


def build_names(out: pathlib.Path, path: pathlib.Path, sample: bool) -> dict:
    return stednavne.publish_names(
        out, path, RISK_CELL_DEG, COAST_SAMPLE_BBOXES if sample else None
    )


def previous(out: pathlib.Path) -> dict[str, Any]:
    path = out / "manifest.json"
    return json.loads(path.read_text("utf-8")) if path.exists() else {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Tangkortet payload.")
    parser.add_argument("--out", type=pathlib.Path, default=PUBLISH_DIR)
    parser.add_argument("--sample", action="store_true", help="risk layers for SAMPLE_BBOX only")
    parser.add_argument("--skip-risk", action="store_true", help="keep the existing risk index")
    parser.add_argument(
        "--coast",
        type=pathlib.Path,
        default=os.environ.get("TANGKORTET_OSM_PBF") or None,
        help="OpenStreetMap Denmark .osm.pbf for the coast cells (downloaded if absent)",
    )
    parser.add_argument(
        "--coast-only",
        action="store_true",
        help="rebuild only the coast cells; species and risk stay as in the existing manifest",
    )
    parser.add_argument(
        "--names",
        type=pathlib.Path,
        default=os.environ.get("TANGKORTET_STEDNAVNE") or None,
        help="coastal place names from pipeline.ingest.stednavne (Danske Stednavne, CC BY 4.0)",
    )
    parser.add_argument(
        "--names-only",
        action="store_true",
        help="rebuild only the names cells; everything else stays as in the existing manifest",
    )
    args = parser.parse_args()
    old = previous(args.out)

    if args.names_only:
        if not args.names:
            parser.error("--names-only needs --names (or TANGKORTET_STEDNAVNE)")
        print(f"names <- {args.names}")
        names_index = build_names(args.out, pathlib.Path(args.names), args.sample)
        write_manifest(
            args.out,
            old["species"],
            old.get("risk"),
            coast=old.get("coast"),
            names=names_index,
            version=old.get("version"),
        )
        return
    if args.coast_only:
        if not args.coast:
            parser.error("--coast-only needs --coast (or TANGKORTET_OSM_PBF)")
        species, risk_index = old["species"], old.get("risk")
    else:
        print(f"species -> {args.out}")
        species = build_species(args.out)
        if args.skip_risk:
            risk_index = old.get("risk")
        else:
            print("risk layers")
            risk_index = build_risk(args.out, SAMPLE_BBOX if args.sample else None)
    if args.coast:
        print(f"coast <- {args.coast}")
        coast_index = build_coast(args.out, pathlib.Path(args.coast), args.sample)
    else:
        coast_index = old.get("coast")
    if args.names and pathlib.Path(args.names).exists():
        print(f"names <- {args.names}")
        names_index = build_names(args.out, pathlib.Path(args.names), args.sample)
    else:
        if args.names:
            print(f"  warning: {args.names} not found; keeping the existing names index")
        names_index = old.get("names")
    write_manifest(args.out, species, risk_index, coast=coast_index, names=names_index)


if __name__ == "__main__":
    main()
