"""Tiny stdlib HTTP helpers with retries. The pipeline has no runtime deps."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

USER_AGENT = "Tangkortet/0.1 (+https://github.com/jmj00/Tangkortet)"


def get_text(url: str, params: dict[str, Any] | None = None, *, attempts: int = 4) -> str:
    full = f"{url}?{urllib.parse.urlencode(params, doseq=True)}" if params else url
    req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError) as e:
            if isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500 and e.code != 429:
                raise
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def get_json(url: str, params: dict[str, Any] | None = None) -> Any:
    return json.loads(get_text(url, params))
