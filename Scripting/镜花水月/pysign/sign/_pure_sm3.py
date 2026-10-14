"""
Pure-Python SM3 (GB/T 32905-2016 / GM/T 0004-2012).

Zero-dependency replacement for ``gmssl.sm3``.  Accepts ``bytes`` (or a list
of ints, like gmssl does) and exposes the same ``sm3_hash`` helper:

    from ._pure_sm3 import sm3_hash
    sm3_hash(b"abc")            # -> "66c7f0f4..."
    sm3_hash(bytearray(b"abc"))  # works too
"""

from __future__ import annotations

import struct

__all__ = ["sm3_hash", "SM3", "sm3_digest"]

_IV = [0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600,
       0xA96F30BC, 0x163138AA, 0xE38DEE4D, 0xB0FB0E4E]

_MASK = 0xFFFFFFFF


def _rotl(x: int, n: int) -> int:
    n %= 32
    return ((x << n) | (x >> (32 - n))) & _MASK


def _t(j: int) -> int:
    return 0x79CC4519 if j <= 15 else 0x7A879D8A


def _ff(j: int, x: int, y: int, z: int) -> int:
    return (x ^ y ^ z) if j <= 15 else ((x & y) | (x & z) | (y & z))


def _gg(j: int, x: int, y: int, z: int) -> int:
    return (x ^ y ^ z) if j <= 15 else ((x & y) | (~x & z) & _MASK)


def _p0(x: int) -> int:
    return (x ^ _rotl(x, 9) ^ _rotl(x, 17)) & _MASK


def _p1(x: int) -> int:
    return (x ^ _rotl(x, 15) ^ _rotl(x, 23)) & _MASK


def _compress(reg, block: bytes) -> None:
    w = [0] * 68
    wp = [0] * 64
    for i in range(16):
        w[i] = struct.unpack(">I", block[i * 4:i * 4 + 4])[0]
    for j in range(16, 68):
        w[j] = _p1(w[j - 16] ^ w[j - 9] ^ _rotl(w[j - 3], 15)) ^ _rotl(w[j - 13], 7) ^ w[j - 6]
        w[j] &= _MASK
    for j in range(64):
        wp[j] = w[j] ^ w[j + 4]

    a, b, c, d, e, f, g, h = reg
    for j in range(64):
        ss1 = _rotl((_rotl(a, 12) + e + _rotl(_t(j), j)) & _MASK, 7)
        ss2 = ss1 ^ _rotl(a, 12)
        tt1 = (_ff(j, a, b, c) + d + ss2 + wp[j]) & _MASK
        tt2 = (_gg(j, e, f, g) + h + ss1 + w[j]) & _MASK
        d, c, b, a = c, _rotl(b, 9), a, tt1
        h, g, f, e = g, _rotl(f, 19), e, _p0(tt2)
    reg[0] ^= a
    reg[1] ^= b
    reg[2] ^= c
    reg[3] ^= d
    reg[4] ^= e
    reg[5] ^= f
    reg[6] ^= g
    reg[7] ^= h


def _normalize(msg) -> bytes:
    if isinstance(msg, bytes):
        return msg
    if isinstance(msg, bytearray):
        return bytes(msg)
    if isinstance(msg, str):
        return msg.encode("utf-8")
    if isinstance(msg, (list, tuple)):
        return bytes(bytearray(msg))
    if isinstance(msg, memoryview):
        return msg.tobytes()
    raise TypeError(f"unsupported SM3 input type: {type(msg)!r}")


class SM3:
    """Incremental SM3 context (``update`` / ``digest`` / ``hexdigest``)."""

    def __init__(self, data=None):
        self._reg = list(_IV)
        self._buf = b""
        self._size = 0
        if data is not None:
            self.update(data)

    def update(self, data) -> "SM3":
        data = _normalize(data)
        self._size += len(data)
        self._buf += data
        while len(self._buf) >= 64:
            _compress(self._reg, self._buf[:64])
            self._buf = self._buf[64:]
        return self

    def digest(self) -> bytes:
        reg = list(self._reg)
        buf = bytearray(self._buf)
        bit_len = self._size * 8
        buf.append(0x80)
        while len(buf) % 64 != 56:
            buf.append(0)
        buf += struct.pack(">Q", bit_len & 0xFFFFFFFFFFFFFFFF)
        for i in range(0, len(buf), 64):
            _compress(reg, bytes(buf[i:i + 64]))
        return b"".join(struct.pack(">I", x) for x in reg)

    def hexdigest(self) -> str:
        return self.digest().hex()


def sm3_digest(msg) -> bytes:
    """SM3 digest as raw bytes."""
    return SM3(msg).digest()


def sm3_hash(msg) -> str:
    """SM3 hex digest — signature compatible with ``gmssl.sm3.sm3_hash``."""
    return SM3(msg).hexdigest()
