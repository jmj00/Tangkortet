# Place cards

`places_info.json` holds the place cards: a well-known Danish beach, harbour,
marina, headland, spit, cliff, bay, islet or peninsula with a photo and one or
two sentences. Most places have no card, and that is fine.

A card is background, never a recommendation or a quality stamp. In the Risiko
tab it comes last, after every risk card and just before "Tjek også selv",
under a small "Om stedet" heading. It shows when the pin lies within 500 m of
the place's point or outline (or inside the outline). For a peninsula or islet,
it shows only within 300 m of the place's shore: a pin inland on Løjt Land or
Thyholm gets no card.

`pipeline/publish.py` (`publish_place_info`) turns it into the payload's
`place_info.json` on every build. The build never fetches anything for it, so
CI does not call Wikimedia.

Seeded by `scripts/pull_place_info.py`. The logic it uses lives in
`pipeline/placeinfo.py`: sentence trimming, the safety filter, the licence
allow-list, the photo checks, the credit cleaning, the kinds, the name matching
and the shores. It is tested in `pipeline/tests/test_placeinfo.py` and
`test_placeinfo_review.py`.

## Sources and licences

Open data only. No tourist sites, no Google, no VisitDenmark.

| What | Source | Licence |
|---|---|---|
| The places, their kind, coordinates, photo (P18), Commons category (P373) and article | Wikidata (SPARQL, `P31/P279*`, `P17 = Denmark`) | CC0 |
| The text | Lead of the Danish Wikipedia article, or the English one when there is no Danish article. Trimmed to one or two sentences at a sentence boundary | CC BY-SA 4.0. Credited "Tekst: uddrag fra Wikipedia (forkortet), CC BY-SA 4.0", with the article and the licence linked |
| The text when there is no usable lead | Wikidata's Danish description ("Havn på Ærø.") | CC0, credited "Tekst: Wikidata (CC0)" |
| The photo | Wikimedia Commons. Only CC0, public domain, CC BY and CC BY-SA, read from `extmetadata` (`LicenseShortName`, `Artist`, `LicenseUrl`) | The file's own licence. The card shows the author and links the licence |
| The match, the outline and the shore | OpenStreetMap via the Overpass API (features tagged `wikidata=`, named or unnamed beaches and harbours, `natural=coastline`). The committed Danske Stednavne cells are used too | ODbL. Only the match, a simplified outline and a simplified shore are kept. Credited "Afgrænsning: © OpenStreetMap-bidragydere (ODbL)" on the card, in About and in the manifest |

Photos are hotlinked from `upload.wikimedia.org` as thumbnails 330 px and
960 px wide (Commons' standard steps; the app's `srcset` says `330w, 960w`),
not copied.

## The safety filter

Tangkortet never says a spot is safe, and a place card never praises a place.
`unsafe_reason()` drops any sentence that:

- says or suggests the water, beach or seaweed is clean, safe, healthy or good
  for bathing: "Blå Flag", "badevandskvalitet", "rent vand", "sikker",
  "børnevenlig", "livredder", "anbefales";
- calls the place a bathing place, an implicit bathing-quality claim: "er en
  badestrand", "havbadeanstalt";
- praises it, calls it popular or much visited: "attraktiv", "smuk",
  "smukkeste", "skøn", "skønhed", "idyllisk", "populær", "besøges",
  "fine skovbryn", "iøjefaldende";
- is marketing copy: "udviklingsorienteret og moderne".

The match is deliberately broad: losing a harmless sentence costs little.

- **After a dropped first sentence**, the next clean sentence is used if it
  stands alone (it does not open with "Den", "Det", "Her", "It" ...).
  Otherwise the card falls back to the Wikidata description, or is left out.
- **After a kept sentence**, a dropped one ends the text. The card never joins
  two sentences across a dropped one.
