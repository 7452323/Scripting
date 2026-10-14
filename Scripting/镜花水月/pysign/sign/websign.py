"""Douyin web ``x-secsdk-web-signature`` — the ArgusSecurityPlugin signature.

Douyin sign-protects a subset of its web API (see :data:`PROTECTED_PATHS_GET`).
A request to those paths that carries no ``x-secsdk-web-signature`` is refused
with ``403 Blocked by ArgusSecurityPlugin Signature Not Found`` — and with
``... Uifid Not Found`` when the ``uifid`` header is missing as well.

The algorithm, which is a pure function of four inputs::

    signature = md5(f"{uifid}_{timestamp}_{SALT}_{canonical_query}").hexdigest()

``SALT`` is a constant lifted from secsdk's VM string table
(``runtime_bundler_34.js``, project id 34). It is not bound to an account or a
session, so it survives cookie resets.

Independent implementations of this were cross-checked here against signatures
produced by a real browser, byte for byte: ``Evil0ctal/Douyin_TikTok_Download_API``,
``JoeanAmier/TikTokDownloader`` and ``cv-cat/DouYin_Spider``.

Ordering rules, all of them load-bearing:

* ``uifid`` goes last in the query unless it is already present, in which case it
  stays where it is — appending a second copy changes the preimage.
* ``timestamp`` (whole seconds) is appended after ``uifid``.
* The signature covers the query exactly as it will be sent, so the query that is
  hashed must be the query on the wire. Anything else is a signature over bytes
  the platform never sees.
"""

import hashlib
import time
from urllib.parse import quote, unquote

#: secsdk VM string table constant for the ``douyin_web`` project (id 34).
SALT = "A96D855A08C0A9707F8BEF0D9A527E4E"

SIGNATURE_PARAM = "x-secsdk-web-signature"
UIFID_PARAM = "uifid"
TIMESTAMP_PARAM = "timestamp"
#: Sent alongside the query by the platform's own pages. Accepted but optional.
EXPIRE_HEADER = "x-secsdk-web-expire"

#: Endpoints that go through the ``webSign`` strategy on www.douyin.com.
PROTECTED_PATHS_GET = (
    "/aweme/v1/web/aweme/detail/",
    "/aweme/v1/web/aweme/post/",
    "/aweme/v1/web/aweme/favorite/",
    "/aweme/v1/web/aweme/listcollection/",
    "/aweme/v1/web/mix/aweme/",
    "/aweme/v1/web/tab/feed/",
    "/aweme/v1/web/mix/list/",
    "/aweme/v1/web/music/aweme/",
    "/aweme/v1/web/music/list/",
    "/aweme/v1/web/mix/detail/",
    "/aweme/v1/web/mix/listcollection/",
    "/aweme/v1/web/music/detail/",
    "/aweme/v1/web/collects/list/",
    "/aweme/v1/web/collects/video/list/",
)

PROTECTED_PATHS_POST = (
    "/aweme/v1/web/aweme/detail/",
    "/aweme/v1/web/aweme/post/",
    "/aweme/v1/web/aweme/favorite/",
    "/aweme/v1/web/aweme/listcollection/",
    "/aweme/v1/web/mix/aweme/",
    "/aweme/v1/web/tab/feed/",
)


def is_protected(path: str, method: str = "GET") -> bool:
    """Whether `path` needs a secsdk signature for this HTTP method."""
    table = PROTECTED_PATHS_POST if method.upper() == "POST" else PROTECTED_PATHS_GET
    return any(path.startswith(p) for p in table)


def _pairs(query: str):
    """Split a query string, decoding each side, dropping empty segments."""
    out = []
    for part in query.split("&"):
        if not part:
            continue
        name, _, value = part.partition("=")
        out.append((unquote(name), unquote(value)))
    return out


def encode_pairs(pairs) -> str:
    """Serialize like the ``URLSearchParams.toString()`` the SDK hashes.

    ``*-._`` are the only characters left unescaped; everything else, spaces and
    non-ASCII included, becomes percent-encoded UTF-8.
    """
    return "&".join(
        f"{quote(name, safe='*-._')}={quote(value, safe='*-._')}"
        for name, value in pairs
    )


def canonical_query(query: str) -> str:
    """Return the byte sequence secsdk actually hashes."""
    return encode_pairs(_pairs(query))


def websign_sign(query: str, uifid: str, timestamp: "int | None" = None):
    """Append the visitor id and timestamp, then sign.

    Args:
        query: the query string as it will be sent, without the signature
            parameter. Already containing ``uifid`` is fine and preferred.
        uifid: visitor id the signature is bound to — the ``UIFID`` cookie value
            on a douyin session born from the web page.
        timestamp: whole seconds; defaults to now. Fixed values make tests stable.

    Returns:
        ``(signed_query, signature)`` where ``signed_query`` ends in
        ``&x-secsdk-web-signature=<signature>`` and can be sent as-is.
    """
    stamp = str(int(time.time() if timestamp is None else timestamp))
    pairs = _pairs(query)
    if not any(name == UIFID_PARAM for name, _ in pairs):
        pairs.append((UIFID_PARAM, uifid))
    pairs.append((TIMESTAMP_PARAM, stamp))
    hashed = encode_pairs(pairs)
    signature = hashlib.md5(f"{uifid}_{stamp}_{SALT}_{hashed}".encode()).hexdigest()
    return f"{hashed}&{SIGNATURE_PARAM}={signature}", signature
