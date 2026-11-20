# Data sources: access, terms, validity

Living document, carried over from Svampekortet's practice: nothing gets built
on a source until its row here is complete. Phase-0 spikes run 2026-10-23 (risk layers re-checked in the pipeline build, PR 5):
`scripts/spike_gbif_seaweed.py` (observations) and
`scripts/spike_risk_sources.py` (risk layers). Rerun them to refresh the counts.

## Summary

### Observations and species

| Source | Access | Auth | Status |
|---|---|---|---|
| GBIF occurrence API, `country=DK` | `https://api.gbif.org/v1/occurrence/search` | none | **verified**: 30–1,625 DK records per candidate species; see `data/expert/species_evidence.json` |
| NHMD Phycology Herbarium (via GBIF) | dataset "NHMD Phycology Herbarium - static" | none | **verified**: the bulk of all records, mostly 1990s reef-diving surveys **with depth** |
| arter.dk (via GBIF, dataset `963a6b96-4d22-4428-86e4-afee52cf4a8e`) | as Svampekortet | none | **verified**: the naming source of truth (`vernacularName`); few seaweed records |
| iNaturalist research-grade (via GBIF) | as above | none | **verified**: most recent shore records (e.g. 504 *Fucus vesiculosus*) |
| NOVANA macroalgae reef monitoring (DCE / VanDa / ODA) | not found as an open download | ? | **deferred**: GBIF depth data is good enough for v1 |

### Contamination risk (brief §1)

All layers below answer anonymous WFS 2.0 / ArcGIS REST requests, are national,
and come in EPSG:25832 (MiljøGIS) unless noted.

