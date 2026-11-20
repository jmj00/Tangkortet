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

Other fields: ``gbif_extra_keys`` (more GBIF keys whose records count for this
species, e.g. an outdated name), ``invasive``, ``lookalikes`` (scientific names
the expert says it is easily confused with) and ``warnings`` (Danish advice
shown prominently in the app). ``danish_name`` may be empty when the national
checklist has no Danish name; the app then shows the scientific name.

``status`` is ``"published"`` or ``"hidden"`` (kept to document an exclusion).
Every candidate starts published; the expert's "Med i første version?" answer
flips it.
"""

from __future__ import annotations

from typing import TypedDict


class Species(TypedDict):
    danish_name: str  # "" when the national checklist has none
    danish_name_verified: bool
    scientific_name: str
    synonyms: list[str]
    group: str  # "brunalge" | "rødalge" | "grønalge"
    status: str  # "published" | "hidden"
    gbif_usage_key: int
    gbif_extra_keys: list[int]
    depth_m: tuple[float, float] | None
    harvest_method: str | None
    season_months: list[int] | None
    accumulation: list[str] | None
    expert_verified: bool
    invasive: bool
    lookalikes: list[str]
    warnings: list[str]
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": "hel_plade",
        "season_months": None,
        "accumulation": ["jod"],
        "expert_verified": True,
        "invasive": False,
        "lookalikes": [],
        "warnings": [
            (
                "Laminaria-arter som sukkertang og fingertang kan indeholde meget "
                "store mængder jod. De kan spises, men man bør ikke spise store "
                "mængder dagligt."
            ),
        ],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": ["jod"],
        "expert_verified": True,
        "invasive": False,
        "lookalikes": [],
        "warnings": [
            (
                "Laminaria-arter som sukkertang og fingertang kan indeholde meget "
                "store mængder jod. De kan spises, men man bør ikke spise store "
                "mængder dagligt."
            ),
        ],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": "klip_skudspids",
        "season_months": None,
        "accumulation": None,
        "expert_verified": True,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": "klip_skudspids",
        "season_months": None,
        "accumulation": None,
        "expert_verified": True,
        "invasive": False,
        "lookalikes": [],
        "warnings": [
            (
                "Søl indeholder giftstoffet kainsyre (op til ca. 560 µg pr. gram "
                "tørret søl i målte prøver). Den kan spises, men man bør ikke spise"
                " store mængder dagligt."
            ),
        ],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
        "notes": "",
    },
    {
        "danish_name": "Almindelig søsalat",
        "danish_name_verified": True,
        "scientific_name": "Ulva fenestrata",
        "synonyms": ["Ulva lactuca"],
        "group": "grønalge",
        "status": "published",
        "gbif_usage_key": 5273511,
        "gbif_extra_keys": [5273309],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": ["Ulva lacinulata", "Ulva compressa"],
        "warnings": [],
        "notes": (
            "Danish 'Ulva lactuca' records are U. fenestrata after the "
            "taxonomic revision (expert, round 2); records under both names are"
            " merged."
        ),
    },
    {
        "danish_name": "Tarm-rørhinde",
        "danish_name_verified": True,
        "scientific_name": "Ulva intestinalis",
        "synonyms": [],
        "group": "grønalge",
        "status": "published",
        "gbif_usage_key": 5273394,
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": ["Ulva compressa"],
        "warnings": [],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
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
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
        "notes": "Rare in Danish waters (31 DK records, mostly drift); expert decides.",
    },
    {
        "danish_name": "Rød purpurhinde",
        "danish_name_verified": True,
        "scientific_name": "Porphyra purpurea",
        "synonyms": [],
        "group": "rødalge",
        "status": "published",
        "gbif_usage_key": 5275561,
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": [],
        "warnings": [],
        "notes": (
            "Added by the expert (round 2): grows at the top of the littoral "
            "zone. Danish name from the national species checklist."
        ),
    },
    {
        "danish_name": "",
        "danish_name_verified": False,
        "scientific_name": "Ulva lacinulata",
        "synonyms": [],
        "group": "grønalge",
        "status": "published",
        "gbif_usage_key": 8960338,
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": ["Ulva fenestrata"],
        "warnings": [],
        "notes": (
            "Added by the expert (round 2): documented in Danish waters, easily"
            " confused with U. fenestrata. No Danish name in the national "
            "checklist."
        ),
    },
    {
        "danish_name": "Flad rørhinde",
        "danish_name_verified": True,
        "scientific_name": "Ulva compressa",
        "synonyms": [],
        "group": "grønalge",
        "status": "published",
        "gbif_usage_key": 5273322,
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": False,
        "lookalikes": ["Ulva intestinalis", "Ulva fenestrata"],
        "warnings": [],
        "notes": (
            "Added by the expert (round 2), who called it 'tarm-rørhinde'; the "
            "national checklist name is 'Flad rørhinde' (asked on the review "
            "page)."
        ),
    },
    {
        "danish_name": "Brunlig gracilariatang",
        "danish_name_verified": True,
        "scientific_name": "Gracilaria vermiculophylla",
        "synonyms": [],
        "group": "rødalge",
        "status": "published",
        "gbif_usage_key": 5278964,
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": None,
        "expert_verified": False,
        "invasive": True,
        "lookalikes": [],
        "warnings": [],
        "notes": (
            "Invasive, now common (expert, round 2, who also called it "
            "'paryktang'). Danish name from arter.dk."
        ),
    },
    {
        "danish_name": "Butblæret sargassotang",
        "danish_name_verified": True,
        "scientific_name": "Sargassum muticum",
        "synonyms": [],
        "group": "brunalge",
        "status": "published",
        "gbif_usage_key": 3197314,
        "gbif_extra_keys": [],
        "depth_m": None,
        "harvest_method": None,
        "season_months": None,
        "accumulation": ["arsen"],
        "expert_verified": True,
        "invasive": True,
        "lookalikes": [],
        "warnings": [
            (
                "Butblæret sargassotang kan indeholde meget store mængder uorganisk"
                " arsen. Frarådes som fødevare – spis den i hvert fald aldrig i "
                "større mængder."
            ),
        ],
        "notes": (
            "Invasive, now common (expert, round 2): can hold very high "
            "inorganic arsenic. Related hijiki (S. fusiforme) is known for it."
        ),
    },
]


def published_species() -> list[Species]:
    return [s for s in TARGET_SPECIES if s["status"] == "published"]
