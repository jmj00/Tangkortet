"""Danske Stednavne ingest (pipeline/ingest/stednavne.py): small GML samples,
no network and no credentials."""

import json
import pathlib
import re
import urllib.parse
from collections import Counter

import pytest

from pipeline import places
from pipeline.ingest import stednavne as sn

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "stednavne"
QUERY = {q.typename: q for q in sn.QUERIES}


def gml(name: str) -> str:
    return (FIXTURES / f"{name}.xml").read_text(encoding="utf-8")


def test_parse_swaps_lat_lon_and_keeps_the_primary_name():
    count, rows = sn.parse_page(gml("Farvand"), QUERY["Farvand"])
    assert count == 1
    (bay,) = rows
    assert bay.name == "Prøve Bugt"  # navn_1, not navn_2
    assert bay.kind == "bugt"
    outer, hole = bay.polygons[0]
    assert outer[1] == (10.2, 56.0)  # (lon, lat)
    assert hole[0] == (10.09, 56.04)


def test_parse_skips_other_types_and_members_without_geometry():
    count, rows = sn.parse_page(gml("Landskabsform"), QUERY["Landskabsform"])
    assert count == 3  # paging counts every member
    assert [r.name for r in rows] == ["Prøve Pynt", "Indlandsnæs"]  # "bakke" is not asked for
    count, rows = sn.parse_page(gml("Friluftsbad"), QUERY["Friluftsbad"])
    assert count == 2
    (bath,) = rows
    assert bath.kind == "havbad"  # not the water "hav"
    assert bath.name == "Havbadet & Broen"  # entities decoded
    assert bath.points == [(10.22, 56.15)]


def test_query_asks_for_the_types_and_no_sort():
    params = sn.page_params(QUERY["Havnebassin"], 500)
    assert params["cql_filter"] == "havnebassintype IN ('lystbådehavn','fiskerihavn','trafikhavn')"
    assert params["srsname"] == "urn:ogc:def:crs:EPSG::4326"
    assert params["startindex"] == "500"
    assert "sortBy" not in params  # the service drops the filter with it


def page_of(n: int, matched: int, start: int) -> str:
    members = "".join(
        f"<wfs:member><sn:Friluftsbad><sn:id.lokalId>b{start + i}</sn:id.lokalId>"
        f"<sn:navn_1.skrivemaade>Bad {start + i}</sn:navn_1.skrivemaade>"
        "<sn:friluftsbadtype>hav</sn:friluftsbadtype>"
        '<sn:geometri><gml:Point srsDimension="2"><gml:pos>56.1 10.1</gml:pos></gml:Point>'
        "</sn:geometri></sn:Friluftsbad></wfs:member>"
        for i in range(n)
    )
    return f'<wfs:FeatureCollection numberMatched="{matched}" numberReturned="{n}">{members}'


def test_fetcher_pages_until_the_match_count_and_caches(tmp_path):
    query = sn.Query("Friluftsbad", "friluftsbadtype", ("hav",), page_size=2)
    calls = []

    def get(url: str, token: str) -> str:
        start = int(urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["startindex"][0])
        calls.append(start)
        return page_of(min(2, 4 - start), 4, start)

    fetcher = sn.Fetcher(("id", "secret"), tmp_path, get)
    fetcher.token = lambda fresh=False: "token"  # type: ignore[method-assign]
    rows = fetcher.features(query)
    assert calls == [0, 2]  # the second page was full, but the count says that's all
    assert [r.name for r in rows] == ["Bad 0", "Bad 1", "Bad 2", "Bad 3"]
    # again from the raw pages, without credentials or network
    again = sn.Fetcher(None, tmp_path, lambda *_: pytest.fail("no network"))
    assert len(again.features(query)) == 4


def test_fetcher_without_credentials_says_so():
    fetcher = sn.Fetcher(None, None)
    with pytest.raises(RuntimeError, match="credentials"):
        fetcher.page(QUERY["Friluftsbad"], 0)


def raw_features() -> list[sn.RawFeature]:
    out = []
    for name in ("Farvand", "Landskabsform", "Friluftsbad"):
        out += sn.parse_page(gml(name), QUERY[name])[1]
    return out


def test_prepare_keeps_landforms_by_the_water_only():
    extract = sn.prepare(raw_features())
    kept = {f.name: f for f in extract.features}
    # the point is 110 m north of the bay; the other næs is 25 km inland
    assert set(kept) == {"Prøve Bugt", "Prøve Pynt", "Havbadet & Broen"}
    assert extract.dropped_inland == {"næs": 1}
    bay = kept["Prøve Bugt"]
    assert len(bay.rings) == 2  # the island stays a hole
    assert 1.3e8 < bay.area_m2 < 1.4e8  # 12.4 x 11.1 km less the island
    assert not sn.point_in_rings((10.1, 56.05), bay.rings)  # on the island
    assert sn.point_in_rings(bay.point, bay.rings)


