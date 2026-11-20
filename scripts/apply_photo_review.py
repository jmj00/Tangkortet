"""Apply the expert's photo verdicts to data/images/<slug>.json.

    py scripts/apply_photo_review.py <review-state.json>

Reads a saved review state (``curl -s https://tangkortet-review.pages.dev/
api/review-state``, kept in the private Tangkortet-expert repo) and, per photo
answered on the review page's "Fotos af arterne" section
(scripts/build_expert_review.py ``photo_key``):

- "behold": ``reviewed: true`` (the app drops its "ikke gennemgået" note once
  every shown photo of the species is reviewed);
- "afvis": ``rejected: true`` (kept in the file, left out of the app);
- "ved_ikke" or no answer: unchanged.

Prints what changed and the species comments, for a person to act on. Never
deletes a photo.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from build_expert_review import photo_key  # noqa: E402

from pipeline.publish import IMAGES_DIR  # noqa: E402


def apply(answers: dict[str, object], images_dir: pathlib.Path = IMAGES_DIR) -> list[str]:
    """Update the image files from the answers; return one line per change."""
    changes: list[str] = []
    for path in sorted(images_dir.glob("*.json")):
        slug = path.stem
        images = json.loads(path.read_text(encoding="utf-8"))
        touched = False
        for img in images:
            verdict = answers.get(photo_key(slug, img["url"]))
            if verdict == "behold" and (not img.get("reviewed") or img.get("rejected")):
                img["reviewed"] = True
                img.pop("rejected", None)
            elif verdict == "afvis" and not img.get("rejected"):
                img["rejected"] = True
                img["reviewed"] = True
            else:
                continue
            touched = True
            changes.append(f"{slug}: {verdict} {img['url']}")
        if touched:
            path.write_text(
                json.dumps(images, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
    return changes


def main() -> None:
    state = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    answers = state.get("answers", {})
    for line in apply(answers):
        print(line)
    for key, text in sorted(answers.items()):
        if key.startswith("foto.") and key.endswith(".kommentar"):
            print(f"\n{key}:\n  {text}")


if __name__ == "__main__":
    main()
