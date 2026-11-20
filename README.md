# Tangkortet

A mobile-first map for foraging seaweed (tang) along Danish coasts: where a
species has been recorded, split into **attached** (on the seabed) and **drift**
(washed ashore) finds; how deep it grows and how to harvest it; and which
**contamination risk factors** lie near a chosen spot (wastewater outlets,
contaminated land, harbours, recent heavy rain, bathing-water warnings).

> **Not a safety certificate.** Maps and warnings identify potential risks. They
> are no guarantee that a spot or the seaweed collected there is free of
> contamination.

Status: **pre-launch**. The site is not indexed by search engines. Content
that depends on the seaweed expert is shown in the app as **"foreløbig"**
(provisional) or **"afventer ekspert"** until the expert has signed it off. That
includes the traffic-light rules (`web/src/verdict-rules.json`, marked
"udkast") and the iodine/arsenic/cadmium proposals
(`data/expert/accumulation_proposals.json`). See [`docs/plan.md`](docs/plan.md)
and the sources in [`docs/data-sources.md`](docs/data-sources.md). The expert's
own brief and answers are kept private.

```sh
py -m pipeline.build                 # GBIF + MiljøGIS -> build/publish (~30 s)
cd web && npm install && npm run dev # http://localhost:5174, see web/README.md
```

The app is built from the sister project Svampekortet (Danish mushroom foraging
map) and reuses its static precompute architecture: Python pipeline → static
JSON → a vanilla TypeScript + MapLibre PWA on Cloudflare Pages, plus a few live
browser queries to DMI and the authorities' map servers (ADR-0002).

Working rules for contributors (and Claude) are in [`CLAUDE.md`](CLAUDE.md).

## Licence

Code: [PolyForm Strict 1.0.0](https://polyformproject.org/licenses/strict/1.0.0)
(`LICENSE`). You may read the code and run it for noncommercial purposes; you
may not distribute it or make changes or new works based on it. This is not an
open-source licence. Tangkortet is a free, noncommercial hobby project and is
meant to stay one.

The project's own texts and derived data are licensed
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Third-party
data keeps its own licence: see
[`docs/data-sources.md`](docs/data-sources.md#licences).

**Exception: the coast cells** (`coast/*.json` in the published payload, and
the sample in `web/public/data/coast/`) are a derivative database of
OpenStreetMap and are licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/),
© OpenStreetMap-bidragydere, not CC BY-NC. They are kept as separate files so
the ODbL covers only them.
