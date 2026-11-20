# Tangkortet: build plan

Date: 2026-10-23. Status: proposed. The source brief is in
the expert's brief (kept private, not in this repo).

Tangkortet is a mobile-first map for foraging seaweed along Danish coasts.
Svampekortet shows *where a species has been found* and *how good conditions are
now*. Tangkortet answers three different questions:

1. **Where does this species grow?** Observations split into *attached* (growing
   on the seabed) and *drift* (washed ashore).
2. **How do I harvest it?** Expected depth, harvest method and season for each
   species.
3. **What contamination risk is near this spot right now?** Risk factors around a
   pin, shown alongside the expert's checklist. Nothing is ever certified as
   "safe".

The third question matters most to the expert: contamination risk is the key
concern in seaweed foraging. It is also where Tangkortet differs most from
Svampekortet.

## Repo strategy: a new repo seeded from Svampekortet

GitHub can't fork a repo into the account that owns it, and most of
Svampekortet's 224 commits concern the mushroom model. So Tangkortet is a new
private repo (`jmj00/Tangkortet`). Reusable parts are **copied** in during phase 1,
and the commit message records the Svampekortet commit they came from (`0024b43`
at the time of writing). Nothing is ever written to the Svampekortet repo, its
GitHub project, its Cloudflare Pages project or its secrets. See the guardrails
in [`../CLAUDE.md`](../CLAUDE.md).

If a fix to shared code (DMI client, address search) is later needed in both
apps, it is made in each repo separately. A shared package is not worth the
coupling at this size.

## What carries over from Svampekortet

### Reuse almost as-is

| Svampekortet piece | Use in Tangkortet |
|---|---|
| Static precompute architecture (ADR-0002): Python pipeline → DuckDB → static JSON → Cloudflare Pages | Same. No backend until user submissions arrive. |
| `web/`: Vite + vanilla TS + MapLibre shell, `map.ts` (Skærmkort WMS, OSM fallback), `addresses.ts` (Adressevælgeren), `register-sw.ts` + `sw.js` offline, `sentry.ts`, `palette.ts`, panel/sheet layout, `style.css` | The app shell, with the theme changed from forest to coast. |
| `pipeline/http.py`, `duckload.py`, `datafordeler.py` (OAuth), `contracts.py` pattern, `build.py` orchestration, `publish/site.py` pattern | Same infrastructure with different ingest modules. |
| `pipeline/dmi.py` + `ingest/dmi.py` (daily precipitation, 10 km grid) | Directly reused for **rain in the last 24/48/72 h** (risk factor). Needs hourly or daily resolution near the coast. |
| `.github/workflows/` `ci`, `contracts`, `deploy` (with the Cloudflare retry), `deploy-weather-daily` | Same jobs, a **new** Cloudflare Pages project and new secrets. |
| `.pre-commit-config.yaml`, ruff/pytest/vitest/prettier/eslint setup | Same. Also carry over the lesson that CI runs Prettier but pre-commit doesn't. |
| ADR practice, `docs/data-sources.md` "nothing is built on a source until its row is complete" | Same. |
| `scripts/pull_species_images.py` (iNaturalist CC0/CC BY) + `data/images/*.json` | Same approach for seaweed photos. |
| `data/descriptions/*.md` species texts | Same format with new sections (depth, harvest, accumulation). |
| `scripts/verify_danish_names.py` pattern | Re-pointed at the arter.dk archive's `vernacularName` for algae. |
| Stednavne WFS ingest (`ingest/stednavne.py`) | Adapted from named forests to named **beaches / coastal places** for "kyster nær mig". |

### Drop (mushroom-specific)

The conditions model (`model/habitat`, `seasonality`, `weather`, `fit`,
`backtest`, `golden`, `calibration`, `current`), host trees, biotope/soil
(CORINE/GEUS), recording-effort debiasing, the red-list hide-set and the
core/extra tiers that rest on the backtest gate. Most seaweeds are perennial and
the observation data is far too thin (see below) for a fitted model. The KDE in
`habitat.py` can come back later if a "where it grows" surface turns out to be
useful.

## What has to be built new

### 1. Species registry with harvest data

`pipeline/species.py` is rebuilt with seaweed fields:

