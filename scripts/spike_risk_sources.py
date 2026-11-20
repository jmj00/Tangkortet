"""Phase-0 spike: are the contamination-risk sources reachable, and how big are they?

    py scripts/spike_risk_sources.py

Prints one line per source: feature count (or a live sample) and status. No
auth needed for any of them. Findings and terms are written up in
docs/data-sources.md; this script is the reproducible half and the seed of a
later `pipeline/contracts.py` (weekly API-drift check, as in Svampekortet).
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

MILJOEGIS = "https://wfs2-miljoegis.mim.dk/{ws}/ows"
MILJOEPORTAL = "https://arealeditering-dist-geo.miljoeportal.dk/geoserver/ows"
VD_JORD = "https://kort.vd.dk/server/rest/services/Grunddata/Jordforurening/MapServer"
DMI_METOBS = "https://opendataapi.dmi.dk/v2/metObs/collections/observation/items"

# (label, base url, WFS typeName)
WFS_LAYERS = [
    ("Regnbetingede udløb (RBU)", MILJOEGIS, "vp4basis2026:vp4_ba_26_punkt_rbu_saml"),
    ("Renseanlæg", MILJOEGIS, "vp4basis2026:vp4_ba_26_punkt_rens_saml"),
    ("Industriudledninger", MILJOEGIS, "vp4basis2026:vp4_ba_26_punkt_ind_saml"),
    ("Akvakultur (hav/dambrug)", MILJOEGIS, "vp4basis2026:vp4_ba_26_punkt_havdam_saml"),
    ("Havne", MILJOEGIS, "vp4basis2026:vp4_ba_26_havne"),
    ("Klappladser", MILJOEGIS, "vp4basis2026:vp4_ba_26_klappladser"),
    ("Nedlagte klappladser", MILJOEGIS, "vp4basis2026:vp4_ba_26_nedlagte_klappladser"),
    ("Badevand (EU-kvalitet)", MILJOEGIS, "vp4basis2026:vp4_ba_26_badevand"),
    ("Kystvande, tilstand", MILJOEGIS, "vp3_2endelig2025:vp3_2e2025_marin_saml_punkt"),
    ("Natura 2000 habitat", MILJOEPORTAL, "dai:habitat_omr"),
    ("Natura 2000 fugle", MILJOEPORTAL, "dai:fugle_bes_omr"),
    ("Fredede områder", MILJOEPORTAL, "dai:fredede_omr"),
    ("Vildtreservater", MILJOEPORTAL, "dai:natur_vildt_reservat"),
]


def fetch(url: str, **params) -> str:
    full = f"{url}?{urllib.parse.urlencode(params)}" if params else url
    with urllib.request.urlopen(full, timeout=120) as r:
        return r.read().decode("utf-8", "replace")


def wfs_hits(base: str, layer: str) -> int:
    url = base.format(ws=layer.split(":")[0])
    xml = fetch(
        url,
        service="WFS",
        version="2.0.0",
        request="GetFeature",
        typeNames=layer,
        resultType="hits",
    )
    return int(re.search(r'numberMatched="(\d+)"', xml).group(1))


def main() -> None:
    for label, base, layer in WFS_LAYERS:
        try:
            print(f"{label:28} {wfs_hits(base, layer):>7}  {layer}")
        except Exception as e:  # noqa: BLE001 -- a spike reports, it doesn't stop
            print(f"{label:28} {'FAIL':>7}  {layer}: {e}")

    for label, layer_id in (("Jordforurening V1 (VD)", 5), ("Jordforurening V2 (VD)", 6)):
        try:
            n = json.loads(
                fetch(f"{VD_JORD}/{layer_id}/query", where="1=1", returnCountOnly="true", f="json")
            )["count"]
            print(f"{label:28} {n:>7}  {VD_JORD}/{layer_id}")
        except Exception as e:  # noqa: BLE001
            print(f"{label:28} {'FAIL':>7}  {e}")

    try:
        obs = json.loads(
            fetch(
                DMI_METOBS,
                parameterId="precip_past1h",
                limit="1",
                sortorder="observed,DESC",
            )
        )["features"][0]["properties"]
        print(f"{'DMI nedbør (seneste time)':28} {'OK':>7}  observed {obs['observed']}")
    except Exception as e:  # noqa: BLE001
        print(f"{'DMI nedbør':28} {'FAIL':>7}  {e}")


if __name__ == "__main__":
    main()
