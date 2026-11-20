import pytest

from pipeline.geo import cell_key, ring_area_centroid, simplify, utm32n_to_wgs84


def test_utm_matches_known_address():
    # Same fixture as Svampekortet's addresses.test.ts (Rold Skovvej 10, Horsens).
    lon, lat = utm32n_to_wgs84(556004.23, 6186277.17)
    assert lon == pytest.approx(9.8938, abs=1e-3)
    assert lat == pytest.approx(55.8188, abs=1e-3)


def test_ring_area_centroid_square():
    area, (cx, cy) = ring_area_centroid([(0, 0), (2, 0), (2, 2), (0, 2)])
    assert area == pytest.approx(4)
    assert (cx, cy) == pytest.approx((1, 1))


def test_ring_area_centroid_degenerate():
    area, c = ring_area_centroid([(1, 1), (1, 1), (1, 1)])
    assert area == 0
    assert c == (1, 1)


def test_simplify_drops_near_collinear_points():
    line = [(0, 0), (1, 0.001), (2, 0), (3, 5), (4, 0)]
    assert simplify(line, 0.01) == [(0, 0), (2, 0), (3, 5), (4, 0)]


def test_cell_key_floors_negative_and_positive():
    assert cell_key(10.41, 56.21, 0.2) == "52_281"
    assert cell_key(-0.1, 0.1, 0.2) == "-1_0"
