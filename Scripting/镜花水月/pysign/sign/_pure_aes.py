"""
Pure-Python AES (FIPS-197) + PKCS#7 padding.

Drop-in replacement for the tiny slice of ``pycryptodome`` that this package
uses, so ``douyin-sign`` runs with **zero third-party dependencies**
(iOS / Scripting / bare Python all work).

Exposed API mirrors pycryptodome:

    from ._pure_aes import AES, pad, unpad
    AES.block_size      -> 16
    AES.MODE_CBC        -> 2
    AES.MODE_OFB        -> 6
    AES.new(key, mode, iv) -> cipher object with .encrypt(bytes) / .decrypt(bytes)
"""

from __future__ import annotations

__all__ = ["AES", "pad", "unpad", "block_size", "MODE_ECB", "MODE_CBC", "MODE_OFB"]

block_size = 16
MODE_ECB = 1
MODE_CBC = 2
MODE_OFB = 6

_SBOX = bytes([
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
])


def _build_inv_sbox() -> bytes:
    inv = bytearray(256)
    for i, v in enumerate(_SBOX):
        inv[v] = i
    return bytes(inv)


_INV_SBOX = _build_inv_sbox()
_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36,
         0x6C, 0xD8, 0xAB, 0x4D, 0x9A]


def _xtime(a: int) -> int:
    a <<= 1
    if a & 0x100:
        a ^= 0x11B
    return a & 0xFF


def _gmul(a: int, b: int) -> int:
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        a = _xtime(a)
        b >>= 1
    return p & 0xFF


