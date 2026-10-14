"""
SIMON-128/256 block cipher.

两套入口，**输出等价、字序约定不同**：

1. ``SIMON.encode(pt, k)`` / ``SIMON.decode(ct, k)`` —— 教科书 SIMON 约定：
   轮函数 ``x_{i+1} = y_i XOR f(x_i) XOR k_i``，``f`` 作用在**左字**。
   已对齐官方 Appendix B 向量（见 tests/test_gorgon_argus_unverified.py）。

2. ``simon_enc(pt, k)`` / ``simon_dec(ct, k)`` —— 抖音真机 ``libcms.so``
   的约定，逐行复刻 huaerxiela/douyin-algorithm 的 ``crypto/simon.c``
   （作者基于 douyin_23.2.0_arm64 逆向）。**X-Argus 走这一套。**
   与 (1) 的关系：``simon_enc(pt, k) == SIMON().encode([pt[1], pt[0]], k)[::-1]``
   （已实测等价）。

   该 C 实现里另有一个 ``ssimon`` 变体，轮函数用 ``ROTL(x,1) ^ ROTL(x,8)``
   代替 ``&`` —— 抖音两套都在用，故一并实现为 ``ssimon=True``。

   注意 ``simon.c`` 的密钥编排写作
   ``key[i] = ~key[i-4] ^ tmp ^ zbit ^ 3``，等价于标准式的
   ``key[i-4] ^ 0xFFFFFFFFFFFFFFFC ^ zbit ^ tmp``（因为 ``~a ^ b == ~(a ^ b)``
   且 ``~3 == 0xFFFFFFFFFFFFFFFC``）。z4 常量 ``0x3DC94C3A046D678B``，LSB-first。
"""

from .native import rotate_left, rotate_right, get_bit, validate

M64 = 0xFFFFFFFFFFFFFFFF
ROUNDS = 72
Z4 = 0x3DC94C3A046D678B


class SIMON(object):
    """
    SIMON-128/256 block cipher（教科书约定，``f`` 作用在左字）。
    Encrypts 128-bit blocks (two 64-bit words) using a 256-bit key (four 64-bit words).
    """

    def encode(self, pt, k, c=0):
        """
        Encrypt a 128-bit block.

        Args:
            pt: list of 2 uint64 values [x, y]
            k:  list of 4 uint64 values [k0, k1, k2, k3] (k0 first, LE word order)
            c:  mode flag (0 = standard, 1 = variant)

        Returns:
            list of 2 uint64 values [x, y]
        """
        key = [0] * 72
        key[0] = k[0]
        key[1] = k[1]
        key[2] = k[2]
        key[3] = k[3]

        key = self.key_expansion(key=key)

        x_i = pt[0]
        x_i1 = pt[1]

        for i in range(72):
            if c == 1:
                f = rotate_left(x_i, 1)
            else:
                f = (rotate_left(x_i, 1) & rotate_left(x_i, 8)) ^ rotate_left(x_i, 2)
            x_i, x_i1 = ((x_i1 ^ f) ^ key[i]) & M64, x_i

        return [x_i, x_i1]

    def decode(self, ct, k, c=0):
        """
        Decrypt a 128-bit block（``encode`` 的逆）。

        Args:
            ct: list of 2 uint64 values
            k:  list of 4 uint64 values
            c:  mode flag (0 = standard, 1 = variant)

        Returns:
            list of 2 uint64 values
        """
        key = [0] * 72
        key[0] = k[0]
        key[1] = k[1]
        key[2] = k[2]
        key[3] = k[3]
        key = self.key_expansion(key=key)

        x_i = ct[0]
        x_i1 = ct[1]

        for i in range(71, -1, -1):
            if c == 1:
                f = rotate_left(x_i1, 1)
            else:
                f = (rotate_left(x_i1, 1) & rotate_left(x_i1, 8)) ^ rotate_left(x_i1, 2)
            x_i, x_i1 = x_i1, ((x_i ^ f) ^ key[i]) & M64

        return [x_i, x_i1]

    @staticmethod
    def key_expansion(key):
        """
        Expand the 128-bit key (4 words) into 72 round keys.
        """
        tmp = 0
        for i in range(4, 72):
            tmp = rotate_right(key[i - 1], 3)
            tmp = tmp ^ key[i - 3]
            tmp = tmp ^ rotate_right(tmp, 1)
            key[i] = validate((~key[i - 4] & M64) ^ tmp ^ get_bit(Z4, (i - 4) % 62) ^ 3)
        return key


# --- 抖音真机约定（libcms.so / huaerxiela crypto/simon.c） -----------------

def _key_expansion_c(k):
    """``simon.c::key_expansion`` 的逐行复刻。"""
    key = list(k) + [0] * (ROUNDS - 4)
    for i in range(4, ROUNDS):
        tmp = rotate_right(key[i - 1], 3)
        tmp ^= key[i - 3]
        tmp ^= rotate_right(tmp, 1)
        key[i] = validate((~key[i - 4] & M64) ^ tmp ^ get_bit(Z4, (i - 4) % 62) ^ 3)
    return key


def simon_enc(pt, k, ssimon=False):
    """
    ``simon.c::frwd_rnd`` —— 抖音真机加密。

    Args:
        pt: [pt0, pt1]，与 C 里 ``pt[2]`` 同序
        k:  [k0, k1, k2, k3]
        ssimon: True 走 ``ssimon_enc``（f 用 XOR 而非 AND）

    Returns:
        (ct0, ct1)
    """
    key = _key_expansion_c(k)
    x_i, x_i1 = pt[0], pt[1]
    for i in range(ROUNDS):
        tmp = x_i1
        if ssimon:
            f = rotate_left(x_i1, 1) ^ rotate_left(x_i1, 8)
        else:
            f = rotate_left(x_i1, 1) & rotate_left(x_i1, 8)
        x_i1 = x_i ^ f ^ rotate_left(x_i1, 2) ^ key[i]
        x_i = tmp
    return (validate(x_i), validate(x_i1))


def simon_dec(ct, k, ssimon=False):
    """``simon.c::bkwrd_rnd`` —— 抖音真机解密（X-Argus 用）。"""
    key = _key_expansion_c(k)
    x_i, x_i1 = ct[0], ct[1]
    for i in range(ROUNDS - 1, -1, -1):
        tmp = x_i
        if ssimon:
            f = rotate_left(x_i, 1) ^ rotate_left(x_i, 8)
        else:
            f = rotate_left(x_i, 1) & rotate_left(x_i, 8)
        x_i = x_i1 ^ f ^ rotate_left(x_i, 2) ^ key[i]
        x_i1 = tmp
    return (validate(x_i), validate(x_i1))


def ssimon_enc(pt, k):
    """``ssimon_enc``：f 用 XOR 变体。"""
    return simon_enc(pt, k, ssimon=True)


def ssimon_dec(ct, k):
    """``ssimon_dec``：f 用 XOR 变体。"""
    return simon_dec(ct, k, ssimon=True)
