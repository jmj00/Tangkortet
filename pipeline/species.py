"""Single source of truth for the target species.

Danish name is primary, scientific name always shown. ``danish_name`` must come
from the arter.dk ``vernacularName`` (docs/plan.md, "Content and safety");
``danish_name_verified`` is False where the spike only found a GBIF
vernacular name (Søsalat, Vingetang).

Fields the expert decides (the expert's brief and the review page) start as ``None``
and the UI shows "afventer ekspert" for them:

- ``depth_m``: ``(min, max)`` metres where it is harvested;
- ``harvest_method``: ``"klip_skudspids"`` | ``"hel_plade"`` | ``"andet"``;
- ``season_months``: best months to harvest, 1-12;
- ``accumulation``: subset of ``"jod"``, ``"arsen"``, ``"cadmium"`` to warn about.

``expert_verified`` flips to True once the expert has signed off those fields;
until then the UI labels them "foreløbig". The *observed* depth range is not
stored here; it is computed from the observations at publish time.

``status`` is ``"published"`` or ``"hidden"`` (kept to document an exclusion).
Every candidate starts published; the expert's "Med i første version?" answer
flips it.
"""

from __future__ import annotations

from typing import TypedDict


class Species(TypedDict):
    danish_name: str
    danish_name_verified: bool
    scientific_name: str
    synonyms: list[str]
    group: str  # "brunalge" | "rødalge" | "grønalge"
    status: str  # "published" | "hidden"
    gbif_usage_key: int
    depth_m: tuple[float, float] | None
    harvest_method: str | None
    season_months: list[int] | None
    accumulation: list[str] | None
    expert_verified: bool
    notes: str


TARGET_SPECIES: list[Species] = [
    {
        "danish_name": "Sukkertang",
        "danish_name_verified": True,
        "scientific_name": "Saccharina latissima",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 4377207,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Fingertang",
        "danish_name_verified": True,
        "scientific_name": "Laminaria digitata",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 5422479,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Blæretang",
        "danish_name_verified": True,
        "scientific_name": "Fucus vesiculosus",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 8222574,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Savtang",
        "danish_name_verified": True,
        "scientific_name": "Fucus serratus",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 3196437,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Buletang",
        "danish_name_verified": True,
        "scientific_name": "Ascophyllum nodosum",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 3196524,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Søl",
        "danish_name_verified": True,
        "scientific_name": "Palmaria palmata",
        "synonyms": [],
        "group": "rødalge",
        "status": "published",
        "gbif_usage_key": 7843860,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Carrageentang",
        "danish_name_verified": True,
        "scientific_name": "Chondrus crispus",
        "synonyms": [],
        "group": "rødalge",
        "status": "published",
        "gbif_usage_key": 5279115,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Søsalat",
        "danish_name_verified": False,
        "scientific_name": "Ulva lactuca",
        "synonyms": [],
        "group": "grønalge",
        "status": "published",
        "gbif_usage_key": 5273309,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Tarm-rørhinde",
        "danish_name_verified": True,
        "scientific_name": "Ulva intestinalis",
        "synonyms": [],
        "group": "grønalge",
        "status": "published",
        "gbif_usage_key": 5273394,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Strengetang",
        "danish_name_verified": True,
        "scientific_name": "Chorda filum",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 3195749,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Navle-purpurhinde",
        "danish_name_verified": True,
        "scientific_name": "Porphyra umbilicalis",
        "synonyms": [],
        "group": "rødalge",
        "status": "published",
        "gbif_usage_key": 5275705,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "",
    },
    {
        "danish_name": "Vingetang",
        "danish_name_verified": False,
        "scientific_name": "Alaria esculenta",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 5422592,
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "notes": "Rare in Danish waters (31 DK records, mostly drift); expert decides.",
    },
]


def published_species() -> list[Species]:
    return [s for s in TARGET_SPECIES if s["status"] == "published"]