def test_prepare_counts_a_coastline_as_the_sea():
    raw = [r for r in raw_features() if r.kind != "bugt"]
    assert "Indlandsnæs" not in {f.name for f in sn.prepare(raw).features}
    coastline = [[(10.49, 56.31), (10.51, 56.31)]]  # 900 m north of it
    assert "Indlandsnæs" in {f.name for f in sn.prepare(raw, coastline).features}


def test_point_on_surface_of_a_crescent_is_inside():
    # a U: the centroid falls in the gap
    ring = [(0, 0), (3, 0), (3, 3), (2, 3), (2, 1), (1, 1), (1, 3), (0, 3), (0, 0)]
    p = sn.point_on_surface([ring])
    assert sn.point_in_rings(p, [ring])


def test_clip_ring_to_a_box():
    square = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (0.0, 0.0)]
    clipped = sn.clip_ring(square, (1.0, 1.0, 3.0, 3.0))
    assert sorted(clipped) == [(1.0, 1.0), (1.0, 2.0), (2.0, 1.0), (2.0, 2.0)]
    assert sn.clip_ring(square, (5.0, 5.0, 6.0, 6.0)) == []


def test_cell_files_clip_waters_and_keep_the_rest_whole():
    extract = sn.prepare(raw_features())
    cells = sn.cell_files(extract.features, 0.2)
    # the bay spans 10.0-10.2 E, 56.0-56.1 N: cell 50_280 (and touches 51_280)
    rows = {r[4]: r for r in cells["50_280"]["features"]}
    bay = rows["Prøve Bugt"]
    assert bay[1:3] == ["bugt", "a"]
    assert len(bay[3]) == 2  # outer ring and the island
    assert bay[5] > 13000  # ha
    assert cells["51_280"]["features"][-1][1:3] == ["havbad", "p"]  # at 10.22 E
    pynt = rows["Prøve Pynt"]
    assert pynt[2] == "a"
    # a feature has one id in every cell
    ids = {r[4]: r[0] for c in cells.values() for r in c["features"]}
    assert len(set(ids.values())) == len(ids)