- **"Fredet"** is a fact worth keeping: a protected area may restrict
  collecting. A sentence that gives praise as the reason ("fredet i 1941 på
  grund af sin landskabelige skønhed") is trimmed to the fact ("fredet i
  1941."). The text is only trimmed, never reworded.
- **The text always ends on ".", "!" or "?"**. An extract cut off
  mid-sentence gives no text.
- **A sitelink that redirects** to another article (Frederikshavn Havn to
  Frederikshavn) gives no Wikipedia text.

Source typos are fixed only by trimming or dropping sentences, never by
editing the words. The dropped sentences are kept per record
(`dropped_sentences`) for the review.

## The photo

The first photo that passes every check is used, in this order: the
override's photo, P18, the article's free page image, and then a landscape
photo from the item's Commons category (`photo_from`). A photo is rejected
when:

- its licence is not on the allow-list;
- it is a map, an engraving, a painting, a drawing or a postcard. This is read
  from its Commons categories, its description and its file name;
- it was taken before 1950. This is read from `DateTimeOriginal`, from year
  categories ("1930s photographs") and from a painter's life years;
- people, cars or crowds are its subject. This is read from its categories
  ("People on beaches", "Automobiles");
- a card within 30 km already shows it (Odense Fjord and Tornø). The card
  whose own P18 it is keeps it.

A card whose photos were all rejected by these checks goes on as text only.
A card that never had a photo is left out.

The credit is cleaned by `clean_author()`. It removes "user:", "bruger:",
"( mail )", "Image:", "© … / Wikipedia", "No machine-readable author
provided … assumed", a possessive "'s", unbalanced parentheses and repeated
names. When the author is a web address, unknown or missing, the uploader is
credited instead.

## Selection

A place gets a card only if it has all of these:

- a match to one of OpenStreetMap's coast features, in this order:
  - the feature tagged with the item;
  - otherwise one of the same name and kind within 1 km. Case, æ/ø/å, hyphens
    and spaces are normalised. A generic word ("Strand", "Havn", "Marina") is
    left out only when both names have the same one: "Havn",
    "Lystbådehavn" and "Færgehavn" differ, and a harbour's name never matches
    the bare town name ("Nakskov");
  - otherwise, for a beach, harbour or marina, the nearest one of the same
    kind within 250 m.

  A harbour never matches a marina, and a marina never matches a harbour;
- the OpenStreetMap coastline within 1.5 km (6 km for a bay), so a lake's
  harbour or peninsula is left out;
- for a peninsula or islet (and a headland, spit or cliff over 1.5 km), a
  **shore**: the stretches of coastline that run along its outline (within
  80 m of its edge). The app shows the card only within 300 m of it;
- for a card with only a point (no outline), the point within 300 m of the
  coastline. A bay is exempt, because its point lies out in the water;
- a usable text: a Wikipedia lead, or a Wikidata description that says more
  than the kind;
- a photo (or, see above, a text-only card).

The kind comes from the item's own P31 first, then from its name's last word
("Odde" = spit, "Huk", "Pynt" or "Næs" = headland), and only then "beach",
which Wikidata gives to spits and headlands too (Blåvands Huk, Gedser Odde).
Classes it only inherits through P279* come last.

These places are left out:

- naval bases, museums, shipyards, power stations and nature reserves (by
  their P31 label);
- bathing-water monitoring points that Wikidata lists as beaches ("Tversted
  Strand, 500m Øst For Nedkørsel");
- places bigger than 25 km (Kattegat, Køge Bugt).

## Overrides (the manual review)

`overrides.json` is committed and applied on every run, so manual fixes
survive a re-run. Each entry is keyed by the Wikidata item and needs a short
`reason`. The script stops on an unknown key or kind, an entry without a
reason, a photo that fails the checks, or a text that is not from the lead.

| Key | Effect |
|---|---|
| `drop: true` | No card |
| `photo: "File:…"` | Use this Commons file. It still has to pass the licence and photo checks |
| `no_photo: true` | A text-only card |
| `kind: "headland"` | The place's kind (one of `KIND_LABEL`) |
| `text: "…"` | One or more whole sentences of the article's lead, in order, that pass the filter. Never invented text |
| `name: "…"` | The name shown (also a label for the reader of the file) |

## Each record

```json
{
  "id": "Q23753270",
  "name": "Moesgård Strand",
  "kind": "beach",
  "kind_label": "Strand",
  "lon": 10.24877, "lat": 56.08803,
  "geom": {"type": "ring", "coords": [[10.2, 56.0], "..."]},
  "match": {"by": "osm_wikidata", "osm": "w123", "osm_name": "Moesgård Strand", "osm_kind": "beach", "distance_m": 40},
  "description": "Moesgård Strand er en strand ved Moesgård syd for Aarhus.",
  "description_source": "wikipedia_da",
  "dropped_sentences": [],
  "wikidata": "https://www.wikidata.org/wiki/Q23753270",
  "article": {"title": "Moesgård Strand", "lang": "da", "url": "https://da.wikipedia.org/wiki/…", "license": "CC BY-SA 4.0"},
  "photo": {"file": "File:…", "page": "https://commons.wikimedia.org/wiki/File:…",
            "small": "https://upload.wikimedia.org/…/330px-….jpg", "large": "…/960px-….jpg",
            "width": 960, "height": 640, "author": "…", "license": "CC BY-SA 4.0",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0"},
  "photo_rejected": null,
  "fetched": "2026-11-21",
  "reviewed": false
}
```

- `match.by` is one of `osm_wikidata`, `osm_name`, `stednavne_name` or
  `osm_nearby`.
- `geom` is null when the feature is a point, when it spans more than 12 km
  (a big bay; the card then shows only near its point), or when the card has
  a `shore`.
- `shore` holds the polylines of a peninsula's or islet's coastline, for the
  app's 300 m test.
- `photo` is null for a text-only card; `photo_rejected` then says why.
  `photo_from` names the Commons category a replacement photo came from.
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
