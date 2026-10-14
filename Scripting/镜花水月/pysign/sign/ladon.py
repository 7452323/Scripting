"""
X-Ladon。

本模块有两条路线，**不要混用**：

1. ``make_x_ladon`` —— 抖音（aid=1128）形态，**已用真机向量验证**。
   算法出处：huaerxiela/douyin-algorithm 的 ``ladon.cpp``（作者基于
   douyin_23.2.0_arm64 逆向）。该仓库 ``main.cpp`` 的 ``test_ladon()`` 里
   带着一条真机向量：

       khronos = 1670385975, random_num = 0x4ec5e0ea
       -> "6uDFTgAFgHqrawu7xugc8VuWS16SZJGK7nl6eXPoq7EltIrf"

   本实现逐字节复现该向量（见 tests/test_ladon.py::test_real_device_vector）。

2. ``make_x_ladon_legacy_tiktok`` —— armxe/tiktok-api 的 TikTok 形态
   （app_id=1233），**无任何真机样本，未验证**。仅作为历史实现保留。

形态差异：
  - 抖音：``base64(4 字节 random LE ‖ 密文)``，明文 ``"{khronos}-{license_id}-{aid}"``，
    密钥 = ``md5(random(4B LE) ‖ b"1128")`` 的 32 字符 hex。
  - TikTok(armxe)：48 字符，密钥来自 md5 原始 16 字节拆 4 个 u32。

⚠️ 纯算的边界：``random_num`` 在真机上由 ``libcms.so`` 产出，纯 Python 无法复现。
   本模块把它作为**入参**暴露；不传则本地随机（此时格式合法但与真机同请求取值不同）。
   给定 random_num 与 khronos，签名值本身是完全可复现的。
"""

import base64
import binascii
import hashlib
import random
import struct

from .native import validate, validate_32

M64 = 0xFFFFFFFFFFFFFFFF
ROUNDS = 0x22
DEFAULT_AID = 1128
DEFAULT_LICENSE_ID = 1588093228


# --- 抖音形态（已验证） ---------------------------------------------------

def _ror64(value: int, count: int) -> int:
    count &= 63
    return ((value >> count) | (value << (64 - count))) & M64


def _get_u64le(buf, index: int) -> int:
    return struct.unpack_from("<Q", buf, index * 8)[0]


def _set_u64le(buf: bytearray, index: int, value: int) -> None:
    struct.pack_into("<Q", buf, index * 8, value & M64)


def _padding_size(size: int) -> int:
    """向上取整到 16 的倍数（已对齐则不加块）。"""
    mod = size % 16
    return size + (16 - mod) if mod else size


def _pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    pad = block - (len(data) % block)
    return data + bytes([pad]) * pad


def _build_hash_table(md5_hex: str) -> bytearray:
    """由 md5 hex 串生成 34 个 u64 轮密钥（``ladon.cpp`` encrypt_ladon 前半段）。"""
    table = bytearray(288)
    table[0:32] = md5_hex.encode()
    queue = [_get_u64le(table, i) for i in range(4)]
    b0 = queue.pop(0)
    b8 = queue.pop(0)
    for i in range(ROUNDS):
        x9 = b0
        x8 = b8
        x8 = (_ror64(x8, 8) + x9) & M64
        x8 ^= i
        queue.append(x8)
        x8 ^= _ror64(x9, 61)
        _set_u64le(table, i + 1, x8)
        b0 = x8
        b8 = queue.pop(0)
    return table


def _encrypt_block(table, data0: int, data1: int):
    """XXTEA 变体，34 轮（``ladon.cpp`` encrypt_ladon_input）。"""
    for i in range(ROUNDS):
        h = _get_u64le(table, i)
        data1 = h ^ ((data0 + _ror64(data1, 8)) & M64)
        data0 = data1 ^ _ror64(data0, 0x3D)
    return data0, data1