```python
class Species(TypedDict):
    danish_name: str
    danish_name_verified: bool  # against arter.dk vernacularName
    scientific_name: str
    synonyms: list[str]
    group: str  # brunalge / rødalge / grønalge
    depth_m: tuple[float, float]  # expected depth range (expert)
    depth_observed_m: tuple[float, float] | None  # p10–p90 from survey records
    zone: str  # "tidevand" | "lavvande" | "sublitoral"
    harvest_method: str  # "klip_skudspids" | "hel_plade" | "ved_stipes"
    harvest_notes: str  # leave the holdfast, cut height, etc.
    season: list[int]  # best harvest months
    accumulation: list[str]  # "jod" | "arsen" | "cadmium", species-specific warnings
    lookalike_risk: str
    expert_verified: bool  # depth/method/season signed off by the expert
    gbif_usage_key: int
    notes: str
```

**Depth** comes from two sources that are shown side by side: the expert's
expected range, and an empirical range from records that carry a depth. A GBIF
probe on 2026-10-23 found depth on most NHMD herbarium and reef-survey records
(e.g. *Saccharina latissima*: about 450 of 600 sampled records, typically 7–14 m,
from diving surveys at Vejrø, Schultzs Grund and Store Middelgrund). The national
macroalgae reef monitoring (ODA / DCE) is a candidate source for much richer
depth data, still to be verified.

**Harvest method** comes from the expert and appears as a clear card in the
species sheet: "Klip skudspidsen med saks" or "Høst hele bladet / tæt ved
stipes", with a short why (growth from tips vs. from the blade).

### 2. Attached vs. drift observations

Each observation gets `attachment: "attached" | "drift" | "unknown"`. The source
data has no structured field for this. The 2026-10-23 probe found it only in free
text, so it is **inferred** with rules that are kept and tested:

- `attached`: a depth > 0 m, or field notes mentioning scuba/diving/stone reef,
  or `habitat` = sublittoral.
- `drift`: remarks or habitat containing "opskyl", "drift", "beach", "strand"
  (when not combined with a depth), "tørret".
- otherwise `unknown`. This will be most iNaturalist/arter.dk shore records.

On the map, attached finds are solid markers and drift finds are hollow ones, with
a legend explaining that drift tang may come from far away. The UI never hides
`unknown` records, but it labels them as unknown. Later, user submissions
(phase 5) ask the question explicitly, which is the only way to get good data
going forward.

### 3. Contamination risk around a pin

This replaces Svampekortet's 0–100 conditions score. It is shown as **a list of
risk factors found near the pin, each with distance, source and a link**, plus
the expert's checklist with the factors the app could check pre-ticked. There is
no combined "safe/unsafe" score at first. The brief itself warns that distance
alone doesn't decide risk (currents, water exchange) and that clean bathing water
doesn't mean clean tang. A combined score is a later decision and needs its own
ADR.

| Risk factor (brief §1) | Source (verified 2026-10-23, see `data-sources.md`) |
|---|---|
| Kraftig nedbør 24/48/72 h | DMI `metObs` hourly station precipitation, fetched live by the browser (ADR-0002) |
| Forurenede grunde V1/V2 | DKJord via Arealdata download (authoritative) / Vejdirektoratet ArcGIS mirror (29,808 V1, 34,808 V2) |
| Spildevand: renseanlæg, overløb, regnvandsudløb | MiljøGIS `vp4basis2026`: 633 treatment plants, 20,640 rain-driven outlets with yearly volumes |
| Industri (current) and akvakultur | MiljøGIS `vp4basis2026`: 76 + 27 discharge points |
| Havne og sejlads | MiljøGIS `vp4basis2026`: 458 harbours (commercial / marina) |
| Klappladser / sediment | MiljøGIS `vp4basis2026`: 81 active + 44 closed dumping sites (CC BY 4.0) |
| Badevandskvalitet | MiljøGIS `vp4basis2026`: 1,049 sites with EU class (CC BY 4.0). Live warnings: link to badevand.dk (its API is reCAPTCHA-protected) |
| Kystvandes kemiske tilstand | MiljøGIS `vp3_2endelig2025`: 89 coastal water bodies |
| Natura 2000, fredninger | Miljøportalen WFS: 269 habitat + 125 bird areas, 4,176 fredninger (shown as *rules*) |
| Algeopblomstring | no source found; link out |
| Strøm/vind/vandudskiftning | not modelled; checklist text |

The app copy follows the brief's closing line on every risk view: *maps and
warnings identify potential risks; they are no guarantee*.

### 4. "Before you go" and "while foraging" screens

The checklist from §4 and the advice from §5 become a short in-app guide. The
§5 advice covers preferring fresh, attached tang, avoiding outlets, harbours,
oil films and odd smells, and noting date, place, species and weather. In
phase 5 this can turn into a personal trip log.

