"""Geometry helpers: UTM32N -> WGS84, ring centroid/area, line simplification.

Everything here is plain Python so the pipeline stays dependency-free. Coordinates
are ``(x, y)`` tuples: metres in EPSG:25832, or ``(lon, lat)`` in WGS84.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

Point = tuple[float, float]

_A = 6378137.0
_F = 1 / 298.257223563
_K0 = 0.9996
_E0 = 500000.0
_LON0 = math.radians(9.0)


def utm32n_to_wgs84(x: float, y: float) -> Point:
    """EPSG:25832 metres -> (lon, lat) degrees. Snyder's inverse series; same
    formula as Svampekortet's web/src/addresses.ts, sub-metre over Denmark."""
    e2 = _F * (2 - _F)
    ep2 = e2 / (1 - e2)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    mu = (y / _K0) / (_A * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    phi1 = (
        mu
        + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu)
        + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
        + (151 * e1**3 / 96) * math.sin(6 * mu)
        + (1097 * e1**4 / 512) * math.sin(8 * mu)
    )
    n1 = _A / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    t1 = math.tan(phi1) ** 2
    c1 = ep2 * math.cos(phi1) ** 2
    r1 = _A * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    d = (x - _E0) / (n1 * _K0)
    lat = phi1 - (n1 * math.tan(phi1) / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * ep2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * ep2 - 3 * c1**2) * d**6 / 720
    )
    lon = _LON0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * ep2 + 24 * t1**2) * d**5 / 120
    ) / math.cos(phi1)
    return math.degrees(lon), math.degrees(lat)


def ring_area_centroid(ring: Sequence[Point]) -> tuple[float, Point]:
    """Unsigned area and centroid of a closed or open ring (planar shoelace).
    Falls back to the vertex mean for a degenerate ring."""
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:
        return 0.0, (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)
    return abs(a) / 2, (cx / (3 * a), cy / (3 * a))


def simplify(points: Sequence[Point], tolerance: float) -> list[Point]:
    """Douglas-Peucker. Keeps both endpoints; iterative, so long rings are fine."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x0, y0), (x1, y1) = points[start], points[end]
        dx, dy = x1 - x0, y1 - y0
        norm = math.hypot(dx, dy)
        worst, worst_i = 0.0, -1
        for i in range(start + 1, end):
            px, py = points[i]
            if norm == 0:
                dist = math.hypot(px - x0, py - y0)
            else:
                dist = abs(dy * px - dx * py + x1 * y0 - y1 * x0) / norm
            if dist > worst:
                worst, worst_i = dist, i
        if worst > tolerance:
            keep[worst_i] = True
            stack += [(start, worst_i), (worst_i, end)]
    return [p for p, k in zip(points, keep, strict=True) if k]


def cell_key(lon: float, lat: float, size: float) -> str:
    """Grid cell id, e.g. ``"52_281"`` for size 0.2 at (10.4, 56.2). Must match
    web/src/risk.ts."""
    return f"{math.floor(lon / size)}_{math.floor(lat / size)}"
