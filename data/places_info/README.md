# Place cards

`places_info.json` holds the place cards: a well-known Danish beach, harbour,
marina, headland, spit, cliff, bay, islet or peninsula with a photo and one or
two sentences. The app shows the nearest one in the Risiko tab when a pin lies
within 500 m of it (or inside its outline). Most places have no card, and that
is fine.

`pipeline/publish.py` (`publish_place_info`) turns it into the payload's
`place_info.json` on every build. The build never fetches anything for it, so
CI does not call Wikimedia.

Seeded by `scripts/pull_place_info.py`. The logic it uses (sentence trimming,
safety filter, licence allow-list, name matching) lives in
`pipeline/placeinfo.py` and is tested in `pipeline/tests/test_placeinfo.py`.

## Sources and licences

Open data only. No tourist sites, no Google, no VisitDenmark.

| What | Source | Licence |
|---|---|---|
| The places, their kind, coordinates, photo (P18) and article | Wikidata (SPARQL, `P31/P279*`, `P17 = Denmark`) | CC0 |
| The text | Lead of the Danish Wikipedia article, or the English one when there is no Danish article. Trimmed to one or two sentences at a sentence boundary | CC BY-SA 4.0. The card links the article |
| The text when there is no usable lead | Wikidata's Danish description ("Havn på Ærø.") | CC0 |
| The photo | Wikimedia Commons. Only CC0, public domain, CC BY and CC BY-SA, read from `extmetadata` (`LicenseShortName`, `Artist`, `LicenseUrl`) | The file's own licence. The card shows the author and links the licence |
| The match and the outline | OpenStreetMap via the Overpass API (features tagged `wikidata=`, named or unnamed beaches and harbours). The committed Danske Stednavne cells are used too | ODbL. Only the match and a simplified outline are kept |

Photos are hotlinked from `upload.wikimedia.org` at about 320 px and 800 px
wide, not copied.

## The safety filter

Tangkortet never says a spot is safe. `unsafe_reason()` drops any sentence that
says or suggests the water, beach or seaweed is clean, safe, healthy or good
for bathing. Examples: "Blå Flag", "badevandskvalitet", "rent vand", "sikker",
"børnevenlig", "populær badestrand", "livredder", "anbefales". The match is
deliberately broad: losing a harmless sentence costs little.

A card never skips over a dropped sentence. If the first sentence is dropped,
there is no Wikipedia text, and the card falls back to the Wikidata description
or is left out.

The dropped sentences are kept per record (`dropped_sentences`) for the review.

## Selection

A place gets a card only if it has all of these:

- a match to one of OpenStreetMap's coast features. This is the feature tagged
  with the item; otherwise one of the same name within 1 km (case, æ/ø/å,
  hyphens, spaces and generic words such as "Strand", "Havn" or "Marina" are
  normalised); otherwise, for a beach or harbour, the nearest one within
  250 m;
- the OpenStreetMap coastline within 1.5 km (6 km for a bay), so a lake's
  harbour or peninsula is left out;
- an allowed photo;
- a usable text: a Wikipedia lead, or a Wikidata description that says more
  than the kind.

Bathing-water monitoring points that Wikidata lists as beaches ("Tversted
Strand, 500m Øst For Nedkørsel") are skipped.

## Each record

```json
{
  "id": "Q23753270",
  "name": "Moesgård Strand",
  "kind": "beach",
  "kind_label": "Strand",
  "lon": 10.24877, "lat": 56.08803,
  "geom": {"type": "ring", "coords": [[10.2, 56.0], "..."]},
  "match": {"by": "osm_wikidata", "osm": "w123", "osm_name": "Moesgård Strand", "distance_m": 40},
  "description": "Moesgård Strand er en strand ved Moesgård syd for Aarhus.",
  "description_source": "wikipedia_da",
  "dropped_sentences": [],
  "wikidata": "https://www.wikidata.org/wiki/Q23753270",
  "article": {"title": "Moesgård Strand", "lang": "da", "url": "https://da.wikipedia.org/wiki/…", "license": "CC BY-SA 4.0"},
  "photo": {"file": "File:…", "page": "https://commons.wikimedia.org/wiki/File:…",
            "small": "https://upload.wikimedia.org/…/330px-….jpg", "large": "…/960px-….jpg",
            "width": 960, "height": 640, "author": "…", "license": "CC BY-SA 4.0",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0"},
  "fetched": "2026-11-21",
  "reviewed": false
}
```

- `match.by` is one of `osm_wikidata`, `osm_name`, `stednavne_name` or
  `osm_nearby`.
- `geom` is null when the feature is a point, or when it spans more than
  12 km (a big bay). The card then shows only near its point.
- `reviewed` stays `false` until the owner has looked at the card.
- `"rejected": true` keeps a record in the file but out of the app.
- Reviewed and rejected records are kept as they are when the script runs
  again.

## Running it

```sh
PYTHONPATH=. py -3.10 scripts/pull_place_info.py            # fetch (throttled, cached) and write
PYTHONPATH=. py -3.10 scripts/pull_place_info.py --offline  # rewrite from the cache only
```

Raw responses are cached under `build/placeinfo/cache/`, which is git-ignored.
`build/placeinfo/left_out.json` lists the places left out and why.
`build/placeinfo/dropped_sentences.json` lists what the safety filter dropped.
