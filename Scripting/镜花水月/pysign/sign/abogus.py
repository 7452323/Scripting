"""
A-Bogus (SM3-based) signature for Douyin/TikTok Web.

Current algorithm used by Douyin Web. Uses SM3 double-hash + RC4 + shifted base64
with environment fingerprint encoding.

Public API:
    abogus_sign(params, ua, ...) -> str
    abogus_url(params, ua) -> str
"""

import struct
import random
from time import time

# ============================================================
# Constants
# ============================================================

# Shifted base64 tables for variant encoding
SHIFT_S3 = "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe"
SHIFT_S4 = "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe"


# ============================================================
# SM3 Hash (GB/T 32905-2016)
# ============================================================

def _sm3_reset(ctx):
    """Initialize SM3 registers."""
    ctx['reg'] = [
        0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
        0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e
    ]
    ctx['chunk'] = []
    ctx['size'] = 0


def _sm3_le(x, n):
    """32-bit left rotation."""
    n %= 32
    return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF


def _sm3_t(j):
    """SM3 constant Tj."""
    if 0 <= j <= 15:
        return 0x79cc4519
    return 0x7a879d8a


def _sm3_ff(j, x, y, z):
    """SM3 boolean function FF."""
    if 0 <= j <= 15:
        return x ^ y ^ z
    return (x & y) | (x & z) | (y & z)


def _sm3_gg(j, x, y, z):
    """SM3 boolean function GG."""
    if 0 <= j <= 15:
        return x ^ y ^ z
    return (x & y) | (~x & z)


def _sm3_p0(x):
    return x ^ _sm3_le(x, 9) ^ _sm3_le(x, 17)


def _sm3_p1(x):
    return x ^ _sm3_le(x, 15) ^ _sm3_le(x, 23)


def _sm3_compress(ctx, block):
    """SM3 compression function. block = 64 bytes."""
    w = [0] * 68
    w1 = [0] * 64
    for i in range(16):
        w[i] = struct.unpack('>I', block[i*4:(i+1)*4])[0]
    for j in range(16, 68):
        p = _sm3_p1(w[j-16] ^ w[j-9] ^ _sm3_le(w[j-3], 15))
        w[j] = p ^ _sm3_le(w[j-13], 7) ^ w[j-6]
    for j in range(64):
        w1[j] = w[j] ^ w[j+4]

    a, b, c, d, e, f, g, h = ctx['reg']
    for j in range(64):
        ss1 = _sm3_le(((_sm3_le(a, 12) + e + _sm3_le(_sm3_t(j), j)) & 0xFFFFFFFF), 7)
        ss2 = ss1 ^ _sm3_le(a, 12)
        tt1 = (_sm3_ff(j, a, b, c) + d + ss2 + w1[j]) & 0xFFFFFFFF
        tt2 = (_sm3_gg(j, e, f, g) + h + ss1 + w[j]) & 0xFFFFFFFF
        d = c
        c = _sm3_le(b, 9)
        b = a
        a = tt1
        h = g
        g = _sm3_le(f, 19)
        f = e
        e = _sm3_p0(tt2)

    ctx['reg'][0] ^= a
    ctx['reg'][1] ^= b
    ctx['reg'][2] ^= c
    ctx['reg'][3] ^= d
    ctx['reg'][4] ^= e
    ctx['reg'][5] ^= f
    ctx['reg'][6] ^= g
    ctx['reg'][7] ^= h


def _sm3_write(ctx, data: bytes):
    ctx['size'] += len(data)
    ctx['chunk'].extend(data)
    while len(ctx['chunk']) >= 64:
        _sm3_compress(ctx, bytes(ctx['chunk'][:64]))
        ctx['chunk'] = ctx['chunk'][64:]


def _sm3_fill(ctx):
    """Pad to 512-bit boundary."""
    bit_len = ctx['size'] * 8
    ctx['chunk'].append(0x80)
    while (len(ctx['chunk']) % 64) != 56:
        ctx['chunk'].append(0)
    ctx['chunk'].extend(struct.pack('>Q', bit_len))


def _sm3_sum(data: bytes) -> bytes:
    """SM3 hash. Input bytes, output 32 bytes."""
    ctx = {}
    _sm3_reset(ctx)
    _sm3_write(ctx, data)
    _sm3_fill(ctx)
    while len(ctx['chunk']) >= 64:
        _sm3_compress(ctx, bytes(ctx['chunk'][:64]))
        ctx['chunk'] = ctx['chunk'][64:]
    out = bytearray()
    for val in ctx['reg']:
        out.extend(struct.pack('>I', val))
    return bytes(out)


