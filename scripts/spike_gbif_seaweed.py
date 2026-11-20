"""Phase-0 spike: what does GBIF hold for the candidate seaweed species in Denmark?

    py scripts/spike_gbif_seaweed.py   # -> data/expert/species_evidence.json

Per candidate species: Danish record counts by dataset and decade, the depth
distribution of records that carry one, how many records the attachment rules
(docs/adr/0003) classify as attached / drift / unknown, and the Danish name as
carried by the arter.dk dataset's ``vernacularName`` (the naming source of
truth, docs/plan.md). Network only, no dependencies beyond the stdlib.
"""

from __future__ import annotations

import collections
import functools
import json
import pathlib
import statistics
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from pipeline.attachment import classify  # noqa: E402

API = "https://api.gbif.org/v1"
ARTER_DK = "963a6b96-4d22-4428-86e4-afee52cf4a8e"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "expert" / "species_evidence.json"

CANDIDATES = [
    "Saccharina latissima",
    "Laminaria digitata",
    "Fucus vesiculosus",
    "Fucus serratus",
    "Ascophyllum nodosum",
    "Palmaria palmata",
    "Chondrus crispus",
    "Ulva lactuca",
    "Ulva intestinalis",
    "Chorda filum",
    "Porphyra umbilicalis",
    "Alaria esculenta",
]


def get(path: str, **params) -> dict:
    url = f"{API}/{path}?{urllib.parse.urlencode(params, doseq=True)}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except OSError:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(url)


def records(taxon_key: int) -> list[dict]:
    out, offset = [], 0
    while True:
        page = get("occurrence/search", country="DK", taxonKey=taxon_key, limit=300, offset=offset)
        out += page["results"]
        offset += 300
        if page["endOfRecords"] or offset >= 5000:
            return out


def danish_name(taxon_key: int) -> tuple[str | None, str]:
    page = get("occurrence/search", datasetKey=ARTER_DK, taxonKey=taxon_key, limit=50)
    names = collections.Counter(
        r["vernacularName"].strip() for r in page["results"] if r.get("vernacularName")
    )
    if names:
        return names.most_common(1)[0][0], "arter.dk vernacularName"
    vn = get(f"species/{taxon_key}/vernacularNames", limit=200)["results"]
    dan = [v["vernacularName"] for v in vn if v.get("language") == "dan"]
    return (dan[0] if dan else None), "GBIF vernacularNames (unverified)"


@functools.cache
def dataset_title(key: str) -> str:
    return get(f"dataset/{key}")["title"]


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return round(s[min(len(s) - 1, int(q * len(s)))], 1)


def main() -> None:
    evidence = []
    for name in CANDIDATES:
        match = get("species/match", name=name, kingdom="Chromista")
        key = match.get("usageKey") or get("species/match", name=name)["usageKey"]
        recs = records(key)
        depths = [float(r["depth"]) for r in recs if r.get("depth") is not None]
        dk_name, name_source = danish_name(key)
        datasets = collections.Counter(dataset_title(r["datasetKey"]) for r in recs)
        decades = collections.Counter(
            f"{r['year'] // 10 * 10}s" for r in recs if isinstance(r.get("year"), int)
        )
        attach = collections.Counter(classify(r) for r in recs)
        evidence.append(
            {
                "scientific_name": name,
                "gbif_usage_key": key,
                "danish_name": dk_name,
                "danish_name_source": name_source,
                "records_dk": len(recs),
                "records_since_2015": sum(1 for r in recs if (r.get("year") or 0) >= 2015),
                "top_datasets": datasets.most_common(4),
                "decades": dict(sorted(decades.items())),
                "attachment": dict(attach),
                "depth": (
                    {
                        "n": len(depths),
                        "p10": pct(depths, 0.1),
                        "median": round(statistics.median(depths), 1),
                        "p90": pct(depths, 0.9),
                    }
                    if depths
                    else None
                ),
            }
        )
        print(name, key, dk_name, len(recs), evidence[-1]["depth"], dict(attach))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