def make_x_ladon(
    khronos: int,
    random_num=None,
    aid: int = DEFAULT_AID,
    license_id: int = DEFAULT_LICENSE_ID,
) -> str:
    """
    生成抖音形态 X-Ladon。

    Args:
        khronos:     Unix 时间戳（秒），与 X-Khronos 同源
        random_num:  32 位随机数；真机由 libcms.so 产出，纯算无法复现。
                     None 则本地随机。
        aid:         App id，抖音为 1128
        license_id:  固定常量 1588093228

    Returns:
        base64(4 字节 random LE ‖ 密文)

    Verified:
        make_x_ladon(1670385975, 0x4EC5E0EA)
        == "6uDFTgAFgHqrawu7xugc8VuWS16SZJGK7nl6eXPoq7EltIrf"
    """
    if random_num is None:
        random_num = random.randint(0, 0xFFFFFFFF)
    random_num &= 0xFFFFFFFF

    data = ("%u-%u-%u" % (khronos, license_id, aid)).encode()

    keygen = bytearray(8)
    keygen[4:8] = str(aid).encode()[:4].ljust(4, b"\x00")
    keygen[0:4] = struct.pack("<I", random_num)
    md5_hex = hashlib.md5(bytes(keygen)).hexdigest()

    table = _build_hash_table(md5_hex)

    buf = _pkcs7_pad(data, 16)
    out = bytearray()
    for blk in range(len(buf) // 16):
        d0 = _get_u64le(buf, blk * 2)
        d1 = _get_u64le(buf, blk * 2 + 1)
        d0, d1 = _encrypt_block(table, d0, d1)
        out += struct.pack("<Q", d0) + struct.pack("<Q", d1)

    return base64.b64encode(struct.pack("<I", random_num) + bytes(out)).decode()


def make_x_ladon_headers(khronos=None, random_num=None,
                         aid: int = DEFAULT_AID,
                         license_id: int = DEFAULT_LICENSE_ID):
    """便捷封装：返回 ``{"X-Ladon": ..., "X-Khronos": ...}``。"""
    import time as _time
    if khronos is None:
        khronos = int(_time.time())
    return {
        "X-Ladon": make_x_ladon(khronos, random_num, aid, license_id),
        # ★ X-Khronos 是**十进制**秒级时间戳（真机样本 "1791343486"）；
        #   历史实现这里写的是 hex(ts)，会让服务端判为过期请求。
        "X-Khronos": str(int(khronos)),
    }


# --- 抖音 38.7.0 形态（闭式已还原，27/27 真机样本逐字节命中） -------------

LADON387_TOP = 0xEC          # 第 1 字节恒定
LADON387_XOR_B1 = 0x6E       # 第 2 字节 = ((kh>>12)&0xFF) ^ 0x6E
LADON387_XOR_HI = 0x5        # 第 3 字节高 4 位 = ((kh>>8)&0xF) ^ 0x5
LADON387_MASK12 = 0x7FE      # 低 12 位 = (0x7FE - 16*(kh&0xFF)) & 0xFFF


def ladon_be_387(khronos: int) -> int:
    """38.7.0 的 X-Ladon 四字节按**大端**读成的 32 位整数。

    闭式::

        BE = 0xEC000000
           | ((((kh >> 12) & 0xFF) ^ 0x6E) << 16)
           | ((((kh >> 8) & 0xF) ^ 0x5) << 12)
           | ((0x7FE - 16 * (kh & 0xFF)) & 0xFFF)

    等价写法 ``BE = 4096*m - 16*kh + 0x7FE``（m 由上式展开得出）。
    """
    kh = khronos & 0xFFFFFFFF
    return (
        (LADON387_TOP << 24)
        | ((((kh >> 12) & 0xFF) ^ LADON387_XOR_B1) << 16)
        | ((((kh >> 8) & 0xF) ^ LADON387_XOR_HI) << 12)
        | ((LADON387_MASK12 - 16 * (kh & 0xFF)) & 0xFFF)
    )


def make_x_ladon_387(khronos: int) -> str:
    """
    生成抖音 38.7.0 的 X-Ladon：``base64(BE 的 4 个大端字节)``（8 字符）。

    已用 ``tests/data/perseus387_headers24.json`` 的 27 条真机样本逐字节验证
    （27/27）。

    ⚠️ **适用范围**：仅「新进程内**首次**签名」。同进程连签时 X-Ladon 会在真值 /
    退化值 ``00000480`` 之间交替（见 ``docs/x-perseus-attack.md`` §70），
    本闭式**不建模**该进程内状态维度。
    """
    return base64.b64encode(ladon_be_387(khronos).to_bytes(4, "big")).decode()


# --- TikTok/armxe 旧版（未验证，仅保留） ----------------------------------

def _ladon_calculation(x9: int, x8: int, x22: int):
    """Ladon internal calculation (armxe)."""
    r_shifted = _ror64(x8, 8)
    r_res = ((r_shifted + x9) ^ x22) & M64
    l_value_shifted = ((x9 >> (32 + 29)) | (x9 << 3)) & M64
    l_res = l_value_shifted ^ r_res
    return r_res, l_res


def get_ladon_keys(app_id: bytes) -> list:
    """
    armxe/tiktok-api 的密钥编排：每 4 字节先经 ``binascii.hexlify`` 变成 8 个
    ASCII 字节，再按 little-endian 读成整数。少了这一步同一 head 下输出就不同。

    ⚠️ 忠于原文，**不代表正确** —— 原文自己也没有样本。
    """
    md5_1 = int.from_bytes(binascii.hexlify(app_id[0:4]), byteorder="little")
    md5_2 = int.from_bytes(binascii.hexlify(app_id[4:8]), byteorder="little")
    md5_3 = int.from_bytes(binascii.hexlify(app_id[8:12]), byteorder="little")
    md5_4 = int.from_bytes(binascii.hexlify(app_id[12:16]), byteorder="little")

    R0_list = [md5_2, md5_3, md5_4]
    L0_list = [md5_1]

    for i in range(33):
        l_val, r_val = _ladon_calculation(L0_list[i], R0_list[i], i)
        L0_list.append(validate(r_val))
        R0_list.append(validate(l_val))

    return L0_list


def encode_ladon(keys: list, da7c: int, da84: int, da88: int, da8c: int):
    """armxe 的 32 位寄存器 + 进位模拟。"""
    for key in keys:
        da70 = validate_32(da84 >> 8)
        da94 = validate_32(da88 << 0x18)
        da70 = validate_32(da70 | da94)
        da94 = validate_32(da8c + da70)

        da70 = 0 if da70 < da94 else 1

        da84 = validate_32(da84 << 0x18)
        da88 = validate_32(da88 >> 8)
        da84 = validate_32(da88 | da84)
        da84 = validate_32(da84 + da7c)
        da70 = validate_32(da70 + da84)

        da84 = validate_32(key & 0xFFFFFFFF)
        da84 = validate_32(da94 ^ da84)
        da88 = validate_32(key >> 32)
        da90 = validate_32(da8c << 3)
        da94 = validate_32(da7c >> 0x1D)
        da90 = validate_32(da90 | da94)
        da90 = validate_32(da90 ^ da84)
        da88 = validate_32(da88 ^ da70)
        da70 = validate_32(da8c >> 0x1D)
        da7c = validate_32(da7c << 3)
        da70 = validate_32(da70 | da7c)
        da7c = validate_32(da70 ^ da88)
        da8c = validate_32(da90 | 0x0)

    first = da8c.to_bytes(4, byteorder="little") + da7c.to_bytes(4, byteorder="little")
    second = da84.to_bytes(4, byteorder="little") + da88.to_bytes(4, byteorder="little")
    return first, second


def make_x_ladon_legacy_tiktok(app_id: int, license_id: int, ts: int) -> str:
    """
    ⚠️ **未验证**：armxe/tiktok-api 的 TikTok 形态（48 字符）。

    公开资料里没有真机抓包能证明这条路线正确。番茄/红果要用 sign/helios.py
    的 SPECK-128/256 形态；抖音要用本模块的 ``make_x_ladon``。
    """
    signature = f"{ts}-{license_id}-{app_id}".encode("utf-8")
    fill = 32 - len(signature)

    buffer = list(signature)
    for _ in range(fill):
        buffer.append(fill)

    random_bytes = random.randint(0, 0x7FFFFFFF).to_bytes(4, byteorder="little")
    app_id_encoded = hashlib.md5(random_bytes + str(app_id).encode("utf-8")).digest()
    key_list = get_ladon_keys(app_id=app_id_encoded)

    f1, s1 = encode_ladon(
        key_list,
        int.from_bytes(buffer[4:8], byteorder="little"),
        int.from_bytes(buffer[8:12], byteorder="little"),
        int.from_bytes(buffer[12:16], byteorder="little"),
        int.from_bytes(buffer[0:4], byteorder="little"),
    )
    encoded = f1 + s1

    f2, s2 = encode_ladon(
        key_list,
        int.from_bytes(buffer[20:24], byteorder="little"),
        int.from_bytes(buffer[24:28], byteorder="little"),
        int.from_bytes(buffer[28:32], byteorder="little"),
        int.from_bytes(buffer[16:20], byteorder="little"),
    )
    encoded = encoded + f2 + s2

    return base64.b64encode(random_bytes + encoded).decode()
