"""Shared paths and constants for the pipeline."""

from __future__ import annotations

import pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD_DIR = REPO_ROOT / "build"
PUBLISH_DIR = BUILD_DIR / "publish"
CACHE_DIR = BUILD_DIR / "cache"
SAMPLE_DATA_DIR = REPO_ROOT / "web" / "public" / "data"

# Denmark incl. Bornholm, [min_lon, min_lat, max_lon, max_lat].
DK_BBOX = (7.8, 54.5, 15.3, 57.9)

# Risk layers are published in square lon/lat cells of this size, so the client
# only downloads the few cells around a pin (pipeline/publish.py).
RISK_CELL_DEG = 0.2

# Observations: coordinates are rounded to this many decimals (~10 m), and
# records with a stated uncertainty above the limit are dropped.
COORD_DECIMALS = 4
MAX_UNCERTAINTY_M = 5000
