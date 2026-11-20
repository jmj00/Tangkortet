import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))

from apply_photo_review import apply  # noqa: E402
from build_expert_review import photo_key  # noqa: E402

URL = "https://inaturalist-open-data.s3.amazonaws.com/photos/{}/large.jpg"


def test_photo_key_uses_the_inaturalist_photo_id():
    assert photo_key("palmaria-palmata", URL.format(42)) == "foto.palmaria-palmata.42"
    other = "https://example.org/a.jpg"
    assert photo_key("x", other) == photo_key("x", other)  # stable without an id


def test_apply_marks_kept_and_rejected_and_leaves_the_rest(tmp_path):
    imgs = [{"url": URL.format(n), "credit": "A", "license": "CC0 1.0"} for n in (1, 2, 3)]
    for img in imgs:
        img["reviewed"] = False
    (tmp_path / "palmaria-palmata.json").write_text(json.dumps(imgs), encoding="utf-8")
    answers = {
        "foto.palmaria-palmata.1": "behold",
        "foto.palmaria-palmata.2": "afvis",
        "foto.palmaria-palmata.3": "ved_ikke",
    }
    changes = apply(answers, tmp_path)
    assert len(changes) == 2
    out = json.loads((tmp_path / "palmaria-palmata.json").read_text(encoding="utf-8"))
    assert [i["reviewed"] for i in out] == [True, True, False]
    assert [bool(i.get("rejected")) for i in out] == [False, True, False]
    assert len(out) == 3  # nothing deleted
    assert apply(answers, tmp_path) == []  # applying again changes nothing
