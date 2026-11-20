"""Datafordeler OAuth: exchange an IT system's client id and secret for a
bearer token (the ``client_credentials`` grant). From Svampekortet 624fb8b
(pipeline/datafordeler.py), with Tangkortet's own user agent.

Tangkortet has its own Datafordeler IT system: ``DATAFORDELER_CLIENT_ID`` and
``DATAFORDELER_CLIENT_SECRET`` come from the environment (the git-ignored
``.env`` locally, repo secrets in the deploy). A token lasts 60 minutes.
Never print or log the secret or the token.
"""

from __future__ import annotations

import json
import os
import pathlib
import urllib.parse
import urllib.request

from pipeline.http import USER_AGENT

TOKEN_URL = "https://auth.datafordeler.dk/realms/distribution/protocol/openid-connect/token"


def get_token(client_id: str, client_secret: str) -> str:
    data = urllib.parse.urlencode(
        {"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}
    ).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
        return json.load(resp)["access_token"]


def credentials(env_file: pathlib.Path | None = None) -> tuple[str, str] | None:
    """The client id and secret from the environment, else from ``env_file``
    (``KEY=value`` lines, as the repo's git-ignored ``.env``); None when
    either is missing."""
    cid = os.environ.get("DATAFORDELER_CLIENT_ID")
    secret = os.environ.get("DATAFORDELER_CLIENT_SECRET")
    if not (cid and secret) and env_file is not None and env_file.exists():
        values: dict[str, str] = {}
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.lstrip().startswith("#"):
                values[key.strip()] = value.strip().strip('"').strip("'")
        cid = cid or values.get("DATAFORDELER_CLIENT_ID")
        secret = secret or values.get("DATAFORDELER_CLIENT_SECRET")
    return (cid, secret) if cid and secret else None
