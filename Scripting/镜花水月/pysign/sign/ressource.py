"""
Shifted base64 + RC4 variant used in Web signing.
"""

import random
import re

from .base import b64_encode, BASE64_CHARS, SHIFTED_BASE64_CHARS


def shift_b64(s: str) -> str:
    """Shift standard base64 to custom alphabet character by character."""
    return re.sub(
        r"[A-Za-z0-9+/=]",
        lambda m: SHIFTED_BASE64_CHARS[
            BASE64_CHARS.index(m.group(0))
        ],
        s,
    )


def rc4_encrypt(key: str, data: str) -> str:
    """RC4 encryption used in Web signing."""
    t = [0] * 256
    for f in range(256):
        t[f] = f

    e = 0
    for h in range(256):
        e = (e + t[h] + ord(key[h % len(key)])) % 256
        a = t[h]
        t[h] = t[e]
        t[e] = a

    c = 0
    e = 0
    n = ""
    for v in range(len(data)):
        c = (c + 1) % 256
        e = (e + t[c]) % 256
        a = t[c]
        t[c] = t[e]
        t[e] = a
        n += chr(ord(data[v]) ^ t[(t[c] + t[e]) % 256])

    return n


def enc_eq(input_str: str) -> str:
    """Encrypt input with RC4 + base64 + shift."""
    rand_char = chr(random.randint(0, 255))
    rc4_enc = rc4_encrypt(rand_char, input_str)
    b64_enc_str = b64_encode(rand_char + rc4_enc)
    return shift_b64(b64_enc_str)