| Risk factor | Layer | Features | Notes |
|---|---|---|---|
| Spildevand: regnbetingede udløb / overløb | MiljøGIS `vp4basis2026:vp4_ba_26_punkt_rbu_saml` | 20,640 | Point per outlet, owner, yearly volume (`udl_va_sta` m³), type (`bgv_type`, e.g. `OS` = overløb fra fællessystem), data year 2024 |
| Spildevand: renseanlæg | MiljøGIS `…punkt_rens_saml` | 633 | Name, owner, design capacity (PE), treatment level, yearly load |
| Industri (current discharges) | MiljøGIS `…punkt_ind_saml` | 76 | Direct industrial discharges only. Historic industry comes via soil contamination below |
| Akvakultur | MiljøGIS `…punkt_havdam_saml` | 27 | Sea/land-based fish farms |
| Havne og sejlads | MiljøGIS `vp4basis2026:vp4_ba_26_havne` | 458 | Name, `erhvervshavn` / `lystbaadehavn` flags |
| Sediment: klappladser | MiljøGIS `…klappladser` + `…nedlagte_klappladser` | 81 + 44 | Polygons. MST INSPIRE record: **CC BY 4.0**, no access limits |
| Badevandskvalitet (season class) | MiljøGIS `vp4basis2026:vp4_ba_26_badevand` | 1,049 | EU class (`quality`: "1 - Excellent" …), season 2024, name, lat/lon, link to the bathing-water profile. MST INSPIRE record: **CC BY 4.0**. Also a ready list of named beaches for "kyster nær mig" |
| Kystvande: kemisk / økologisk tilstand | MiljøGIS `vp3_2endelig2025:vp3_2e2025_marin_saml_punkt` | 89 | One point per coastal water body, `ov_til_kem` ("Ikke-god kemisk tilstand"), `til_oko_sm`. Polygon layer still to locate (phase 3) |
| Industri og historisk forurening: V1/V2 | Vejdirektoratet ArcGIS mirror of DKJord, `kort.vd.dk/…/Grunddata/Jordforurening/MapServer/5` (V1) and `/6` (V2) | 29,808 / 34,808 rows | **Geometry is withheld** (layer extent NaN, no shapes returned), so it can't be precomputed. Spatial queries still work, so the client asks it live: point + `distance=1000` m, `returnDistinctValues`, CORS allowed. Rows repeat per cadastral parcel, so dedupe by `lokalitetsnr`. **A third-party mirror with unstated terms.** The authoritative source is Miljøportalen's Arealdata (`dkjord-5`), which has no service URL or download API we could find. Ask Miljøportalen before launch |
| Naturbeskyttelse: Natura 2000 | Miljøportalen WFS `dai:habitat_omr`, `dai:fugle_bes_omr` | 269 / 125 | Shown as *collecting rules*, not contamination |
| Naturbeskyttelse: fredninger, reservater | Miljøportalen WFS `dai:fredede_omr`, `dai:natur_vildt_reservat` | 4,176 / 94 | Same |
| Kraftig nedbør 24/48/72 h | DMI `metObs` `precip_past1h` (stations, hourly, up to the latest hour) | live | No key; **CORS `*`**, so the browser can fetch it directly (no daily rebuild needed). Svampekortet's `climateData` client also works for daily totals |
| Live badevandsvarsler | badevand.dk (DHI) `/api/next/beaches` | n/a | **Not usable**: protected by reCAPTCHA. Link out instead. A data agreement with DHI is a user decision |
| Model-based overflow risk per beach | ditbadevand.dk (Talefod A/S) | n/a | **Link only.** A private company's free service: a screening model of overflow risk (its own validation: AUC 0.61, "only slightly better than random"), no published data terms. Suggested by the expert; linked from the app, not used as data |
| Advice for private foragers and collecting rules | Fødevarestyrelsen: [consumer advice](https://www.foedevarestyrelsen.dk/kost-og-foedevarer/alt-om-mad/god-koekkenhygiejne/saadan-goer-du/tang), [business rules](https://www.foedevarestyrelsen.dk/kost-og-foedevarer/start-og-drift-af-foedevarevirksomhed/specifikke-foedevarer-hygiejneregler/tang-og-mikroalger) | n/a | Paraphrased in the guide: pick in the water, not on the beach; avoid harbours, towns, streams and outlets; know the species; collecting to sell requires registration. Neither page names species |
| Opblomstringer (alger, cyanobakterier) | none found | n/a | Link out + checklist item |
| Landbrug og dræn, vandløb | Miljøportalen `dai:bes_vandloeb`; MiljøGIS coastal catchments (`…kystvand_opland_afg`) | n/a | Available, not yet sized. Phase 3 decides whether "a stream mouth nearby" is worth showing |
| Strøm og vandudskiftning | none | n/a | Checklist text only (brief §2) |

### Accumulation (iodine, arsenic, cadmium)

| Source | Notes |
|---|---|
| Susan Løvstad Holdt, DTU (recommended by the expert, round 1) | **Used, 2026-11-01**: her Danish measurements (Sá Monteiro, Sloth, Holdt & Hansen 2019, EFSA Journal) and blanching study (Nielsen, Holdt et al. 2020, Foods), plus two non-Holdt papers for species she didn't cover. Gives *proposals* per species, shown on the review page for the expert to confirm; not in the app yet. See [`literature-accumulation.md`](literature-accumulation.md) |

### Basemap and address search

As in Svampekortet (Skærmkort WMS, Adressevælgeren, both Datafordeler API-Key),
needing **Tangkortet's own** key. Not yet requested.

Until then (and alongside it) the search box finds places from the app's own
list, `web/src/data/places.json`, built by `py -m pipeline.places`
(2026-11-20: 488 kB, **154 kB gzipped**, fetched lazily on the box's first
focus as a hashed build asset the service worker caches):

| Part | Source | Count | Licence |
|---|---|---|---|
| Towns, parts of towns, holiday-home areas | Danske Stednavne `sn:Bebyggelse` (types `by`, `bydel`, `sommerhusområde`), Klimadatastyrelsen | 10,528 | **CC BY 4.0** (Klimadatastyrelsen's terms for free data), credit "Indeholder data fra Klimadatastyrelsen" |
| Postal districts (number, name, extent) | DAGI `dagi10:Postnummerinddeling`, Klimadatastyrelsen | 1,089 | **CC BY 4.0**, as above |
| Named coastal bathing sites | MiljøGIS `vp4basis2026:vp4_ba_26_badevand` (the risk layer above), `coastalBathingWater` only; names tidied from capitals ("VEMMETOFTE STRAND" → "Vemmetofte Strand"), each given the postal district of the nearest town | 924 | **CC BY 4.0** (MST INSPIRE record) |

The towns and districts need a Datafordeler key to fetch, which Tangkortet
lacks, so they are taken from **Svampekortet's generated `places.json`**
(commit 624fb8b, built 2026-11-19 by its `web/scripts/gen-places.mjs` from the
two WFS services above): the file is public data under CC BY 4.0, and no key,
secret or code path of Svampekortet is used at runtime. `pipeline.places`
reads it with `--towns <path>`; without `--towns` it keeps the towns and
districts already in the output and only refreshes the bathing sites (no key
needed). Once Tangkortet has its own key, port the WFS fetch so the list is
rebuilt from source. Postal districts change a few times a year and Stednavne
has been frozen since 2025-09: rebuild at least yearly.

Adressevælgeren behaviour (no public docs; Svampekortet's probe, 2026-11-19):
results come sorted by postal number, not relevance; spelling is matched
phonetically; a postal number after the street narrows the search, a town
name does not. The app therefore ranks places itself and turns a town after
an address into its postal number (`web/src/placeindex.ts`).

## Licences

**This project's own material.** Code: PolyForm Strict 1.0.0 (`LICENSE`).
Texts and derived data (the published payload, the risk cells, the
traffic-light rules, the accumulation proposals, these docs): **CC BY-NC 4.0**.
Third-party data keeps its own licence and is not restricted further.

| Source | Used for | Licence / terms | In this repo |
|---|---|---|---|
| GBIF occurrence records (NHMD Phycology Herbarium, arter.dk, iNaturalist, observation.org, …) | finds per species | per dataset; in the committed dev payload: 7,700 records **CC BY 4.0**, 1,255 **CC BY-NC 4.0**, 100 **CC0** (2026-11-20). Each record's licence and dataset are kept in the published species files | dev sample `web/public/data/species/` |
| arter.dk (via GBIF) | Danish names, part of the finds | observation data CC BY 4.0, credit "Datagrundlag: Arter – Miljøstyrelsen, Statens Naturhistoriske Museum" | as above |
| Miljøstyrelsen, MiljøGIS water-plan layers (`vp4basis2026`, `vp3_2endelig2025`) | overflows, treatment plants, industry, aquaculture, harbours, dumping sites, bathing water, coastal-water status | INSPIRE records for klappladser and badevand: **CC BY 4.0** (geodata-info.dk); the other layers come from the same publisher, **confirm before launch** | derived risk cells for the dev area (`web/public/data/risk/`) |
| Danmarks Miljøportal (Natura 2000, fredninger) | live query at the pin | free use under <https://miljoeportal.dk/dataansvar/vilkaar-for-brug/>; **record the attribution line before launch** | nothing stored |
| MiljøGIS `vp3_2e2025_vandloeb_samlet` (named watercourses) + Miljøportalen `dai:bes_vandloeb` (protected watercourses) | live stream query at the pin (200 m, the expert's stream-mouth rule) | same publishers as above | nothing stored |
| DKJord via Vejdirektoratet's ArcGIS mirror | live V1/V2 query at the pin | terms not stated on the service; **ask before launch** | nothing stored |
| DMI metObs | live rain and wind | open data, credit "Data fra DMI" | nothing stored |
| Klimadatastyrelsen: Danske Stednavne and DAGI (via Svampekortet's generated list) | towns and postal districts in the place search | **CC BY 4.0**, credit "Indeholder data fra Klimadatastyrelsen"; **add the credit line to the About dialog** | `web/src/data/places.json` |
| iNaturalist photos (Research-Grade observations, picked via GBIF by `scripts/pull_species_images.py`) | species photos: list thumbnails, start-screen tiles, the species page and its viewer | **CC BY 4.0** or **CC0** only, per photo; each shown with photographer, licence and a link to the iNaturalist observation (CC BY attribution). Hotlinked from `inaturalist-open-data.s3.amazonaws.com`, not copied; the service worker keeps up to 120 seen photos for offline use. Marked "not reviewed" in the app until the expert has checked the identification | `data/images/<slug>.json` (links and credits only) |
| OpenStreetMap | basemap | ODbL, credit "© OpenStreetMap-bidragydere" | nothing stored |
| OpenStreetMap, Geofabrik's Denmark extract (`denmark-latest.osm.pbf`, refreshed weekly in the deploy) | "Kysten her": beaches (with `surface`), sand by the shore, salt marsh, tidal flats, harbours, marinas, piers, groynes, breakwaters, cliffs and the coastline, around the pin and on the map from zoom 13 (`pipeline/ingest/coast.py`) | **ODbL 1.0**, credit "© OpenStreetMap-bidragydere" (in the manifest attribution, so "Om Tangkortet" shows it). **Share-alike:** the coast cells are a *derivative database* of OSM and stay under the ODbL, unlike the project's own CC BY-NC data; anyone may reuse them under the ODbL, and a public derivative of them must be offered under the ODbL too. They are kept as separate files (a "collective database" with the rest of the payload), so the ODbL does not reach the other data. Mapping is volunteer work and uneven: shown as "OpenStreetMap – kan være ufuldstændigt" | dev sample `web/public/data/coast/` (Aarhus Bugt, Mols, Djursland and a piece of the Wadden Sea around Mandø) |
| Literature (Holdt et al. and others) | accumulation proposals; kainic acid in søl (Jørgensen & Olesen 2018, doi:10.1080/19393210.2018.1462258) | cited by DOI; only short facts and numbers are reproduced | `docs/literature-accumulation.md` |
| badevand.dk (DHI) | — | reCAPTCHA-protected, **not used**; the app only links to it | nothing stored |

### OpenStreetMap coast features (2026-11-20 extract)

| Feature | In the extract | Kept |
|---|---|---|
| `natural=beach` | 1,556 (ways, multipolygons, 10 nodes); 252 named; `surface` on about a third: sand 443, pebblestone 44, gravel 26, boulders 4, … | all |
| `natural=sand` | 4,073 | 590 within 500 m of the coastline (the rest are sand pits and inland dunes) |
| `wetland=saltmarsh` / `tidalflat` (with `natural=wetland`) | 572 / 99 | all |
| `landuse=harbour`, `industrial=port` (Aarhus's terminals), `harbour=yes` or `seamark:type=harbour`; `leisure=marina` | 114 objects; 554 | all (`leisure=marina` wins when both are set) |
| `man_made=pier` | 10,581 | 7,540 within 500 m of the coastline (the rest are mostly lake jetties). Bathing jetties are not tagged apart; a name with "badebro" (8) or `leisure=bathing_place` marks one |
| `man_made=groyne` / `breakwater` | 3,163 / 1,440 | 3,124 / 1,417 (same coast rule) |
| `natural=cliff` | 1,508 | 1,025 (same coast rule; inland ones are mostly gravel-pit edges) |
| `natural=coastline` | 2,236 ways | all (land on the left, so the app can tell land from water) |

`pipeline/ingest/coast.py` reads it with pyosmium's C++ tag filter and area
assembler: **about 25 s for the whole file** on a desktop (2026-11-20), then
simplifies with Douglas-Peucker (8 m for areas, coastline and cliffs; 3-4 m
for piers, groynes and breakwaters; a thin beach strip keeps its shape) and
splits into the risk cells' 0.2° grid with integer, delta-encoded
coordinates: **2.0 MB for all of Denmark in 235 cells** (largest 50 kB),
about 190 kB for the committed sample.

Raw source dumps are never committed: `build/` is git-ignored, and the repo
holds only the small dev sample and the derived risk cells.

## Findings worth remembering

- **Attached vs. drift** exists only in free text. The rules in
  `pipeline/attachment.py` (ADR-0003) give, for example, *Saccharina
  latissima* 1,019 attached / 20 drift / 261 unknown, and *Fucus vesiculosus*
  386 / 48 / 1,191. Recent shore records are mostly "unknown".
- **Depth** is on most herbarium/survey records. Median by species fits the
  expected zonation: *F. vesiculosus* 1 m, *F. serratus* 5 m, *Chondrus* 6 m,
  *Laminaria digitata* 9 m, *Saccharina* 10 m. A depth of 0 is ambiguous
  (shore, or not recorded), so it doesn't count as "attached".
- Miljøportalen's GeoServer is reachable from here (Svampekortet found only its
  Vue frontend in 2026-09; the WFS is at `arealeditering-dist-geo…/geoserver/ows`).
- The water-plan data is versioned per planning round (`vp3…`, `vp4basis2026`).
  Pin the round in config and let a contract check catch a new one.
