"""
Node.js-compatible base64 encoding.
Uses URL-safe alphabet without padding for some, standard with padding for others.
Also provides shifted base64.
"""


BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
SHIFTED_BASE64_CHARS = "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe"


def node_b64(s: str) -> str:
    """Node.js-compatible base64 encoding (padding with 'A' for incomplete blocks)."""
    i = 0
    base64 = ending = ""
    pad = 3 - len(s) % 3
    if pad != 3:
        s += "A" * pad
        ending += "=" * pad
    while i < len(s):
        b = 0
        for j in range(0, 3, 1):
            n = ord(s[i])
            i += 1
            b += n << 8 * (2 - j)
        base64 += BASE64_CHARS[b >> 18 & 63]
        base64 += BASE64_CHARS[b >> 12 & 63]
        base64 += BASE64_CHARS[b >> 6 & 63]
        base64 += BASE64_CHARS[b & 63]
    if pad != 3:
        base64 = base64[:-pad]
        base64 += ending
    return base64


def reverse_node_b64(base64_str: str) -> str:
    """Reverse of node_b64."""
    s = ''
    pad_count = base64_str.count('=')
    base64_str = base64_str.rstrip('=')
    # Pad back to a multiple of 4
    while len(base64_str) % 4 != 0:
        base64_str += 'A'
    for i in range(0, len(base64_str), 4):
        b = 0
        for j in range(4):
            if i + j < len(base64_str):
                n = BASE64_CHARS.index(base64_str[i + j])
                b += n << 6 * (3 - j)
        s += chr(b >> 16 & 0xFF) + chr(b >> 8 & 0xFF) + chr(b & 0xFF)
    s = s.rstrip('A')
    return s


def b64_encode(string: str, key_table: str = None) -> str:
    """Standard base64 encoding with configurable alphabet."""
    if key_table is None:
        key_table = BASE64_CHARS + "="
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


def shifted_b64_encode(string: str) -> str:
    """Encode with shifted base64 alphabet."""
    return b64_encode(string, SHIFTED_BASE64_CHARS + "=")


def standard_b64_encode(string: str) -> str:
    """Encode with standard base64 alphabet."""
    return b64_encode(string, BASE64_CHARS + "=")
