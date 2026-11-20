# Iodine, arsenic and cadmium per species: literature pass

Date: 2026-11-01. Status: **proposals for the expert to confirm**. Requested
after the expert named Susan Løvstad Holdt (DTU) as the source to use
(review page, round 1). The proposals live in
[`../data/expert/accumulation_proposals.json`](../data/expert/accumulation_proposals.json)
and are shown on each species card of the review page. **The app does not use
them** until the expert has agreed or corrected them, at which point they move
into `pipeline/species.py` (`accumulation`).

## Sources

Holdt is an author of [1] and [2]. Her publication list on DTU Orbit blocks
automated access, so her work was found through PubMed and Crossref. All
citations below were verified against Crossref/PubMed.

1. Sá Monteiro M, Sloth J, **Holdt S**, Hansen M (2019). *Analysis and Risk
   Assessment of Seaweed.* EFSA Journal 17(S2): e170915.
   doi:[10.2903/j.efsa.2019.e170915](https://doi.org/10.2903/j.efsa.2019.e170915).
   **Danish samples** (62, cultivated and harvested in Denmark). The backbone of
   this pass.
2. Nielsen CW, **Holdt SL**, Sloth JJ, Marinho GS, Sæther M, Funderud J, Rustad T
   (2020). *Reducing the High Iodine Content of Saccharina latissima and Improving
   the Profile of Other Valuable Compounds by Water Blanching.* Foods 9(5): 569.
   doi:[10.3390/foods9050569](https://doi.org/10.3390/foods9050569).
3. Cherry P, O'Hara C, Magee PJ, McSorley EM, Allsopp PJ (2019). *Risks and
   benefits of consuming edible seaweeds.* Nutrition Reviews 77(5): 307–329.
   doi:[10.1093/nutrit/nuy066](https://doi.org/10.1093/nutrit/nuy066). Review, not
   Danish samples; units are sometimes stated without a dry/wet basis.
4. Ronan JM, Stengel DB, Raab A, Feldmann J, O'Hea L, Bralatei E, McGovern E
   (2017). *High proportions of inorganic arsenic in Laminaria digitata but not in
   Ascophyllum nodosum samples from Ireland.* Chemosphere 186: 17–23.
   doi:[10.1016/j.chemosphere.2017.07.076](https://doi.org/10.1016/j.chemosphere.2017.07.076).
   Irish samples, arsenic speciation.

Not read (worth adding if the expert wants more): Holdt & Kraan (2011),
*Bioactive compounds in seaweed: functional food applications and legislation*,
J Appl Phycol 23: 543–597, doi:10.1007/s10811-010-9632-5 (paywalled). Also the
Nordic Council report *Seaweeds for food: from production to consumer*
(TemaNord 2026:510, CC BY 4.0), whose site blocks automated access.

## Findings from the Danish data [1]

Mean (range), mg/kg freeze-dried weight:

| Species | n | Iodine | Total As | Cd | Pb | Hg |
|---|---|---|---|---|---|---|
| *Saccharina latissima* | 16 | 2,302 (333–4,782) | 38.3 | 0.68 | 0.26 | 0.016 |
| *Fucus serratus* | 14 | 366 (105–961) | 30.3 | 1.04 | 0.47 | 0.009 |
| *Fucus vesiculosus* | 27 | 275 (138–451) | 28.4 | 0.78 | 0.90 (0.19–9.6) | 0.012 |
| *Ulva lactuca* | 2 | 19 (17–21) | 3.4 | 0.04 | 0.08 | 0.007 |

Inorganic arsenic was not reported ("in preparation"). Risk scenario: one
5 g dried serving a week, adult of 60 kg, iodine upper intake level (UL) 600 µg/day.

- **Iodine is the main concern**, "particularly for *Saccharina latissima*": one
  serving gives on average ≈ 11,500 µg, about **19× the UL**. *F. serratus* ≈ 3×
  and *F. vesiculosus* ≈ 2× the UL; *U. lactuca* is well below. The authors
  recommend that "iodine-rich species should be avoided" by pregnant women,
  children and people with thyroid disorders.
- **Cadmium:** 1.2–3.5 % of the tolerable weekly intake per serving,
  "insignificant compared to other sources". **Mercury:** negligible.
- **Lead:** "cannot be excluded" as a concern for children and pregnant women.
  The highest values were in *F. vesiculosus* (one sample 9.6 mg/kg).
- Overall: "low health risk for mercury, cadmium, and lead" for the general
  population.

## Other species [3, 4]

- *Laminaria digitata*: iodine up to ≈ 6,245 mg/kg dw, the highest in [3].
  **Inorganic arsenic 2.2–87 mg/kg dw** in Irish samples [4], rising from the
  stipe to the decaying distal blades, where it is > 50 % of total arsenic.
  This bears on how and which part to harvest.
- *Ascophyllum nodosum*: inorganic arsenic < 1 % of total arsenic [4]. No
  reliable iodine figure per kg found.
- *Alaria esculenta*: iodine ≈ 670 µg/g, ≈ 165 after boiling [3].
- *Palmaria palmata*: iodine ≈ 97 µg/g, ≈ 66 after boiling; inorganic arsenic
  negligible [3].
- *Ulva intestinalis*: iodine ≈ 92 µg/g, ≈ 79 after boiling [3].
- *Porphyra* (nori, related species): iodine ≈ 80 µg per 5 g; inorganic
  arsenic ≈ 0.03 µg/g [3].
- *Chondrus crispus*, *Chorda filum*: no species-specific figures found.

## Preparation

Blanching *S. latissima* in water (≥ 45 °C for ≥ 30 s) cut iodine from ≈ 4,600
to as low as 293 mg/kg dw [2]. Boiling lowered iodine in *Alaria* by about
75 % [3]. The app could offer this as preparation advice, once the expert agrees.

## Proposals (summary)

| Species | Proposed flags | Evidence |
|---|---|---|
| Sukkertang | jod | Danish [1, 2] |
| Fingertang | jod, arsen | foreign [3, 4] |
| Vingetang | jod | foreign [3] |
| Savtang | jod | Danish [1] |
| Blæretang | jod | Danish [1] |
| Buletang | jod (uncertain) | sparse [3, 4] |
| Strengetang | — (no data) | none |
| Søl | none | foreign [3] |
| Carrageentang | — (no data) | none |
| Navle-purpurhinde | none | related species [3] |
| Søsalat | none | Danish [1] |
| Tarm-rørhinde | none | foreign [3] |

No species is proposed for a cadmium flag: Holdt et al. found cadmium
insignificant.