def _sm3_sum_str(s: str) -> bytes:
    """SM3 hash of URI-encoded string (matches JS encodeURIComponent)."""
    import urllib.parse
    encoded = urllib.parse.quote(s, safe='')
    return _sm3_sum(encoded.encode('latin-1'))


# ============================================================
# RC4 Stream Cipher
# ============================================================

def _rc4(key: bytes, data: bytes) -> bytes:
    """RC4 encrypt/decrypt."""
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]

    i = j = 0
    out = bytearray()
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        k = s[(s[i] + s[j]) % 256]
        out.append(byte ^ k)
    return bytes(out)


# ============================================================
# Variant Base64 Encoding (no padding)
# ============================================================

def _raw_encode(data: bytes, table: str) -> str:
    """Variant base64 encode without padding. Every 3 input bytes produce 4 output chars."""
    result = []
    for i in range(0, len(data), 3):
        b = data[i:i + 3]
        if len(b) < 3:
            b = b + b'\x00' * (3 - len(b))
        n1, n2, n3 = b[0], b[1], b[2]
        encoded = (n1 << 16) | (n2 << 8) | n3
        for shift in (18, 12, 6, 0):
            idx = (encoded >> shift) & 0x3F
            result.append(table[idx])
    return ''.join(result)


# ============================================================
# A-Bogus Signature
# ============================================================

