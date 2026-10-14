"""
Unified crypto backend.

Prefers the optional third-party accelerators (``pycryptodome`` for AES,
``gmssl`` for SM3) when they are installed, and transparently falls back to the
bundled pure-Python implementations otherwise — so ``douyin-sign`` imports and
runs with **no dependencies at all**.

    from ._crypto_compat import AES, pad, unpad, sm3_hash, BACKEND
"""

from __future__ import annotations

__all__ = ["AES", "pad", "unpad", "sm3_hash", "sm3_digest", "BACKEND", "HAS_PYCRYPTODOME", "HAS_GMSSL"]

HAS_PYCRYPTODOME = False
HAS_GMSSL = False

try:  # pragma: no cover - depends on environment
    from Crypto.Cipher import AES as AES  # type: ignore
    from Crypto.Util.Padding import pad, unpad  # type: ignore
    HAS_PYCRYPTODOME = True
except Exception:  # pragma: no cover
    from ._pure_aes import AES, pad, unpad  # type: ignore

try:  # pragma: no cover - depends on environment
    from gmssl import sm3 as _gmssl_sm3  # type: ignore

    def sm3_hash(msg) -> str:
        """SM3 hex digest (``gmssl.sm3.sm3_hash`` compatible)."""
        if isinstance(msg, (bytes, bytearray, memoryview)):
            msg = list(bytes(msg))
        return _gmssl_sm3.sm3_hash(msg)

    HAS_GMSSL = True
except Exception:  # pragma: no cover
    from ._pure_sm3 import sm3_hash  # type: ignore

from ._pure_sm3 import sm3_digest  # always available (bytes output)

BACKEND = "pycryptodome+gmssl" if (HAS_PYCRYPTODOME and HAS_GMSSL) else "pure-python"
