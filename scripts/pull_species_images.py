"""Pick a few CC-licensed photos per species and write data/images/<slug>.json.

From Svampekortet 624fb8b (scripts/pull_species_images.py), adapted to seaweed.

Source: iNaturalist Research-Grade observations via the GBIF occurrence API,
filtered to CC0 / CC BY 4.0 images whose taxon is the species (its GBIF key and
any extra keys, e.g. Ulva lactuca for Ulva fenestrata). Danish photos first;
species with too few fall back to the neighbouring North Sea / Baltic
countries, where the same species grow. Selection is deterministic (lowest
GBIF occurrence keys) so re-runs are stable and a later review can diff. Every
image is written with ``reviewed: false`` until the expert has looked at it.

    py scripts/pull_species_images.py                  # all published species
    py scripts/pull_species_images.py palmaria-palmata

A content-authoring tool, not part of the pipeline. An existing file is only
rewritten with ``--force``, so photos that have been reviewed are kept.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from pipeline.http import get_json  # noqa: E402
from pipeline.publish import IMAGES_DIR, slugify  # noqa: E402
from pipeline.species import TARGET_SPECIES, Species  # noqa: E402

INAT_RG_DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"
CC_LICENSES = ["CC0_1_0", "CC_BY_4_0"]
PER_SPECIES = 4
POOL = 100
# Denmark first, then the seas around it (same species, same shores), then
# the rest of the North Atlantic, then anywhere (None): a few species have
# almost no CC photos at all. The country is kept per photo for the review.
COUNTRIES: list[str | None] = ["DK", "SE", "NO", "DE", "NL", "GB", "IE", "FR", "IS"]
COUNTRIES += ["JE", "GG", "BE", "ES", "PT", "FO", "CA", "US", None]

LICENCE_LABEL = {
    "http://creativecommons.org/licenses/by/4.0/": "CC BY 4.0",
    "http://creativecommons.org/publicdomain/zero/1.0/": "CC0 1.0",
}


def _search(taxon_key: int, country: str | None) -> list[dict]:
    params = {
        "datasetKey": INAT_RG_DATASET,
        "mediaType": "StillImage",
        "license": CC_LICENSES,
        "taxonKey": taxon_key,
        "limit": POOL,
    }
    if country:
        params["country"] = country
    results = get_json("https://api.gbif.org/v1/occurrence/search", params).get("results", [])
    results.sort(key=lambda r: r.get("key", 0))
    picked: list[dict] = []
    for occ in results:
        image = next(
            (
                m
                for m in occ.get("media", [])
                if m.get("type") == "StillImage" and m.get("license") in LICENCE_LABEL
            ),
            None,
        )
        if image is None or not image.get("identifier"):
            continue
        picked.append(
            {
                "url": image["identifier"].replace("/original.", "/large."),
                "credit": image.get("creator") or image.get("rightsHolder") or "ukendt",
                "license": LICENCE_LABEL[image["license"]],
                "photo_url": image.get("references"),
                "observation_url": occ.get("references"),
                "country": occ.get("countryCode") or country,
                "source": "iNaturalist (Research Grade)",
                "reviewed": False,
            }
        )
    return picked


def candidate_images(species: Species) -> list[dict]:
    keys = [species["gbif_usage_key"], *species["gbif_extra_keys"]]
    picked: list[dict] = []
    seen: set[str] = set()
    for country in COUNTRIES:
        for key in keys:
            for img in _search(key, country):
                if img["url"] not in seen:
                    seen.add(img["url"])
                    picked.append(img)
        if len(picked) >= PER_SPECIES:
            break
    return picked[:PER_SPECIES]


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    for species in TARGET_SPECIES:
        if species["status"] != "published":
            continue
        slug = slugify(species["scientific_name"])
        if args and slug not in args:
            continue
        path = IMAGES_DIR / f"{slug}.json"
        if path.exists() and not force:
            print(f"{slug}: kept (exists; --force to replace)")
            continue
        images = candidate_images(species)
        path.write_text(json.dumps(images, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        countries = ",".join(sorted({str(i["country"]) for i in images}))
        print(f"{slug}: {len(images)} images ({countries}) -> {path.name}")


if __name__ == "__main__":
    main()
