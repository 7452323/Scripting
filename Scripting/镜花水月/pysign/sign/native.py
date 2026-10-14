"""
ARM bit manipulation utilities.
Direct translation from armxe helpers/native.py.
All functions handle 32-bit unsigned arithmetic (masked to 0xFFFFFFFF or 0xFFFFFFFFFFFFFFFF).
"""


def LSRS(x: int, v: int) -> int:
    """Logical Shift Right Signed (32-bit)"""
    return (x >> v) & 0xFFFFFFFF


def LSLS(x: int, v: int) -> int:
    """Logical Shift Left Signed (32-bit)"""
    return (x << v) & 0xFFFFFFFF


def UBFX(x: int, v: int) -> int:
    """Unsigned Bit Field Extract (32-bit): extract v bits starting at 0"""
    return (x & ((1 << v) - 1)) & 0xFFFFFFFF


def UTFX(x: int, v: int) -> int:
    """Unsigned type extension placeholder"""
    return x & 0xFFFFFFFF


def ADDS(x: int, y: int) -> int:
    """Add (32-bit)"""
    return (x + y) & 0xFFFFFFFF


def ADC(x: int, y: int) -> int:
    """Add with Carry (32-bit)"""
    return (x + y) & 0xFFFFFFFF


def ADCS(x: int, y: int) -> int:
    """Add with Carry Signed (32-bit)"""
    return (x + y) & 0xFFFFFFFF


def EORS(x: int, y: int) -> int:
    """Exclusive OR (32-bit)"""
    return (x ^ y) & 0xFFFFFFFF


def ANDS(x: int, y: int) -> int:
    """Bitwise AND (32-bit)"""
    return (x & y) & 0xFFFFFFFF


def ORRS(x: int, y: int) -> int:
    """Bitwise OR (32-bit)"""
    return (x | y) & 0xFFFFFFFF


def RRX(x: int) -> int:
    """Rotate Right with Extend (32-bit) — simplified: rotate right by 1"""
    return ((x >> 1) | ((x & 1) << 31)) & 0xFFFFFFFF


def EOR(x: int, y: int) -> int:
    """Exclusive OR (32-bit)"""
    return (x ^ y) & 0xFFFFFFFF


def check(x: int) -> int:
    """Validate 32-bit unsigned"""
    return x & 0xFFFFFFFF


def toHex(x: int) -> str:
    """Convert to hex string (lowercase, no 0x)"""
    return hex(x & 0xFFFFFFFF)[2:].zfill(8)


def toBinaryString(x: int) -> str:
    """Convert to binary string (32-bit padded)"""
    return bin(x & 0xFFFFFFFF)[2:].zfill(32)


def hex_list(data: list) -> str:
    """Convert list of ints to hex string"""
    return ' '.join(f'{b:02x}' for b in data)


def parseLong(x: int) -> int:
    """Parse/validate as unsigned 32-bit integer"""
    return x & 0xFFFFFFFF


def reverse_bits(x: int) -> int:
    """Reverse bits in a byte (8-bit), result in lower 8 bits"""
    x = ((x & 0x55555555) << 1) | ((x & 0xAAAAAAAA) >> 1)
    x = ((x & 0x33333333) << 2) | ((x & 0xCCCCCCCC) >> 2)
    x = ((x & 0x0F0F0F0F) << 4) | ((x & 0xF0F0F0F0) >> 4)
    return x & 0xFF


def ror(x: int, v: int) -> int:
    """64-bit rotate right"""
    return ((x << (64 - v)) | (x >> v)) & 0xFFFFFFFFFFFFFFFF


def validate(x: int) -> int:
    """Validate 64-bit unsigned"""
    return x & 0xFFFFFFFFFFFFFFFF


def validate_32(x: int) -> int:
    """Validate 32-bit unsigned"""
    return x & 0xFFFFFFFF


def get_bit(val: int, pos: int) -> int:
    """Get bit at position (0-indexed)"""
    return 1 if val & (1 << pos) else 0


def rotate_left(v: int, n: int) -> int:
    """64-bit rotate left"""
    return ((v << n) | (v >> (64 - n))) & 0xFFFFFFFFFFFFFFFF


def rotate_right(v: int, n: int) -> int:
    """64-bit rotate right"""
    return ((v << (64 - n)) | (v >> n)) & 0xFFFFFFFFFFFFFFFF


def reverse_bits_native(n: int, bit_length: int = 32) -> int:
    """Reverse all bits in an integer (up to bit_length)"""
    return int(bin(n)[2:].zfill(bit_length)[::-1], 2)


def bit_swap(value: int) -> int:
    """Single byte bit swap (odd/even bit swap → nibble swap)"""
    odd_bits = value & 0x55
    even_bits = value & 0xAA
    swapped = (odd_bits << 1) | (even_bits >> 1)
    odd_bits = swapped & 0x33
    even_bits = swapped & 0xCC
    result = (odd_bits << 2) | (even_bits >> 2)
    return result


def byteswap_32(val: int) -> int:
    """32-bit byte swap (endian swap)"""
    return (
        ((val & 0xFF000000) >> 24)
        | ((val & 0x00FF0000) >> 8)
        | ((val & 0x0000FF00) << 8)
        | ((val & 0x000000FF) << 24)
    )


def byteswap(b: int) -> int:
    """Single byte nibble swap (high nibble ↔ low nibble)"""
    return ((b & 0xF) << 4) | ((b & 0xF0) >> 4)


def reverse_bytes(hash_bytes: bytes) -> bytes:
    """Reverse nibbles in each byte of input"""
    return bytes([((b & 0xF) << 4) | ((b >> 4) & 0xF) for b in hash_bytes])
