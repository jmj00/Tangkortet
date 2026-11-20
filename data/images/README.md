# Species photos

One `<slug>.json` per species: a short list of photos shown in the species list
and on the species page. `pipeline/publish.py` reads it into the species
document (`images`, `thumbnail`).

Seeded by `scripts/pull_species_images.py`, which picks **CC0 / CC BY 4.0**
photos from **iNaturalist Research-Grade** observations (via the GBIF
occurrence API). It looks in Denmark first, then in the neighbouring seas, then
further afield. Selection is deterministic, so re-runs are stable. Photos are
hotlinked from iNaturalist's open-data bucket, not copied.

Each entry:

```json
{
  "url": "https://inaturalist-open-data.s3.amazonaws.com/photos/<id>/large.jpg",
  "credit": "<photographer>",
  "license": "CC BY 4.0",
  "photo_url": "https://www.inaturalist.org/photos/<id>",
  "observation_url": "https://www.inaturalist.org/observations/<id>",
  "country": "DK",
  "source": "iNaturalist (Research Grade)",
  "reviewed": false
}
```

- `reviewed` stays `false` until the expert has confirmed the identification.
  Seaweeds (Ulva especially) are hard to tell apart from a photo, so the app
  says the photos are not yet reviewed.
- `"rejected": true` keeps a photo in the file but out of the app.
- Committed content: the build never regenerates it. Re-run the script only to
  seed a new species; existing files are kept unless `--force` is given.

Species without a usable CC photo (2026-11-20): Porphyra purpurea and
Ulva lacinulata (none on iNaturalist under CC0/CC BY), and Porphyra
umbilicalis and Ulva compressa have only a few, from outside Denmark.