### 5. Coast-first map

Svampekortet ranks species by conditions at a pin. Tangkortet's main flow is
"pick a stretch of coast → see the species recorded there (attached/drift) +
the risk list". The map can grey out inland areas, and "kyster nær mig" uses
named coastal places instead of forests.

## Data reality check (GBIF, 2026-10-23)

Danish records per species are in the hundreds to low thousands, mostly
1990s–2000s **herbarium specimens** (NHMD Phycology Herbarium). There are a few
hundred recent iNaturalist / arter.dk records for common species:

| Species | DK records | Mostly from |
|---|---|---|
| *Fucus vesiculosus* | 1,625 | herbarium 728, iNaturalist 504, arter.dk 192 |
| *Saccharina latissima* | 1,300 | herbarium 1,096, iNaturalist 84 |
| *Chondrus crispus* | 1,171 | herbarium 1,040 |
| *Laminaria digitata* | 1,061 | herbarium 1,001 |
| *Ulva lactuca* | 562 | herbarium 481 |
| *Palmaria palmata* | 419 | herbarium 373 |

Consequences: a fitted "where it grows" model is not realistic now. Observation
maps should show old records (with year) rather than filter them out, and the
species list should start small. Licences per dataset need checking: herbarium
records via GBIF, arter.dk CC BY, iNaturalist per-record CC.

## Content and safety

- The PDF was produced with ChatGPT. Each claim the app shows (especially the
  accumulation warnings for iodine, arsenic and cadmium) is checked against a
  primary source (Fødevarestyrelsen, DTU Fødevareinstituttet, EFSA) and credited.
- Depth, harvest method and season are **marked `expert_verified`** only after
  the expert has signed them off. Until then the UI shows them as "foreløbig".
- Danish species names come from the arter.dk archive, never guessed (a lesson
  learned from Svampekortet).
- Collecting rules (fiskeri-/naturbeskyttelseslov, private beaches, Natura 2000)
  must be researched before launch and stated with a source.
- Like Svampekortet: anonymous, read-only, Danish UI, no claims that anything is
  safe to eat.

## Candidate species (first cut, to agree with the expert)

Scientific names only until the Danish names are verified against arter.dk:
*Saccharina latissima*, *Laminaria digitata*, *Fucus vesiculosus*, *Fucus
serratus*, *Ascophyllum nodosum*, *Palmaria palmata*, *Chondrus crispus*,
*Ulva lactuca*, *Ulva intestinalis*, *Chorda filum*, *Porphyra / Pyropia* spp.,
*Alaria esculenta* (rare in DK; maybe excluded).

## Phases

Each phase is a few PRs; nothing ships publicly until phase 4.

0. **Spikes** (done 2026-10-23): every risk source verified, see
   `docs/data-sources.md`; ADR-0002…0004; expert review page (`review/`).
1. **Port the shell**: copy the web shell, the pipeline infrastructure, CI and
   pre-commit from Svampekortet; strip the mushroom code; get CI green on an
   empty app. Browser test needed (MapLibre).
2. **Species + observations**: registry, GBIF/arter.dk ingest with
   attached/drift inference, species sheet with depth/harvest cards, photos.
3. **Risk layer**: the ingests from phase 0, the pin risk list, rain
   24/48/72 h, checklist and guide screens.
4. **Launch prep**: expert review of all content, new Cloudflare Pages project,
   deploy workflow, "Om Tangkortet" with sources and disclaimers. The user
   decides when the app goes public.
5. **Later**: user submissions (attached/drift asked explicitly, trip log) →
   needs a backend (ADR-0002 deferral applies). A possible combined risk score.

## Questions for the expert

1. Which species should be in the first version, and are any off-limits
   (protected, easily confused, too high in iodine)?
2. Depth range, harvest method and best season for each of them.
3. Should drift tang be shown at all as a place to *collect*, or only as a sign
   that the species grows nearby? (The brief §5 prefers fresh, attached tang.)
4. Is a list of risk factors enough, or do foragers expect a traffic-light
   verdict?
5. Any known good sources for the accumulation data (iodine/arsenic/cadmium) per
   species?

## Expert round 1 (2026-10-23)

Answers are kept private (not in this repo). They decided: drift shown as
a sign of the species nearby (plus freshness advice, with a wind check), and a
traffic light alongside the list ([ADR-0005](adr/0005-traffic-light-as-draft-rules-plus-list.md),
draft rules out for review). Still open: species cards (depth, harvest, season,
accumulation), risk-factor weights, collecting rules.

