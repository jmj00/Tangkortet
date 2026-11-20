# web

Mobile-first PWA: a MapLibre map of the Danish coast with three tabs.

- **Arter**: the species list (sorted by finds within 10 km once a pin is set)
  and a species sheet: finds on the map as attached (solid), drift (ring) or
  unknown (faint), observed depth, and the expert fields (harvest method,
  season, accumulation), which show "afventer ekspert" / "foreløbig" until the
  expert signs them off (`pipeline/species.py`).
- **Risiko**: for the pin, a draft traffic light (`src/verdict.ts`, rules in
  `src/verdict-rules.json`, ADR-0005) with the matching rules as reasons; then
  live DMI rain (24/48/72 h) and the last hard wind within 40 km (`src/wind.ts`,
  the expert's freshness check for drift tang); the coastal water body's status;
  mapped sources within 1/2/5 km from the precomputed grid cells
  (`src/risk.ts`); soil contamination V1/V2 within 1 km; Natura 2000 /
  fredninger.
- **Før du går**: the expert's checklist and advice, verbatim from the brief.

Shareable links: `#pin=<lat>,<lon>&tab=<arter|risiko|guide>&art=<slug>`.

Ported from Svampekortet (0024b43): `map.ts`, `addresses.ts`, `register-sw.ts`,
`sentry.ts`, `public/sw.js`, the reframing in `layers.ts`, and the build setup.

## Run

Node.js 22 LTS.

```sh
npm install
npm run dev            # http://localhost:5174
npm run lint && npm run format:check && npm run test && npm run build
```

`public/data/` is a committed dev payload: every species, plus risk cells
around Aarhus Bugt, Mols and Djursland only (`py -m pipeline.build --out
web/public/data --sample`). Try `#pin=56.15100,10.21900&tab=risiko`.

Without `VITE_DATAFORDELER_API_KEY` (see `.env.example`) the map uses
OpenStreetMap and the search box finds towns, postal districts and coastal
bathing sites only (`src/placesearch.ts`, list `src/data/places.json` from
`py -m pipeline.places`); with the key it finds addresses too. The same list
names the pin's place in the sheet header (`src/tapcard.ts`, nearest town or
bathing site): it is fetched on the first pin (or the first search, whichever
comes first), and coordinates show until it arrives or when it cannot be had.

## Live sources (called from the browser)

DMI metObs, MiljøGIS WFS, Miljøportalen WFS and Vejdirektoratet's ArcGIS server
all allow cross-origin requests (checked 2026-10-23). Each failure is shown as
"Kunne ikke hentes", never as "nothing found".
