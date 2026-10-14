"""
dyn_encode - Dynamic version encoding (dyn_version 1-8).
Each version builds a different 4-byte magic based on XOR/SUM/AND/OR tables.
Direct translation from armxe Mobile/helpers/argus.py dyn_encode().
"""

import hashlib
import zlib

from . import _crypto_compat as _sm3
from ._crypto_compat import AES as _AES, pad

from .native import reverse_bytes, reverse_bits_native, byteswap, bit_swap, byteswap_32
from .rc4 import RC4


def _do_cipher(data: bytes, key: str) -> int:
    """AES-OFB encrypt and return last 4 bytes as int (little-endian)."""
    cipher = _AES.new(key[:16].encode(), _AES.MODE_OFB, iv=key[16:].encode())
    data_padded = pad(data, 16)
    encrypted = cipher.encrypt(data_padded)
    return int.from_bytes(encrypted[-4:], "little")


def dyn_encode(dyn_version: int, params: bytes, payload: bytes, rand: int) -> str:
    """
    Encode dynamic version magic.

    Args:
        dyn_version: Version number (1-8)
        params:      URL query params bytes
        payload:     Request body bytes
        rand:        Random integer

    Returns:
        Hex string (24 hex chars = 12 bytes = 3 uint32 values)
    """
    if dyn_version > 8:
        raise ValueError(f"dyn_version {dyn_version} not supported (max 8)")

    if dyn_version == 1:
        unk_hash = hashlib.md5(bytes([0, 0, 0, 1])).digest()
        ss_stub_hash = hashlib.md5(payload).digest()
        params_hash = hashlib.md5(params).digest()

        unk = int.from_bytes(unk_hash[:4], 'little') ^ rand
        ss_stub = int.from_bytes(ss_stub_hash[:4], 'little') ^ rand
        params_h = int.from_bytes(params_hash[:4], 'little') ^ rand

        return (
            unk.to_bytes(4, 'big').hex() +
            ss_stub.to_bytes(4, 'big').hex() +
            params_h.to_bytes(4, 'big').hex()
        )

    elif dyn_version == 2:
        unk_hash = hashlib.md5(bytes([0, 0, 0, 1])).digest()
        ss_stub_hash = hashlib.md5(payload).digest()
        params_hash = hashlib.md5(params).digest()

        unk = int.from_bytes(reverse_bytes(unk_hash[:4]), 'little') ^ rand
        ss_stub = int.from_bytes(reverse_bytes(ss_stub_hash[:4]), 'little') ^ rand
        params_h = int.from_bytes(reverse_bytes(params_hash[:4]), 'little') ^ rand

        return (
            unk.to_bytes(4, 'big').hex() +
            ss_stub.to_bytes(4, 'big').hex() +
            params_h.to_bytes(4, 'big').hex()
        )

    elif dyn_version == 3:
        unk_hash = hashlib.md5(bytes([0, 0, 0, 1])).digest()
        ss_stub_hash = hashlib.md5(payload).digest()
        params_hash = hashlib.md5(params).digest()

        unk = int.from_bytes(unk_hash[:4], 'big').to_bytes(4, 'little')
        unk = int.from_bytes(unk, 'big') ^ 0x5A5A5A5A ^ rand

        ss_stub = int.from_bytes(ss_stub_hash[:4], 'big').to_bytes(4, 'little')
        ss_stub = int.from_bytes(ss_stub, 'big') ^ 0x5A5A5A5A ^ rand

        params_h = int.from_bytes(params_hash[:4], 'big').to_bytes(4, 'little')
        params_h = int.from_bytes(params_h, 'big') ^ 0x5A5A5A5A ^ rand

        return (
            (unk & 0xFFFFFFFF).to_bytes(4, 'big') +
            (ss_stub & 0xFFFFFFFF).to_bytes(4, 'big') +
            (params_h & 0xFFFFFFFF).to_bytes(4, 'big')
        ).hex()

    elif dyn_version == 4:
        unk_hash = hashlib.md5(bytes([0, 0, 0, 1])).digest()
        ss_stub_hash = hashlib.md5(payload).digest()
        params_hash = hashlib.md5(params).digest()

        unk = reverse_bits_native(int.from_bytes(unk_hash[:4], 'big')) ^ rand
        ss_stub = reverse_bits_native(int.from_bytes(ss_stub_hash[:4], 'big')) ^ rand
        params_h = reverse_bits_native(int.from_bytes(params_hash[:4], 'big')) ^ rand

        return (
            unk.to_bytes(4, 'big').hex() +
            ss_stub.to_bytes(4, 'big').hex() +
            params_h.to_bytes(4, 'big').hex()
        )

    elif dyn_version == 5:
        unk_hash = bytes.fromhex(_sm3.sm3_hash(bytearray([0, 0, 0, 1])))
        ss_stub_hash = bytes.fromhex(_sm3.sm3_hash(bytearray(payload)))
        params_hash = bytes.fromhex(_sm3.sm3_hash(bytearray(params)))

        unk = int.from_bytes(unk_hash[28:], 'little') ^ rand
        ss_stub = int.from_bytes(ss_stub_hash[28:], 'little') ^ rand
        params_h = int.from_bytes(params_hash[28:], 'little') ^ rand

        return (
            unk.to_bytes(4, 'big').hex() +
            ss_stub.to_bytes(4, 'big').hex() +
            params_h.to_bytes(4, 'big').hex()
        )

    elif dyn_version == 6:
        key = hashlib.md5(rand.to_bytes(4, 'big')).hexdigest()

        params_h = _do_cipher(params, key=key) ^ rand
        ss_stub = _do_cipher(payload, key=key) ^ rand
        unk = _do_cipher(bytes([0, 0, 0, 1]), key=key) ^ rand

        return (
            unk.to_bytes(4, 'big').hex() +
            ss_stub.to_bytes(4, 'big').hex() +
            params_h.to_bytes(4, 'big').hex()
        )

    elif dyn_version == 7:
        key = hashlib.md5(rand.to_bytes(4, byteorder="big")).digest().hex()

        rc4 = RC4(key.encode())
        rc4.init()

        unk = bytearray(rc4.encrypt(bytes.fromhex("00000001")))
        for i in range(len(unk)):
            unk[i] = byteswap(bit_swap(unk[i]))

        r = byteswap_32(rand)
        unk_v = int.from_bytes(unk, byteorder="big") ^ r

        ss_stub = (
            int.from_bytes(
                hashlib.md5(payload).digest()[-4:], byteorder="big"
            )
            ^ rand
        )

        params_h = (
            int.from_bytes(
                hashlib.sha256(params).digest()[0:4], byteorder="big"
            )
            ^ 0x5A5A5A5A
            ^ rand
        )

        return (
            unk_v.to_bytes(4, 'little').hex() +
            ss_stub.to_bytes(4, 'little').hex() +
            params_h.to_bytes(4, 'little').hex()
        )

    elif dyn_version == 8:
        unk = bytearray(hashlib.sha256(bytes.fromhex("00000001")).digest()[0:4])
        for i in range(len(unk)):
            unk[i] = byteswap(unk[i])

        x_ss_stub = bytearray(
            (zlib.crc32(payload) & 0xFFFFFFFF).to_bytes(4, byteorder="big")
        )
        for i in range(len(x_ss_stub)):
            x_ss_stub[i] = byteswap(bit_swap(x_ss_stub[i]))

        params_h = hashlib.sha1(params).digest()[0:4]

        part_1 = int.from_bytes(unk, byteorder="little") ^ rand
        part_2 = int.from_bytes(x_ss_stub, byteorder="little") ^ rand
        part_3 = int.from_bytes(params_h, byteorder="little") ^ 0x5A5A5A5A ^ rand

        return (
            part_1.to_bytes(4, byteorder="big").hex()
            + part_2.to_bytes(4, byteorder="big").hex()
            + part_3.to_bytes(4, byteorder="big").hex()
        )

    raise ValueError(f"dyn_version {dyn_version} not implemented")