def abogus_sign(
    params: str,
    ua: str,
    window_env: str = None,
    suffix: str = "cus",
    arguments: list = None,
    aid: int = 6383,
    page_id: int = 6241,
) -> str:
    """
    Generate A-Bogus signature (current Douyin Web algorithm).

    Args:
        params:     URL query string (without ?)
        ua:         Browser User-Agent
        window_env: Environment fingerprint string
        suffix:     Suffix string, default "cus"
        arguments:  [magic_byte, arg2, arg3], default [0, 1, 14]
        aid:        App ID, default 6383
        page_id:    Page ID, default 6241

    Returns:
        A-Bogus signature value (variant base64 string)
    """
    if window_env is None:
        window_env = "1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32"
    if arguments is None:
        arguments = [0, 1, 14]

    start_time = int(time() * 1000)

    # Triple SM3 hash
    hash_params = _sm3_sum(_sm3_sum_str(params + suffix))
    hash_suffix = _sm3_sum(_sm3_sum_str(suffix))

    # UA: RC4 encrypt → variant b64 → SM3
    ua_rc4 = _rc4(bytes([0, 1, 14]), ua.encode('utf-8'))
    ua_encrypted = _raw_encode(ua_rc4, SHIFT_S3)
    hash_ua = _sm3_sum(ua_encrypted.encode('latin-1'))

    end_time = start_time + random.randint(2, 20)

    b = {}
    b[8] = 3
    b[10] = end_time
    b[15] = {
        "aid": aid,
        "pageId": page_id,
        "boe": False,
        "ddrt": 7,
        "paths": {"include": [{}, {}, {}, {}, {}, {}, {}, {}], "exclude": []},
        "track": {"mode": 0, "delay": 300, "paths": []},
        "dump": True,
        "rpU": "",
    }
    b[16] = start_time
    b[18] = 44
    b[19] = [1, 0, 1, 5]

    # Timestamp split
    b[20] = (b[16] >> 24) & 0xFF
    b[21] = (b[16] >> 16) & 0xFF
    b[22] = (b[16] >> 8) & 0xFF
    b[23] = b[16] & 0xFF
    b[24] = (b[16] // 256 // 256 // 256 // 256) & 0xFF
    b[25] = (b[16] // 256 // 256 // 256 // 256 // 256) & 0xFF

    # Arguments
    b[26] = (arguments[0] >> 24) & 0xFF
    b[27] = (arguments[0] >> 16) & 0xFF
    b[28] = (arguments[0] >> 8) & 0xFF
    b[29] = arguments[0] & 0xFF
    b[30] = (arguments[1] // 256) & 0xFF
    b[31] = (arguments[1] % 256) & 0xFF
    b[32] = (arguments[1] >> 24) & 0xFF
    b[33] = (arguments[1] >> 16) & 0xFF
    b[34] = (arguments[2] >> 24) & 0xFF
    b[35] = (arguments[2] >> 16) & 0xFF
    b[36] = (arguments[2] >> 8) & 0xFF
    b[37] = arguments[2] & 0xFF

    # SM3 hash fragments
    b[38] = hash_params[21]
    b[39] = hash_params[22]
    b[40] = hash_suffix[21]
    b[41] = hash_suffix[22]
    b[42] = hash_ua[21]
    b[43] = hash_ua[22]

    # End time
    b[44] = (b[10] >> 24) & 0xFF
    b[45] = (b[10] >> 16) & 0xFF
    b[46] = (b[10] >> 8) & 0xFF
    b[47] = b[10] & 0xFF
    b[48] = b[8]
    b[49] = (b[10] // 256 // 256 // 256 // 256) & 0xFF
    b[50] = (b[10] // 256 // 256 // 256 // 256 // 256) & 0xFF

    # pageId / aid
    b[51] = b[15]['pageId']
    b[52] = (b[51] >> 24) & 0xFF
    b[53] = (b[51] >> 16) & 0xFF
    b[54] = (b[51] >> 8) & 0xFF
    b[55] = b[51] & 0xFF
    b[56] = b[15]['aid']
    b[57] = b[56] & 0xFF
    b[58] = (b[56] >> 8) & 0xFF
    b[59] = (b[56] >> 16) & 0xFF
    b[60] = (b[56] >> 24) & 0xFF

    # Window environment
    env_chars = [ord(c) for c in window_env]
    b[64] = len(env_chars)
    b[65] = b[64] & 0xFF
    b[66] = (b[64] >> 8) & 0xFF

    b[69] = 0
    b[70] = b[69] & 0xFF
    b[71] = (b[69] >> 8) & 0xFF

    # Checksum XOR
    b[72] = (b[18] ^ b[20] ^ b[26] ^ b[30] ^ b[38] ^ b[40] ^ b[42] ^ b[21] ^
             b[27] ^ b[31] ^ b[35] ^ b[39] ^ b[41] ^ b[43] ^ b[22] ^
             b[28] ^ b[32] ^ b[36] ^ b[23] ^ b[29] ^ b[33] ^ b[37] ^
             b[44] ^ b[45] ^ b[46] ^ b[47] ^ b[48] ^ b[49] ^ b[50] ^
             b[24] ^ b[25] ^ b[52] ^ b[53] ^ b[54] ^ b[55] ^ b[57] ^
             b[58] ^ b[59] ^ b[60] ^ b[65] ^ b[66] ^ b[70] ^ b[71])

    # Build core byte array
    bb = [
        b[18], b[20], b[52], b[26], b[30], b[34], b[58], b[38],
        b[40], b[53], b[42], b[21], b[27], b[54], b[55], b[31],
        b[35], b[57], b[39], b[41], b[43], b[22], b[28], b[32],
        b[60], b[36], b[23], b[29], b[33], b[37], b[44], b[45],
        b[59], b[46], b[47], b[48], b[49], b[50], b[24], b[25],
        b[65], b[66], b[70], b[71],
    ]
    bb.extend(env_chars)
    bb.append(b[72])

    # RC4(key=0x79) encrypt
    rc4_out = _rc4(bytes([121]), bytes(bb))
    rc4_str = rc4_out.decode('latin-1')

    # Random 4-byte prefix
    prefix_chars = []
    for _ in range(3):
        rand_val = random.randint(0, 10000)
        opt = [random.choice([3, 1]), random.choice([0, 5, 45])]
        prefix_chars.extend([
            (rand_val & 255 & 170) | (opt[0] & 85),
            (rand_val & 255 & 85) | (opt[0] & 170),
            ((rand_val >> 8) & 255 & 170) | (opt[1] & 85),
            ((rand_val >> 8) & 255 & 85) | (opt[1] & 170),
        ])
    prefix = bytes(prefix_chars).decode('latin-1', errors='replace')

    final = prefix + rc4_str
    return _raw_encode(final.encode('latin-1', errors='replace'), SHIFT_S4)


def abogus_url(params: str, ua: str) -> str:
    """Return 'params&a_bogus=xxx' format."""
    sig = abogus_sign(params, ua)
    return f"{params}&a_bogus={sig}"


__all__ = ["abogus_sign", "abogus_url"]
