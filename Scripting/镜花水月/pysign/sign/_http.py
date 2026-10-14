"""
Zero-dependency HTTP helpers (stdlib ``urllib`` only).

The package used to require ``httpx`` for its two convenience request
helpers; that is a hard dependency for a "signature library", so we ship a
tiny stdlib replacement.  If ``httpx`` happens to be installed it is still
preferred (connection pooling / HTTP/2), otherwise we transparently fall back.
"""

from __future__ import annotations

import json as _json
import urllib.error
import urllib.request

__all__ = ["request", "request_json", "HTTPError"]

try:  # pragma: no cover - optional accelerator
    import httpx as _httpx
except Exception:  # pragma: no cover
    _httpx = None

DEFAULT_TIMEOUT = 30


class HTTPError(Exception):
    """Raised when the server answers with a non-2xx status."""

    def __init__(self, status: int, body: bytes = b"", url: str = ""):
        self.status = status
        self.body = body
        self.url = url
        super().__init__(f"HTTP {status} for {url}: {body[:200]!r}")


def request(method: str, url: str, headers: dict = None, data: bytes = None,
            timeout: float = DEFAULT_TIMEOUT, follow_redirects: bool = True):
    """Perform an HTTP request; returns ``(status, body_bytes)``."""
    headers = dict(headers or {})
    if _httpx is not None:  # pragma: no cover - depends on environment
        resp = _httpx.request(method, url, headers=headers, content=data,
                              timeout=timeout, follow_redirects=follow_redirects)
        return resp.status_code, resp.content

    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def request_json(method: str, url: str, headers: dict = None, data: bytes = None,
                 timeout: float = DEFAULT_TIMEOUT) -> dict:
    """Like :func:`request` but parses the body as JSON and raises on errors."""
    status, body = request(method, url, headers=headers, data=data, timeout=timeout)
    if status < 200 or status >= 300:
        raise HTTPError(status, body, url)
    if not body:
        return {}
    return _json.loads(body.decode("utf-8", "replace"))
