"""
X-Bogus generation for Douyin/TikTok Web signatures.

Takes user-agent, URL params, cookies. Produces a 20-char alphanumeric string
matching [0-9A-Za-z]{20}. Uses X-Gnarly PRNG via RC4 + shifted base64.
"""

from hashlib import md5
from time import time
import re

from .base import b64_encode, SHIFTED_BASE64_CHARS
from .ressource import rc4_encrypt


class Signer:
    shift_array = "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe"
    magic = 536919696

    @staticmethod
    def md5_2x(string: str) -> str:
        return md5(md5(string.encode()).digest()).hexdigest()

    @staticmethod
    def rc4_encrypt(plaintext: str, key: list) -> str:
        s_box = list(range(256))
        index = 0

        for i in range(256):
            index = (index + s_box[i] + key[i % len(key)]) % 256
            s_box[i], s_box[index] = s_box[index], s_box[i]

        i = 0
        index = 0
        ciphertext = ""

        for char in plaintext:
            i = (i + 1) % 256
            index = (index + s_box[i]) % 256

            s_box[i], s_box[index] = s_box[index], s_box[i]
            keystream = s_box[(s_box[i] + s_box[index]) % 256]
            ciphertext += chr(ord(char) ^ keystream)

        return ciphertext

    @staticmethod
    def b64_encode(string: str, key_table: str = None) -> str:
        if key_table is None:
            key_table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
        last_list = list()
        for i in range(0, len(string), 3):
            try:
                num_1 = ord(string[i])
                num_2 = ord(string[i + 1])
                num_3 = ord(string[i + 2])
                arr_1 = num_1 >> 2
                arr_2 = (3 & num_1) << 4 | (num_2 >> 4)
                arr_3 = ((15 & num_2) << 2) | (num_3 >> 6)
                arr_4 = 63 & num_3

            except IndexError:
                arr_1 = num_1 >> 2
                arr_2 = ((3 & num_1) << 4) | 0
                arr_3 = 64
                arr_4 = 64

            last_list.append(arr_1)
            last_list.append(arr_2)
            last_list.append(arr_3)
            last_list.append(arr_4)

        return "".join([key_table[value] for value in last_list])

    @staticmethod
    def filter(num_list: list) -> list:
        return [
            num_list[x - 1]
            for x in [
                3, 5, 7, 9, 11, 13, 15, 17, 19, 21,
                4, 6, 8, 10, 12, 14, 16, 18, 20,
            ]
        ]

    @staticmethod
    def scramble(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s) -> str:
        return "".join(
            [
                chr(_)
                for _ in [
                    a, k, b, l, c, m, d, n, e, o, f, p, g, q, h, r, i, s, j,
                ]
            ]
        )

    @staticmethod
    def checksum(salt_list: list) -> int:
        checksum = 64
        for x in salt_list[3:]:
            checksum ^= x
        return checksum

    @staticmethod
    def _x_bogus(params: str, user_agent: str, timestamp: int, data: str = "") -> str:
        md5_data = Signer.md5_2x(data)
        md5_params = Signer.md5_2x(params)
        md5_ua = md5(
            Signer.b64_encode(Signer.rc4_encrypt(user_agent, [0, 1, 14])).encode()
        ).hexdigest()

        salt_list = [
            timestamp,
            Signer.magic,
            64,
            0,
            1,
            14,
            bytes.fromhex(md5_params)[-2],
            bytes.fromhex(md5_params)[-1],
            bytes.fromhex(md5_data)[-2],
            bytes.fromhex(md5_data)[-1],
            bytes.fromhex(md5_ua)[-2],
            bytes.fromhex(md5_ua)[-1],
        ]

        salt_list.extend([(timestamp >> i) & 0xFF for i in range(24, -1, -8)])
        salt_list.extend([(salt_list[1] >> i) & 0xFF for i in range(24, -1, -8)])
        salt_list.extend([Signer.checksum(salt_list), 255])

        num_list = Signer.filter(salt_list)
        rc4_num_list = Signer.rc4_encrypt(Signer.scramble(*num_list), [255])

        return Signer.b64_encode(f"\x02\xff{rc4_num_list}", Signer.shift_array)

    @staticmethod
    def sign(params: str, ua: str) -> str:
        return params + "&X-Bogus=" + Signer._x_bogus(params, ua, int(time()))


# Module-level functions for convenience
_x_bogus = Signer._x_bogus


def sign(params: str, user_agent: str, timestamp: int = None) -> str:
    """Generate X-Bogus signature.

    Args:
        params: URL query string
        user_agent: Browser user agent string
        timestamp: Unix timestamp (optional, auto-generated if None)

    Returns:
        The X-Bogus value (shifted base64 string)
    """
    if timestamp is None:
        timestamp = int(time())
    bogus = _x_bogus(params, user_agent, timestamp)
    return bogus


def sign_full(params: str, user_agent: str) -> str:
    """Generate URL params with X-Bogus appended.

    Returns:
        params + &X-Bogus=<value>
    """
    return Signer.sign(params, user_agent)


def verify_bogus(params: str, user_agent: str, bogus: str, timestamp: int = None) -> bool:
    """Verify an X-Bogus signature.

    Args:
        params: URL query string
        user_agent: Browser user agent string
        bogus: The X-Bogus value to verify
        timestamp: Unix timestamp (optional, auto-generated if None)

    Returns:
        True if the bogus string is valid (matches computed value)
    """
    if not bogus:
        return False
    if timestamp is None:
        timestamp = int(time())
    computed = _x_bogus(params, user_agent, timestamp)
    return computed == bogus