def test_publish_names_writes_cells_and_an_index(tmp_path):
    extract = sn.prepare(raw_features())
    path = tmp_path / "stednavne.json"
    path.write_text(json.dumps(sn.to_json(extract, 1.0), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "publish"
    index = sn.publish_names(out, path, 0.2, [(10.0, 56.0, 10.19, 56.19)])
    assert index["license"] == "CC BY 4.0"
    assert index["coverage"] == ["50_280"]
    assert index["cells"] == ["50_280"]
    assert index["counts_denmark"] == {"bugt": 1, "havbad": 1, "pynt": 1}
    assert [p.name for p in (out / "names").iterdir()] == ["50_280.json"]


def test_named_places_for_the_search():
    extract = sn.prepare(raw_features())
    towns = [["Prøveby", 10.05, 56.11, 1.0, 0, 0]]
    postal = [["8000", "Prøveby", 10.0, 56.1, 10.1, 56.2]]
    bathing = [["Prøve Pynt", 10.051, 56.102, 0]]
    named = places.named_places(extract.features, towns, postal, bathing)
    by_name = {n[0]: n for n in named}
    assert set(by_name) == {"Prøve Bugt", "Prøve Pynt"}  # no sea bath; a pynt is not a beach
    assert by_name["Prøve Bugt"][4] == -1  # a water is in no postal district
    assert by_name["Prøve Bugt"][3] > 4  # km
    assert by_name["Prøve Pynt"][4] == 0
    assert by_name["Prøve Pynt"][5] == "pynt"


def test_named_places_drop_a_beach_a_bathing_site_names():
    beach = sn.NameFeature("s1", "strand", "Prøve Strand", (10.05, 56.1))
    other = sn.NameFeature("s2", "strand", "Prøve Strand", (10.3, 56.1))  # 15 km off
    named = places.named_places([beach, other], [], [], [["Prøve Strand", 10.051, 56.1, -1]])
    assert [(n[0], n[1]) for n in named] == [("Prøve Strand", 10.3)]


def test_no_secret_in_the_published_files(tmp_path):
    extract = sn.prepare(raw_features())
    doc = json.dumps(sn.to_json(extract))
    assert not re.search(r"(?i)secret|token|bearer", doc)


def test_the_primary_name_may_be_navn_2():
    member = (
        "<sn:navn_1.skrivemaade>Gammelt</sn:navn_1.skrivemaade>"
        "<sn:navn_1.brugsprioritet>sekundær</sn:navn_1.brugsprioritet>"
        "<sn:navn_2.skrivemaade>Løgstør Bredning</sn:navn_2.skrivemaade>"
        "<sn:navn_2.brugsprioritet>primær</sn:navn_2.brugsprioritet>"
    )
    assert sn.primary_name(member) == "Løgstør Bredning"
    assert sn.primary_name(member.replace("primær", "x")) == "Gammelt"  # else the first
    assert sn.primary_name("<sn:navn_2.skrivemaade>Kun To</sn:navn_2.skrivemaade>") == "Kun To"
    assert sn.primary_name("") is None


def square(w: float, s: float, e: float, n: float) -> list[sn.Point]:
    return [(w, s), (e, s), (e, n), (w, n), (w, s)]


def raw_area(fid: str, kind: str, name: str, ring: list[sn.Point]) -> sn.RawFeature:
    return sn.RawFeature(fid, kind, name, [[ring]], [], [])


def test_a_lake_bay_is_no_sea_and_keeps_nothing_by_it():
    # 110 m south of the coastline: a bay of the sea; a fjord behind a sluice
    # touching it; 20 km inland: a lake's bay, an island in the lake and a
    # marina on its shore
    coastline = [[(10.0, 56.301), (10.3, 56.301)]]
    raw = [
        raw_area("w1", "bugt", "Havbugten", square(10.0, 56.2, 10.3, 56.3)),
        raw_area("w2", "fjord", "Slusefjord", square(10.3, 56.2, 10.5, 56.29)),
        *sn.parse_page(gml("FarvandSoe"), QUERY["Farvand"])[1],  # Søvig
        raw_area("l1", "ø", "Søholm", square(10.02, 56.005, 10.025, 56.008)),
        sn.RawFeature("h1", "lystbådehavn", "Søklubben", [], [], [(10.03, 56.021)]),
        sn.RawFeature("h2", "lystbådehavn", "Fjordhavn", [], [], [(10.4, 56.291)]),
    ]
    extract = sn.prepare(raw, coastline)
    kept = {f.name for f in extract.features}
    assert kept == {"Havbugten", "Slusefjord", "Fjordhavn"}
    assert extract.dropped_inland == {"bugt": 1, "ø": 1, "lystbådehavn": 1}
    sea, lakes = sn.sea_waters([sn.prepare_one(r) for r in raw[:3]], coastline)
    assert [w.name for w in lakes] == ["Søvig"]
    # a "hav" is the sea without any coastline near it
    far = raw_area("w4", "hav", "Ude", square(11.0, 57.0, 11.5, 57.5))
    assert "Ude" in {f.name for f in sn.prepare([far], coastline).features}


def test_without_a_coastline_every_water_counts():
    lake = sn.parse_page(gml("FarvandSoe"), QUERY["Farvand"])[1]
    assert [f.name for f in sn.prepare(lake).features] == ["Søvig"]


def test_clipping_a_concave_bay_leaves_its_cuts_on_the_grid():
    # an n-shaped bay (two arms joined north of the cell): in the cell the
    # clip joins the arms by a zero-width edge along the cut, over the land
    # between them; every edge that is no shore lies on the cell's grid
    # lines, which the app leaves out when it measures (web/src/names.ts)
    bay = [
        (10.0, 56.1),
        (10.05, 56.1),
        (10.05, 56.25),
        (10.15, 56.25),
        (10.15, 56.1),
        (10.2, 56.1),
        (10.2, 56.3),
        (10.0, 56.3),
        (10.0, 56.1),
    ]
    feature = sn.NameFeature("w", "bugt", "Hesteskoen", (10.1, 56.28), [bay], [], 1e7)
    cells = sn.cell_files([feature], 0.2)
    from pipeline.ingest.coast import SCALE

    (row,) = cells["50_280"]["features"]
    deltas = row[3][0]
    pts, x, y = [], 0, 0
    for i in range(0, len(deltas), 2):
        x, y = x + deltas[i], y + deltas[i + 1]
        pts.append((x / SCALE, y / SCALE))
    pts.append(pts[0])
    on_grid = lambda v: abs(v / 0.2 - round(v / 0.2)) < 1e-6  # noqa: E731
    cuts = [
        (a, b)
        for a, b in zip(pts, pts[1:], strict=False)
        if (a[1] == b[1] and on_grid(a[1])) or (a[0] == b[0] and on_grid(a[0]))
    ]
    # the sliver over the land (10.05-10.15 E at 56.2 N) is among the cuts
    assert any(min(a[0], b[0]) <= 10.05 and max(a[0], b[0]) >= 10.15 for a, b in cuts)
    shore = [(a, b) for a, b in zip(pts, pts[1:], strict=False) if (a, b) not in cuts]
    # what is left is the real shore: nothing of it runs along 56.2 N
    assert all(not (a[1] == b[1] == 56.2) for a, b in shore)


def test_a_truncated_fetch_fails():
    few = sn.Extract([sn.NameFeature("w", "bugt", "Vig", (10.0, 56.0))], Counter(), Counter())
    with pytest.raises(SystemExit, match="truncated"):
        sn.check_counts(few)
    many = [sn.NameFeature(f"w{i}", "bugt", "Vig", (10.0, 56.0)) for i in range(500)] + [
        sn.NameFeature(f"l{i}", "pynt", "Pynt", (10.0, 56.0)) for i in range(800)
    ]
    sn.check_counts(sn.Extract(many, Counter(), Counter()))  # enough: no error