def _expand_key(key: bytes):
    nk = len(key) // 4
    if nk not in (4, 6, 8):
        raise ValueError("AES key must be 16, 24 or 32 bytes")
    nr = nk + 6
    w = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
    for i in range(nk, 4 * (nr + 1)):
        temp = list(w[i - 1])
        if i % nk == 0:
            temp = temp[1:] + temp[:1]
            temp = [_SBOX[b] for b in temp]
            temp[0] ^= _RCON[i // nk - 1]
        elif nk > 6 and i % nk == 4:
            temp = [_SBOX[b] for b in temp]
        w.append([w[i - nk][j] ^ temp[j] for j in range(4)])
    return w, nr


def _add_round_key(state, w, rnd):
    for c in range(4):
        for r in range(4):
            state[r][c] ^= w[rnd * 4 + c][r]


def _sub_bytes(state, box):
    for r in range(4):
        for c in range(4):
            state[r][c] = box[state[r][c]]


def _shift_rows(state):
    for r in range(1, 4):
        state[r] = state[r][r:] + state[r][:r]


def _inv_shift_rows(state):
    for r in range(1, 4):
        state[r] = state[r][-r:] + state[r][:-r]


def _mix_columns(state):
    for c in range(4):
        a = [state[r][c] for r in range(4)]
        state[0][c] = _gmul(a[0], 2) ^ _gmul(a[1], 3) ^ a[2] ^ a[3]
        state[1][c] = a[0] ^ _gmul(a[1], 2) ^ _gmul(a[2], 3) ^ a[3]
        state[2][c] = a[0] ^ a[1] ^ _gmul(a[2], 2) ^ _gmul(a[3], 3)
        state[3][c] = _gmul(a[0], 3) ^ a[1] ^ a[2] ^ _gmul(a[3], 2)


def _inv_mix_columns(state):
    for c in range(4):
        a = [state[r][c] for r in range(4)]
        state[0][c] = _gmul(a[0], 14) ^ _gmul(a[1], 11) ^ _gmul(a[2], 13) ^ _gmul(a[3], 9)
        state[1][c] = _gmul(a[0], 9) ^ _gmul(a[1], 14) ^ _gmul(a[2], 11) ^ _gmul(a[3], 13)
        state[2][c] = _gmul(a[0], 13) ^ _gmul(a[1], 9) ^ _gmul(a[2], 14) ^ _gmul(a[3], 11)
        state[3][c] = _gmul(a[0], 11) ^ _gmul(a[1], 13) ^ _gmul(a[2], 9) ^ _gmul(a[3], 14)


def _bytes_to_state(block: bytes):
    return [[block[4 * c + r] for c in range(4)] for r in range(4)]


def _state_to_bytes(state) -> bytes:
    out = bytearray(16)
    for c in range(4):
        for r in range(4):
            out[4 * c + r] = state[r][c]
    return bytes(out)


def _encrypt_block(block: bytes, w, nr) -> bytes:
    state = _bytes_to_state(block)
    _add_round_key(state, w, 0)
    for rnd in range(1, nr):
        _sub_bytes(state, _SBOX)
        _shift_rows(state)
        _mix_columns(state)
        _add_round_key(state, w, rnd)
    _sub_bytes(state, _SBOX)
    _shift_rows(state)
    _add_round_key(state, w, nr)
    return _state_to_bytes(state)


def _decrypt_block(block: bytes, w, nr) -> bytes:
    state = _bytes_to_state(block)
    _add_round_key(state, w, nr)
    for rnd in range(nr - 1, 0, -1):
        _inv_shift_rows(state)
        _sub_bytes(state, _INV_SBOX)
        _add_round_key(state, w, rnd)
        _inv_mix_columns(state)
    _inv_shift_rows(state)
    _sub_bytes(state, _INV_SBOX)
    _add_round_key(state, w, 0)
    return _state_to_bytes(state)


class _Cipher:
    def __init__(self, key: bytes, mode: int, iv: bytes = None):
        if not isinstance(key, (bytes, bytearray)):
            raise TypeError("key must be bytes")
        self._w, self._nr = _expand_key(bytes(key))
        self._mode = mode
        self._iv = bytes(iv) if iv is not None else None
        if mode in (MODE_CBC, MODE_OFB) and (self._iv is None or len(self._iv) != 16):
            raise ValueError("CBC/OFB need a 16-byte IV")

    # -- ECB helpers -------------------------------------------------
    def _ecb_encrypt(self, data: bytes) -> bytes:
        return b"".join(
            _encrypt_block(data[i:i + 16], self._w, self._nr)
            for i in range(0, len(data), 16)
        )

    def _ecb_decrypt(self, data: bytes) -> bytes:
        return b"".join(
            _decrypt_block(data[i:i + 16], self._w, self._nr)
            for i in range(0, len(data), 16)
        )

    # -- public API --------------------------------------------------
    def encrypt(self, data: bytes) -> bytes:
        if self._mode == MODE_CBC:
            prev = self._iv
            out = bytearray()
            for i in range(0, len(data), 16):
                block = bytes(a ^ b for a, b in zip(data[i:i + 16], prev))
                cipher_block = _encrypt_block(block, self._w, self._nr)
                out += cipher_block
                prev = cipher_block
            return bytes(out)
        if self._mode == MODE_OFB:
            prev = self._iv
            out = bytearray()
            for i in range(0, len(data), 16):
                prev = _encrypt_block(prev, self._w, self._nr)
                chunk = data[i:i + 16]
                out += bytes(a ^ b for a, b in zip(chunk, prev))
            return bytes(out)
        # ECB fallback
        return self._ecb_encrypt(data)

    def decrypt(self, data: bytes) -> bytes:
        if self._mode == MODE_CBC:
            prev = self._iv
            out = bytearray()
            for i in range(0, len(data), 16):
                chunk = data[i:i + 16]
                plain = _decrypt_block(chunk, self._w, self._nr)
                out += bytes(a ^ b for a, b in zip(plain, prev))
                prev = chunk
            return bytes(out)
        if self._mode == MODE_OFB:
            prev = self._iv
            out = bytearray()
            for i in range(0, len(data), 16):
                prev = _encrypt_block(prev, self._w, self._nr)
                chunk = data[i:i + 16]
                out += bytes(a ^ b for a, b in zip(chunk, prev))
            return bytes(out)
        return self._ecb_decrypt(data)


class AES:
    """pycryptodome-compatible façade (only the used subset)."""

    block_size = block_size
    key_size = (16, 24, 32)
    MODE_ECB = 1
    MODE_CBC = MODE_CBC
    MODE_OFB = MODE_OFB

    @staticmethod
    def new(key, mode, iv=None) -> _Cipher:
        return _Cipher(key, mode, iv)


def pad(data: bytes, bs: int = block_size) -> bytes:
    """PKCS#7 padding."""
    n = bs - (len(data) % bs)
    return bytes(data) + bytes([n]) * n


def unpad(data: bytes, bs: int = block_size) -> bytes:
    """PKCS#7 unpadding (tolerant: falls back to raw data)."""
    if not data:
        return bytes(data)
    n = data[-1]
    if 1 <= n <= bs and len(data) >= n and data[-n:] == bytes([n]) * n:
        return bytes(data[:-n])
    return bytes(data)
