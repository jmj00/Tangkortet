# Season: when to collect, and seasonal risks (first literature pass)

A short first pass (2026-11-20) to prepare questions for the expert. It is based
on abstracts and search summaries, not full papers, so check exact figures
before using them in the app. Danish studies come first; anything from outside
Denmark is marked **[not Danish]**. Nothing here is shown in the app until the
expert has answered (review page, "Sæson" section, keys `q3.saeson.*`).

The expert rated "species and season (accumulation of arsenic, cadmium,
iodine)" as **low** importance among the risk factors (review answer
`risiko.art_saeson.vigtighed`). The seasonal points below are therefore mostly
about quality, and about a few summer risks the brief does not cover.

## When seaweed is good to collect

| Species | What the literature says | Suggested window to ask about |
|---|---|---|
| Sugar kelp, oarweed (*Saccharina latissima*, *Laminaria digitata*) | Composition in Danish waters varies mainly with season; of the measured drivers only temperature correlated (Manns et al. 2017, three Danish sites over a year). Early June is the typical Danish harvest time for cultivated sugar kelp. From summer the bryozoan *Membranipora membranacea* fouls the fronds; onset is later further north and in brackish water **[mostly Norwegian/Nordic cultivation]**. | April to early June, before fouling |
| Dulse (*Palmaria palmata*) | Grows in winter and spring, little or no growth in summer and autumn. Winter–spring: more protein and ash; late summer–autumn: more sugar and dry matter **[not Danish: Norway, Arctic, Canada]**. | Winter to spring |
| Sea lettuce (*Ulva*) | Protein higher in winter, lower in summer when nitrogen runs short (Skive Fjord 2024, Roskilde Fjord). In summer the fronds get holes, foul and turn fertile, so quality falls from June **[not Danish: Swedish cultivation]**. Rotting drift mats give anoxic conditions **[not Danish]**. | Spring, not high summer; never rotting drift |
| Wracks (*Fucus*) | Followed monthly in Aarhus Bay (2025), but for natural compounds, not contaminants or eating quality. | None yet |

## Seasonal risks

- **Iodine.** Sources disagree:
  - In Danish cultivated sugar kelp, iodine reached up to 5 g/kg and varied with season more than with site (DTU).
  - A North Atlantic study found location mattered more than season **[not Danish]**.
  - In dulse, iodine was highest in spring and summer **[not Danish: Arctic]**.
- **Arsenic, cadmium, lead.** The evidence is mixed:
  - Seasonal variation was minimal in Norwegian kelp and dulse **[not Danish]**.
  - Arctic dulse had higher levels in winter and spring **[not Danish]**.
  - Most elements showed no significant seasonality in Greenland Fucus **[not Danish]**.
  - The Danish monitoring study (Sá Monteiro et al. 2019) does not report season in the summaries seen.
  - An EU proposal for maximum limits on lead, cadmium and inorganic arsenic in seaweed went to Danish consultation on 2026-09-15.
- **Rain and sewer overflows, all year.**
  - Heavy rain and overflows are the most common cause of poor bathing water in Denmark. Enterococci survive longer in seawater than E. coli.
  - Copenhagen also has red flags in winter, so the risk is not only a summer one.
  - The app's rain rule already applies all year.
  - Gap: official bathing-water samples are mostly taken in the summer season, so outside it the data is older.
- **Vibrio, warm summers.**
  - Danish infections follow sea temperature: they rise from June and peak in August, concentrated in brackish water (the straits, Øresund, the South Funen Archipelago) (Statens Serum Institut).
  - Infection comes through wounds and seawater contact. No source was found on getting Vibrio from eating seaweed.
  - Relevant advice: cover wounds, especially if older or immunocompromised.
- **Cyanobacteria (blågrønalger), high summer.**
  - Blooms occur in the Baltic, Øresund, Køge Bugt and around Bornholm. They now start almost three weeks earlier than 35 years ago, driven by warm water, sun and calm weather.
  - Some produce toxins that can cause rashes, nausea and vomiting.

## Possible use in the app (after the expert)

- Season months per species. The field exists (`season_months`), but no answers yet.
- Summer advice in "Før du går":
  - stay away from cyanobacteria blooms;
  - cover wounds in warm water;
  - never collect rotting drift.
- Show how old the bathing-water result is outside the bathing season.
- No harvest-month advice on iodine or metals until the expert has weighed the
  mixed evidence.

## Sources

Danish:
- Manns et al. 2017, J Appl Phycol 29:1493–1506, doi:10.1007/s10811-017-1204-5 (orbit.dtu.dk).
- DTU: evaluation of minerals and vitamins in Danish cultivated sugar kelp (orbit.dtu.dk).
- DTU: year-round biomass composition of Danish seaweed (orbit.dtu.dk).
- Fucus in Aarhus Bay, untargeted metabolomics over a year (PMC12654025).
- Sá Monteiro et al. 2019, contaminants in Danish edible seaweed (PMC7015483).
- Ulva from Skive Fjord, seasonal composition, J Appl Phycol 2024, doi:10.1007/s10811-024-03207-z.
- Rasmussen et al. 2014, drift algae and eelgrass in Danish waters (zenodo 30258).
- Statens Serum Institut: marine bacteria, annual summary 2020–2025.
- Emerging Infectious Diseases 29(3), Vibrio and Shewanella vs sea temperature in Denmark, doi:10.3201/eid2903.221568.
- Videnskab.dk and TV 2 Kosmopol on cyanobacteria blooms (2026).
- Ing.dk; Vand & Jord 2/2023 on overflows and bathing water; TV 2 Kosmopol on winter red flags.
- Lovguiden høringsportal 2026-09-15, EU limits for metals in seaweed.

Not Danish:
- Membranipora fouling across 58–69° N, J Appl Phycol, doi:10.1007/s10811-019-01827-4.
- Dulse composition: Botanica Marina doi:10.1515/BOT.2004.012 (Norway); UiT Munin 10037/37168 (Arctic); PMC10381615 (Canada).
- Roleda et al. 2018/2019, metals in NE Atlantic seaweeds (SINTEF).
- Ulva cultivation in Sweden (Chalmers); Hernández et al. 1997 (Spain).
