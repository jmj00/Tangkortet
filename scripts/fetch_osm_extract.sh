#!/usr/bin/env bash
# Download Geofabrik's OpenStreetMap extract for Denmark to $1, checked
# against Geofabrik's .md5. The file only appears at $1 once complete and
# verified, so a failed or partial download never replaces a good one (the
# deploy then falls back to last week's cached extract).
#
#   scripts/fetch_osm_extract.sh build/osm/denmark-latest.osm.pbf
set -euo pipefail
dest="$1"
url="${OSM_EXTRACT_URL:-https://download.geofabrik.de/europe/denmark-latest.osm.pbf}"
mkdir -p "$(dirname "$dest")"
part="$dest.part"
trap 'rm -f "$part" "$part.md5"' EXIT
curl -fsSL --retry 3 --retry-delay 10 -o "$part" "$url"
curl -fsSL --retry 3 -o "$part.md5" "$url.md5"
expected="$(cut -d' ' -f1 "$part.md5")"
actual="$(md5sum "$part" | cut -d' ' -f1)"
if [ "$expected" != "$actual" ]; then
  echo "md5 mismatch: expected $expected, got $actual" >&2
  exit 1
fi
mv "$part" "$dest"
echo "OpenStreetMap extract: $(du -h "$dest" | cut -f1), md5 $actual"
