# -*- coding: utf-8 -*-
"""X-Medusa 38.7.0（抖音 aid=1128）App 专用常量与 AES_V3 内核。

常量来源：unidbg 运行时 hook `so+0x2a4b38`（`AES_V3::encrypt` 入口）直接 dump。
见 docs/medusa-387-full-structure.md §3。

主密钥 `SIGN_KEY_387` 来源：hook `so+0x2a3d80`（medusa 管线入口）直接抓到
**68 字节**的 `[sign_key ‖ rand_le ‖ sign_key]` slice（`len=68`），
且 `SM3(这 68 字节) == 同 run xmxor 的 32B key` —— 三点闭环（材料 / token 的
rand 字段 / xmxor key）。另有 hook `so+0x2a3ebc` 时的活内存扫描命中同一值，
以及 6/6 个独立 run 的 golden 向量（tests/data/medusa387_keyhash_vectors.json）。
见 docs/medusa387-remaining-constants.md §1.2.1。

静态侧证据（dis.txt）：
  so+0x2a4b38  AES_V3::encrypt(data, key, iv)
     [x1+0xc] = key 长度 ∈ {16,24,32}；[x2+0xc] = iv 长度 == 16
     memset(sp+0x18, 0, 192)              → 192B 密钥表
     key[i] ^= [0x72,0xde,0xb5,0xbb][i%4] → 密钥解密
     S-box @ so+0x11141f（4×256B，word_size 变体）
     init_value = 0xbbb5de72
     PKCS#7 补齐 → bl so+0x2a54cc（块循环）
  so+0x2a3ebc  AES_V3 稀疏层入口（sum_data @0x2a41c4 / mix_columns @0x2a403c）
  so+0x2a525c  第 4 个 word_size 变体（AES key 长度 32）
"""

from __future__ import annotations   # ← 3.9 兼容：注解里的 `int | None` 在 3.9 会运行时求值失败

import os

# --- 运行时 dump 的 App 专用常量（16/16 字节） ---
CONFIG_KEY_387 = bytes.fromhex("d31e3718288a1027baab59f146a09a9c")
CONFIG_IV_387 = bytes.fromhex("ea180a0336ed352fcd24e4d50018ae54")

# --- X-Medusa 签名主密钥（32B）---
# 来源：unidbg hook `so+0x2a3d80`（medusa 管线入口）直接抓到 68B slice
#       `[sign_key ‖ rand_le ‖ sign_key]`（`len=68`，见 KEY_MATERIAL_GOLDEN_387）。
# 验证：`SM3(sign_key ‖ rand_le ‖ sign_key) == xmxor 的 32B key`，
#       6/6 个独立 run 全中（见 tests/data/medusa387_keyhash_vectors.json），
#       另有同 run 的「68B 材料 ↔ token 的 rand 字段 ↔ xmxor key」三点闭环。
# ⚠️ 不等于 constants/current/sign_key.b64（那是 47.1.4 的），
#    也不等于 sign/medusa.py:2130 里那条 —— 两者均已排除，见
#    docs/medusa387-remaining-constants.md §1.4。
# ⚠️ 该 32B 在 so / APK / harness 里都不是明文常量（也不是 72deb5bb 家族
#    混淆态）⇒ 运行期现算，出处仍未定位（见同一文档 §5.4）。
SIGN_KEY_387 = bytes.fromhex(
    "ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c"
)

# 密钥派生：key = SM3(sign_key ‖ rand_le ‖ sign_key)，rand 每请求随机。
# 同源于番茄/红果的 get_key_hash，但 sign_key 是 38.7.0 专用。
KEY_HASH_FORMULA_387 = "SM3(sign_key || rand_le || sign_key)"


# 密钥表解密用的循环 XOR（stride 4），见 so+0x2a4bd4..0x2a4c20
KEY_XOR_387 = bytes([0x72, 0xDE, 0xB5, 0xBB])

# 密钥展开里的 init_value（so+0x2a4c3c/0x2a4c50：0xde72 + 0xbbb5<<16）
INIT_VALUE_387 = 0xBBB5DE72

# 信封版本头：5 个 dword，每项 XOR khronos 后按 LE 写出
# 与公开的番茄 7.2.1 PACKET_PREFIX_MASKS 逐字节相同
VERSION_DWORDS_387 = [
    0x00000005,
    0xCA4F4B2D,
    0x430D7549,
    0x2CAEB53F,
    0x56CC6D22,
]

# 信封标志（抖音同红果：00 01；番茄是 01 02）
PACKET_FLAGS_387 = bytes([0x00, 0x01])

# 第二个缓冲区前缀（红果 0x35、番茄 0x4E）
SECOND_BUFFER_PREFIX_387 = 0xA6

# 头部 8 字节 runtime_property 块：抖音 38.7.0 为全零
# （红果 0x140 / 番茄 0x128 / 抖音 25.0.0 亦为全零）
RUNTIME_PROPERTY_387 = bytes(8)

# ── 稀疏位层运行时参数（hook `so+0x2a403c` / `so+0x2a41c4` 入口直读）──────
# 实测（38.7.0 harness，两个函数各被调用 2 次、参数相同）：
#   x0 = 第二缓冲（**794B**，首字节 0xa6）、x1 = 794、
#   x2 = 一块 256B 暂存（**入口时全零** ⇒ 是输出/中间缓冲，不是 key）、
#   x3 = **31**（qwords）
#
# 覆写长度 = 8 × qwords = **248 字节**（= `SPARSE_OVERWRITE_387`）。
# 证法：把入口缓冲（794B）与**同 run** token 的第二缓冲 `C = raw[25:]`（793B）
# 逐字节比，「最后一个不同的下标」逐 run 变：run A = 242、run B = 246，
# 两次都没有 >= 248 的差异。
# ⇒ 248 是结构长度；某一次 run 的 last-diff 之所以偏小，是因为该 run 的
#   稀疏 key 在那几个字节上恰好全零（约一半字节不含置位）。
# ⚠️ 别把单次 run 的 last-diff 当成覆写边界（本会话早前就踩过：误记成 243）。
#
# ⚠️ 因此 `aes_v3_sparse()` 里 qwords 的默认值（ceil(len/8)）对真实管线
#    **不适用**：真实值是 SPARSE_QWORDS_387 = 31。
# ⚠️ `key2` 的完整派生链仍未闭环：反解 key 与 `sum_data(data,31)` 在
#    1984 bit 里差 119 bit（散落全 qword/lane，无结构），
#    见 docs/medusa387-remaining-constants.md §5.1。
SPARSE_DATA_LEN_387 = 794              # 稀疏层拿到的第二缓冲长度
SECOND_BUFFER_LEN_387 = 793            # token 里第二缓冲的长度（raw[25:]）

# `so+0x2a3d80` 入口直接抓到的 68B 密钥材料 = sign_key ‖ rand_le32 ‖ sign_key。
# 与 `SM3(...) == 同 run 的 xmxor 32B key` 构成闭环；这是 sign_key 最硬的证据。
# （同一 run：rand_le = b1c27f21，medhook.txt / medhook_mix2.txt 的 key 即其 SM3。）
KEY_MATERIAL_GOLDEN_387 = bytes.fromhex(
    "ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c"
    "b1c27f21"
    "ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c"
)
KEY_MATERIAL_GOLDEN_RAND_387 = 0x217FC2B1
KEY_MATERIAL_GOLDEN_KEY_387 = bytes.fromhex(
    "9f01fc913aa21a21f26dc6b87285027c990b661317d9c1469c880a309d3dfc25"
)


def key_material_387(rand: int) -> bytes:
    """拼出 `so+0x2a3d80` 收到的 68B 密钥材料：`sk ‖ rand_le32 ‖ sk`。

    这就是 SM3 的输入（`get_key_hash_387` 内部的 blob）。
    `key_material_387(KEY_MATERIAL_GOLDEN_RAND_387) == KEY_MATERIAL_GOLDEN_387`。
    """
    if not 0 <= rand <= 0xFFFFFFFF:
        raise ValueError("rand must be a u32")
    return SIGN_KEY_387 + rand.to_bytes(4, "little") + SIGN_KEY_387

_SBOX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "data", "douyin387_sbox.bin")
_SBOX4_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "data", "douyin387_sbox4.bin")


def load_sbox_variant(word_size: int) -> bytes:
    """取 38.7.0 S-box 的第 word_size 个变体（4 份全不同）。

    so+0x11141f 起连续 1024 字节 = 4 × 256B，对应 4 个轮函数变体：

        0 → so+0x11141f (V0, 轮函数 so+0x2a5550)
        1 → so+0x11151f (V1, 轮函数 so+0x2a5bac)
        2 → so+0x11161f (V2, 轮函数 so+0x2a60f8)
        3 → so+0x11171f (V3, 轮函数 so+0x2a662c)

    1024B 全表已入档 `data/douyin387_sbox4.bin`；`data/douyin387_sbox.bin`
    是 variant0 的旧副本。运行期内存里的 4 张表与 .so 静态表逐字节相同
    （已 `cmp` 验证），因此无需在运行期解密。
    """
    if not 0 <= word_size <= 3:
        raise ValueError("word_size must be 0..3")
    with open(_SBOX4_PATH, "rb") as fh:
        data = fh.read()
    return data[word_size * 256:(word_size + 1) * 256]


def version_block_387(khronos: int) -> bytes:
    """信封前 20 字节：5 × LE32(dword ^ khronos)。"""
    return b"".join(
        ((khronos ^ d) & 0xFFFFFFFF).to_bytes(4, "little")
        for d in VERSION_DWORDS_387
    )


def decrypt_key_material(obfuscated: bytes) -> bytes:
    """so+0x2a4be4 的密钥解密：每字节 XOR KEY_XOR_387[i % 4]。"""
    return bytes(b ^ KEY_XOR_387[i % 4] for i, b in enumerate(obfuscated))


# ── 主密钥派生（so+0x2a3ebc 调用方）────────────────────────────────

def get_key_hash_387(sign_key: bytes, rand: int) -> bytes:
    """key = SM3(sign_key ‖ rand_le ‖ sign_key) —— 32B。

    rand 为请求级 4 字节随机数（LE），由信封里的
    `raw[20:22] ‖ raw[-2:]` 还原；每请求变化，故 key 也随之变化。
    （SM3 的输入就是 `so+0x2a3d80` 收到的那个 68B 缓冲，见 `key_material_387`。）
    """
    from .medusa import SM3

    if len(sign_key) != 32:
        raise ValueError("sign_key must be 32 bytes")
    return SM3(sign_key + (rand & 0xFFFFFFFF).to_bytes(4, "little") + sign_key).digest()


def derive_key_387(rand: int) -> bytes:
    """用 38.7.0 内置主密钥派生本次请求的 32B key。"""
    return get_key_hash_387(SIGN_KEY_387, rand)


def rand_from_envelope(raw: bytes) -> int:
    """从完整 X-Medusa 信封还原 rand：LE32(raw[20:22] ‖ raw[-2:])。

    raw[20:22] = rand 低 16 位（信封第 20..21 字节）
    raw[-2:]   = rand 高 16 位（信封最后 2 字节，即 tail）
    两者拼成 4 字节 LE 整数。已对 6 个 harness token 验证。
    """
    if len(raw) < 25:
        raise ValueError("envelope too short")
    return int.from_bytes(raw[20:22] + raw[-2:], "little")


# ── 旋转位道 K 表（(i+K)&7 里的 K 逐项）────────────────────────────
#
# so+0x2a41c4 (sum_data) / so+0x2a403c (mix_columns) 里，源字节的第 b 位
# 落到 qword 的 (r+K_b)&7 号 lane；K_b 是逐位常量，r = i // qwords。
# 这就是「旋转位道 K 表」，逐项如下（索引 = 源位 b，值 = (qword_index, K)）。
K_ROT_TABLE_387 = {
    0: (5, -1),
    1: (0, 6),
    2: (4, 2),
    3: (2, 3),
    4: (6, 1),
    5: (7, 0),
    6: (3, 4),
    7: (1, 5),
}

# 与 sign/aes_v3_bits.BIT_MAP 必须一致（同一份反汇编逐条解码）。
def _check_k_table() -> bool:
    from .aes_v3_bits import BIT_MAP

    return K_ROT_TABLE_387 == BIT_MAP


def rot_lane(bit: int, r: int) -> int:
    """源位 `bit` 在旋转计数 r 下落到 qword 的 lane 号。"""
    return (r + K_ROT_TABLE_387[bit][1]) & 7


# ── AES_V3 轮常量表（从 so+0x2a54cc 逐指令解码）────────────────────
#
# 这三张表在红果移植版里是 4 项数组、按 word_size = khronos & 3 取；
# **38.7.0 的 so 把它们硬编码成了单组值**（反汇编里没有 word_size 分支），
# 且取到的正是红果表的下标 1 项：
#
#   R_CON_387   ← so+0x2a5604..0x2a5630：sub_bytes 同时做列旋转
#                 s[4+i]=S[s[i]] s[12+i]=S[s[4+i]] s[i]=S[s[8+i]] s[8+i]=S[s[12+i]]
#                 ⇒ 新列序 [2,0,3,1] 相对旧列序 [0,1,2,3]，即 c=[1,3,0,2]
#   R_CON2_387  ← so+0x2a5590..0x2a55e4：CBC / add_round_key_con 的逐字节 XOR，
#                 第二个操作数按 4 字节旋转配对 ⇒ x0[j] ^ x1[c[j]]，c=[2,0,3,1]
#   R_ORDERS_387← so+0x2a5638..0x2a569c：16 条 ldrb/strb 对展开的 shift_rows，
#                 模拟后得到 perm[i]（new[i] = old[perm[i]]）
R_CON_387 = [1, 3, 0, 2]
R_CON2_387 = [2, 0, 3, 1]
R_ORDERS_387 = [0, 9, 14, 15, 4, 13, 2, 7, 8, 1, 6, 3, 12, 5, 10, 11]


def expand_key_387(aes_key: bytes) -> bytes:
    """38.7.0 的 AES_V3 密钥展开（so+0x2a4c38..0x2a4ccc）。

    与红果 `AES_V3._expand_key` 同构，但 `init_value` 是**单一常量**
    `0xbbb5de72`（红果是按 word_size 取 4 项表），S-box 取 38.7.0 专属表。
    返回 48 字节：`mk[0:16] = LE32(init_value)×4 ^ aes_key`，`mk[16:48]` 为
    8 轮展开结果。
    """
    if len(aes_key) != 16:
        raise ValueError("aes_key must be 16 bytes")
    sbox = load_sbox_variant(0)
    iv = INIT_VALUE_387
    mk = bytearray(iv.to_bytes(4, "little")) * 4
    mk = bytearray(a ^ b for a, b in zip(mk, aes_key))
    mk += bytearray(32)
    rounds = 8
    for i in range(4, 12):
        idx = 4 * (i - 1)
        k0, k1, k2, k3 = mk[idx], mk[idx + 1], mk[idx + 2], mk[idx + 3]
        if i & 3 == 0:
            k00 = (iv >> (rounds & 24)) ^ sbox[k1]
            k1 = sbox[k2]
            k2 = sbox[k3]
            k3 = sbox[k0]
            k0 = k00 & 0xFF
        rounds += 2
        mk[idx + 4] = k0 ^ mk[idx - 12]
        mk[idx + 5] = k1 ^ mk[idx - 11]
        mk[idx + 6] = k2 ^ mk[idx - 10]
        mk[idx + 7] = k3 ^ mk[idx - 9]
    return bytes(mk)


# harness `-Daeshook` 在 so+0x2a4cd0 抓到的 192B 展开表（前 48B 非零）：
# 用 CONFIG_KEY_387 跑 expand_key_387 必须逐字节等于它 —— 这条同时把
# `INIT_VALUE_387` 和 38.7.0 的 S-box（so+0x11141f +0）一起钉死。
EXPANDED_KEY_GOLDEN_387 = bytes.fromhex(
    "a1c082a35a54a59cc875ec4a347e2f27573998010d6d3d9dc518d1d7f166fef0"
    "f660a7cdfb0d9a503e154b87cf73b577"
)


# ── 长变体的 AES_V3 输入形式（so+0x2a3d80 管线）────────────────────
#
# 38.7.0 与红果 `_gen_medusa` 同构，只有常量不同：
#
#   data = 0xa6(1) ‖ xm_rand(4) ‖ check_bit(4) ‖ body ‖ hash_bytes[2:4](2)
#   body = rev( P(8) ‖ xmxor(proto, key) )[i] ^ seed[~i & 3]
#   P    = (0).to_bytes(8, "little")     ← 38.7.0 全零（红果 320 / 番茄 296）
#   seed = tail_hash(hash_bytes[2:4])    ← 38.7.0 用 tail_hash，红果用
#                                          get_key_hash 的第二个返回值
#
# 稀疏层只覆写 data 的前 248 字节（= 31 个 8 字节组，与红果静态
# `mix_columns` 的 31 次循环同宽）；其后原样是明文。
SPARSE_QWORDS_387 = 31
SPARSE_OVERWRITE_387 = 248

# 信封里 K 字节（= key2[-1]）的位置：20(版本头) + 2(hash[:2]) + 2(flags) = 24
ENVELOPE_K_OFFSET_387 = 24


def build_data_387(xm_rand: int, check_bit: int, xmxor_out: bytes,
                   hash_rand: int) -> bytes:
    """拼出 38.7.0 长变体交给 AES_V3 的 `data`（§4，全部字段已验证）。"""
    seed = _tail_hash_387((hash_rand >> 16).to_bytes(2, "little"))
    stream = seed.to_bytes(4, "big")
    rev = (RUNTIME_PROPERTY_387 + xmxor_out)[::-1]
    body = bytes(b ^ stream[i & 3] for i, b in enumerate(rev))
    return (
        bytes([SECOND_BUFFER_PREFIX_387])
        + (xm_rand & 0xFFFFFFFF).to_bytes(4, "little")
        + (check_bit & 0xFFFFFFFF).to_bytes(4, "little")
        + body
        + (hash_rand >> 16).to_bytes(2, "little")
    )


def _tail_hash_387(tail: bytes) -> int:
    """番茄/红果系 `tail_hash`：周期 4 密钥流的种子（38.7.0 沿用）。"""
    state = 0
    for index, byte in enumerate(tail):
        if index & 1 == 0:
            mixed = ((state << 7) & 0xFFFFFFFF) ^ byte
            mixed ^= state >> 3
            state ^= mixed
        else:
            mixed = ((state << 11) & 0xFFFFFFFF) | byte
            mixed ^= state >> 5
            mixed ^= state
            state = (~mixed) & 0xFFFFFFFF
    return state


# ── AES_V3 稀疏位层（so+0x2a3d80 管线）────────────────────────────────

def aes_v3_sparse(data: bytes, qwords: int | None = None) -> tuple[bytes, bytes]:
    """跑 38.7.0 的 `new() -> sum_data -> mix_columns` 管线。

    返回 (key, mixed)：
      key   = sum_data(data) 的输出（len(data) 个 qword 的状态）
      mixed = mix_columns(data, key) 覆写后的 data

    ⚠️ `qwords` 是 **key 缓冲区容量 // 8**（真机 w1=795 → 99），与 len(data)
    无关；真机 len(data)=31 时 r 恒为 0、qi == i，故默认取「无回绕」。
    旧默认 `ceil(len/8)` 是错的（31B 给 4，逐位只对 139/248）。

    ⚠️ 38.7.0 的位映射是**旋转式**（lane = (r+K)&7），与红果移植版的
    固定位表不同；映射本体与闸门测试见 `sign/aes_v3_bits.py` /
    `tests/test_aes_v3_bits.py`。真机 golden 见
    `tests/data/aes_v3_bits_live_387.json`。
    """
    from .aes_v3_bits import mix_columns, sum_data

    q = qwords if qwords is not None else max(1, len(data))
    key = sum_data(data, q)
    return key, mix_columns(data, key, q)


def aes_v3_sparse_encrypt(data: bytes, qwords: int | None = None) -> bytes:
    """红果移植版的封套形态：`key[-1:] + mixed`（保长 +1 字节）。

    ⚠️ 38.7.0 的返回形态尚未在 so 里逐字节确认（`so+0x2a3d80` 只写了
    `mix_columns` 的输出到调用者的缓冲），此处按红果同源结构给出，
    置信度=推测。
    """
    key, mixed = aes_v3_sparse(data, qwords)
    return key[-1:] + mixed


# ── 稀疏层位道：已解（真入口 so+0x2a4034，2026-10-10 unidbg 单 bit 注入）──────
#
# 公式（**4 组独立实验、0 反例**；探针 1989 / 199 / 329 / 519 条全部逐位命中）::
#
#     out[w8*G + gi] 的 bit KJ[j]  =  in[8*gi + j] 的 bit ((w8 + OFF[j]) & 7)
#
#     KJ  = [1,7,3,6,2,0,4,5]   源字节内位置 j → 输出字节的第几位
#     OFF = [6,5,3,4,2,7,1,0]   K 表（旋转位道）
#     G   = ceil((w1-15)/8) + 1 每位平面扫过的 8 字节组数（实测 24→3、40→5、64→8）
#     r ≡ w8：每扫完一趟（G 组）位平面 +1；正常签名只跑 31 次迭代 ⇒ w8 恒 0（r=0）
#
# **两个必须带的截断条件**（缺了会把被丢弃的位误判为命中）：
#   ① 第 w8 趟只在 ``t = w8*G + gi < n_iter``（真机 `x3` = 31）时才真的发生；
#   ② 序号 ``>= w1`` 的源字节根本不在缓冲里（探针改了也没用）。
#
# 为什么以前没拿到：块的**真入口是 `so+0x2a4034`**（`0x2a403c` 是 ret），
# 而 unidbg 的 `hook_add_new(begin,end)` 是**闭区间** —— 钩子挂 `[0x2a403c, 0x2a4040)`
# 会把 `0x2a4040` 也带进来，于是“循环头 + ret”被误读成“同一块被命中两次”。
# 另外正常签名里 `w8` 永远推不动（一次调用只有 31 次迭代），
# `r≠0` 通道必须把 `w1` 改小逼出回卷（harness `-Dmixforce1=M`）才看得见。
# 证据：`harvest/mpN_natural_r0.txt` / `mpF_force24_r.txt` / `mp40_force40_r.txt` /
# `mp64_force64_r.txt`（复核器 `tools/verify_bit_channel.py`，零依赖）。

SPARSE_KJ_387 = (1, 7, 3, 6, 2, 0, 4, 5)
SPARSE_OFF_387 = (6, 5, 3, 4, 2, 7, 1, 0)


def sparse_groups(w1: int) -> int:
    """`G = ceil((w1-15)/8) + 1`（实测 w1=24→3、40→5、64→8）。

    `w1` = 本次调用的缓冲上界（真机 ≈790 ⇒ G=98）。
    """
    if w1 <= 15:
        return 1
    return (w1 - 15 + 7) // 8 + 1


def sparse_bit_target(in_bit: int, *, groups: int, n_out: int = 31,
                      n_iter: int | None = None, w1: int | None = None):
    """单个**输入 bit** 的去向预测 —— 直接对齐 unidbg `-Dmixprobe` 的观测。

    Returns:
        list[(输出字节序号 t, 输出字节内 bit)]；空列表 = 这一位被丢弃
        （要么越出 `n_out`/`n_iter`，要么源字节序号 ≥ `w1`）。
    """
    byte, q = in_bit // 8, in_bit % 8
    j, gi = byte % 8, byte // 8
    if w1 is not None and byte >= w1:
        return []
    t = ((q - SPARSE_OFF_387[j]) & 7) * groups + gi
    limit = n_out if n_iter is None else min(n_out, n_iter)
    return [(t, SPARSE_KJ_387[j])] if t < limit else []


def sparse_channel_forward(data: bytes, *, n_out: int = 31,
                           w1: int | None = None) -> bytes:
    """稀疏层**正向**映射：`in`（变长）→ `n_out` 字节（1/8 有损采样）。

    逐位按上面的公式填 `out`；`w1` 给定时只取前 `w1` 个源字节，
    `G` 由 `sparse_groups(w1 or len(data))` 推出。
    """
    bound = len(data) if w1 is None else min(w1, len(data))
    groups = sparse_groups(bound)
    out = bytearray(n_out)
    for byte in range(bound):
        j, gi = byte % 8, byte // 8
        lane = SPARSE_KJ_387[j]
        off = SPARSE_OFF_387[j]
        src = data[byte]
        for w8 in range(8):
            t = w8 * groups + gi
            if t >= n_out:
                break
            if (src >> ((w8 + off) & 7)) & 1:
                out[t] |= 1 << lane
    return bytes(out)


def sparse_channel_roundtrip_selfcheck(samples: int = 64) -> bool:
    """自检：正向映射与「按位预测」两路实现必须一致（同源双实现交叉）。"""
    n_out, w1 = 31, 24
    groups = sparse_groups(w1)
    for seed in range(samples):
        data = bytes(((seed * 37 + i * 11) & 0xFF) for i in range(31))
        fwd = sparse_channel_forward(data, n_out=n_out, w1=w1)
        acc = bytearray(n_out)
        for byte in range(min(w1, len(data))):
            for q in range(8):
                if not ((data[byte] >> q) & 1):
                    continue
                for t, lane in sparse_bit_target(byte * 8 + q, groups=groups,
                                                 n_out=n_out, w1=w1):
                    acc[t] |= 1 << lane
        if bytes(acc) != fwd:
            return False
    return True


# ── AES_V3 轮函数变体（so+0x2a5550 / 0x2a5bac / 0x2a60f8 / 0x2a662c）──
#
# 38.7.0 的分组轮不是单一实现，而是 4 个变体，各自带一份 S 盒表和一组
# 置换常量。一次 run 里活跃哪个由运行期状态决定（4 个都实测被调用过；
# 曾判「活跃轮=V3」，已作废）。
#
# 轮的结构（**已逐字节验证**的部分）：
#
#     block → XOR(key0, c) → S(sbox, s_perm) → ShiftRows(order)
#           → copy(copy_perm) → MixColumns(mc_rows) → state
#
# 验证方法：hook 轮函数入口拿 block/48B 轮密钥，hook 轮内 GF 乘法点拿
# MixColumns 的逐字节中间态，再把本实现与真机中间态比对（V0/V2/V3 头部
# 均为唯一解）。
#
# ✅ 轮尾部已闭环（unidbg 直取，4 变体全部逐字节一致）：
#     MixColumns → XOR(k1) → S → ShiftRows → XOR(k2) = 出口状态
# 第二轮**没有** copy / MixColumns —— 与标准 AES 的收尾形态不同。
# 完整两轮实现见 round_2r_387 / ROUND2_GOLDEN_387。
ROUND_VARIANTS_387 = {
    0: {"fn": 0x2A5550, "sbox_off": 0x11141F, "xor_c": (2, 0, 3, 1),
        "s_perm": (2, 0, 3, 1), "sr_order": R_ORDERS_387,
        "copy": (2, 0, 3, 1), "mc_rows": (0, 1, 2, 3)},
    1: {"fn": 0x2A5BAC, "sbox_off": 0x11151F, "xor_c": (1, 3, 2, 0),
        "s_perm": (1, 3, 2, 0),
        "sr_order": [0, 9, 14, 11, 4, 13, 2, 3, 8, 1, 6, 15, 12, 5, 10, 7],
        "copy": (1, 3, 2, 0), "mc_rows": (0, 1, 2, 3)},
    2: {"fn": 0x2A60F8, "sbox_off": 0x11161F, "xor_c": (3, 2, 1, 0),
        "s_perm": (3, 2, 1, 0),
        "sr_order": [0, 9, 14, 3, 4, 13, 2, 15, 8, 1, 6, 11, 12, 5, 10, 7],
        "copy": (3, 2, 1, 0), "mc_rows": (0, 1, 2, 3)},
    3: {"fn": 0x2A662C, "sbox_off": 0x11171F, "xor_c": (2, 3, 1, 0),
        "s_perm": (2, 3, 1, 0),
        "sr_order": [0, 9, 14, 15, 4, 13, 2, 3, 8, 1, 6, 11, 12, 5, 10, 7],
        "copy": (2, 3, 1, 0), "mc_rows": (0, 1, 2, 3)},
}


def _xor_column(block, key, c):
    """add_round_key 的列内旋转形式：out[4i+j] = block[4i+j] ^ key[4i+c[j]]。"""
    return bytes(block[4 * i + j] ^ key[4 * i + c[j]]
                 for i in range(4) for j in range(4))


def _sub_bytes_perm(block, sbox, s_perm):
    """S 盒代换 + 行内置换：逐字节过 S 盒后，按 s_perm 重排每个 4 字节组。"""
    sub = bytes(sbox[b] for b in block)
    return bytes(sub[4 * s_perm[i] + j] for i in range(4) for j in range(4))


def _shift_rows_order(block, order):
    """ShiftRows：new[i] = old[order[i]]。"""
    return bytes(block[order[i]] for i in range(16))


def _copy_perm(block, copy):
    """轮内 copy：每个 4 字节组按 copy 置换。"""
    return bytes(block[4 * k + copy[j]] for k in range(4) for j in range(4))


def _gf_mul2(x):
    return ((x << 1) ^ 0x1B) & 0xFF if x & 0x80 else (x << 1) & 0xFF


def _mix_columns_rows(block, mc_rows=(0, 1, 2, 3)):
    """MixColumns（标准 AES 系数 2/3/1/1）。

    真机写出布局：列 j 的 4 个结果落到 out[j] / out[4+j] / out[8+j] / out[12+j]；
    V3 还额外把结果按 4 字节组做 (1,0,2,3) 置换（V0 不置换）。
    两种形态都已与真机中间态逐字节比对。
    """
    raw = bytearray(16)
    for j in range(4):
        a, b, c, d = block[j], block[4 + j], block[8 + j], block[12 + j]
        m2a, m2b, m2c, m2d = _gf_mul2(a), _gf_mul2(b), _gf_mul2(c), _gf_mul2(d)
        raw[j] = m2a ^ m2b ^ b ^ c ^ d        # 2a^3b^c^d
        raw[4 + j] = a ^ m2b ^ m2c ^ c ^ d    # a^2b^3c^d
        raw[8 + j] = a ^ b ^ m2c ^ m2d ^ d    # a^b^2c^3d
        raw[12 + j] = m2a ^ a ^ b ^ c ^ m2d   # 3a^b^c^2d
    if mc_rows != (0, 1, 2, 3):
        raw = bytearray(_copy_perm(bytes(raw), mc_rows))
    return bytes(raw)


def round_head_387(variant: int, block: bytes, key0: bytes) -> bytes:
    """跑 38.7.0 轮函数的头部（XOR → S → ShiftRows → copy → MixColumns）。

    返回 MixColumns 之后的 16B 状态。这是**已验证**的部分（V0/V2/V3 与
    真机中间态逐字节一致）；整轮（含尾部）尚未闭环。
    """
    spec = ROUND_VARIANTS_387[variant]
    if len(block) != 16 or len(key0) != 16:
        raise ValueError("block/key0 must be 16 bytes")
    state = _xor_column(block, key0, spec["xor_c"])
    state = _sub_bytes_perm(state, load_sbox_variant(variant), spec["s_perm"])
    state = _shift_rows_order(state, spec["sr_order"])
    state = _copy_perm(state, spec["copy"])
    return _mix_columns_rows(state, spec["mc_rows"])


def round_2r_387(variant: int, block: bytes, key48: bytes) -> bytes:
    """完整两轮：XOR(k0) → S → SR → copy → MixColumns → XOR(k1) → S → SR → XOR(k2)。

    与真机 4 个变体逐字节一致（unidbg 直取 48B 轮密钥与入口/出口状态，
    见 ROUND2_GOLDEN_387）。第二轮没有 copy / MixColumns —— 这是与
    标准 AES 不同的收尾形态。
    """
    spec = ROUND_VARIANTS_387[variant]
    if len(block) != 16 or len(key48) != 48:
        raise ValueError("block must be 16 bytes, key48 must be 48 bytes")
    sbox = load_sbox_variant(variant)
    st = _xor_column(block, key48[0:16], spec["xor_c"])
    st = _sub_bytes_perm(st, sbox, spec["s_perm"])
    st = _shift_rows_order(st, spec["sr_order"])
    st = _copy_perm(st, spec["copy"])
    st = _mix_columns_rows(st, spec["mc_rows"])
    st = _xor_column(st, key48[16:32], spec["xor_c"])
    st = _sub_bytes_perm(st, sbox, spec["s_perm"])
    st = _shift_rows_order(st, spec["sr_order"])
    return _xor_column(st, key48[32:48], spec["xor_c"])


# hook 轮入口 / 轮内 GF 乘法点抓到的真机四元组 (block, key0, post_SR, MC_out)；
# key0=None 表示用 expand_key_387(CONFIG_KEY_387)[:16]。
#
# ⚠️ MC_out 的**末字节**是轨迹遗留值（MixColumns 的最后一次写入没落进轨迹，
# 该字节仍是 post_SR 的末字节：V3 的 b8、V0 的 a6 均可对上）。因此测试只断言
# MC_out 的前 15 字节；第 16 字节由本实现给出，真机侧缺证据。
ROUND_HEAD_GOLDEN_387 = {
    3: [
        (bytes.fromhex("4a587be9e7649fd25fb24f9dfcb9c944"),
         bytes.fromhex("1abfcf91e12be8ae730aa1788f016215"),
         bytes.fromhex("7a3d17cd73802b6f243da79453ee9cb8"),
         bytes.fromhex("681c32162f0c8fa3d642eeb496dc3db8")),
        (bytes.fromhex("b25e324cac6b3afc313b4c2a555bcf76"),
         bytes.fromhex("1abfcf91e12be8ae730aa1788f016215"),
         bytes.fromhex("c18fbcc556e5fcdb20edddf14636f825"),
         None),
    ],
    0: [
        (bytes.fromhex("0e511c11e0496f64d8def0f607c729cc"),
         None,
         bytes.fromhex("a23030447023e7a57f131dda933f36a6"),
         bytes.fromhex("79230029f450c67cb782bf74c6cfe4a6")),
    ],
}

# 完整两轮真值：hook so+0x2a5550 / 0x2a5bac / 0x2a60f8 / 0x2a662c 的入口
# (block, 48B 轮密钥) 与出口状态，4 个变体各一组。
ROUND2_GOLDEN_387 = {
    0: (bytes.fromhex("46cdcb775d8ebe2fb7ac7f8e91372a9b"),
        bytes.fromhex("a1c082a35a54a59cc875ec4a347e2f27573998010d6d3d9dc518d1d7f166fef0f660a7cdfb0d9a503e154b87cf73b577"),
        bytes.fromhex("35ba6e066b8ae96d72a2a789939217b2")),
    1: (bytes.fromhex("86d45f90258c3dadcd1fea3bf1dc5dbf"),
        bytes.fromhex("889354cc730773f3e1263a251d2df9488aff1b8cf9f8687f18de525a05f3ab1242143ae8bbec5297a33200cda6c1abdf"),
        bytes.fromhex("8b7ccc9a29684617a56d0a4f562cd74e")),
    2: (bytes.fromhex("daa4d5f10cbdea070346e71d4af63cae"),
        bytes.fromhex("e8e9928a137db5b5815cfc637d573f0e1464ec59071959ec8645a58ffb129a810a2831b20d31685e8b74cdd170665750"),
        bytes.fromhex("12e781250b9d5850bb2141fcc983820f")),
    3: (bytes.fromhex("1ac14b9beffb35b6cb304f83a0cde439"),
        bytes.fromhex("1abfcf91e12be8ae730aa1788f01621521d68393c0fd6b3db3f7ca453cf6a8508568c08a4595abb7f66261f2ca94c9a2"),
        bytes.fromhex("6404ccfaad661fdadb405812553ff1e0")),
}

# ── AES_V3::encrypt 的块循环（2026-10-09 动态取证，见 docs/medusa387-remaining-constants.md §5.2）──
# 结论：CBC + PKCS#7，不是 ECB。取证方式：同 run 内 hook AES 入口拿 (明文, key, iv)，
# 再 hook 轮函数入口拿它在块上的入参 —— 第一块的入参逐字节 == pt1 ^ IV（3/3 run）。
# 两块共用同一份 48B 轮密钥（每调用一次展开），缓冲就地处理：处理第二块时，
# 缓冲前 16B 已是第一块的输出，后 16B 仍是第二块的原始明文。
# ⚠️ 块函数本体在 VMP 内（thunk 到 so+0x176e24），静态不可移植 —— 所以这里只固化
#    「怎么进块函数」（补齐 + 链接），轮函数本体见 round_2r_387。

def pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    """PKCS#7 补齐。真机实现：pad = block - (len % block)，补 pad 个 pad 字节。"""
    pad = block - (len(data) % block)
    return data + bytes([pad]) * pad


def aes_v3_cbc_state(pt: bytes, prev: bytes) -> bytes:
    """CBC 的块前置异或：state = pt ^ prev（第一块的 prev 是 IV）。"""
    if len(pt) != len(prev):
        raise ValueError("pt/prev 长度必须一致")
    return bytes(a ^ b for a, b in zip(pt, prev))


def aes_v3_cbc_chain(data: bytes, iv: bytes, block: int = 16) -> list:
    """返回每块进轮函数前的 state 列表（state_i = pt_i ^ prev_ct_{i-1}）。

    注意：本函数只做「补齐 + 链接」这一层，不含轮函数本体 —— 轮函数用 round_2r_387。
    要拿到最终密文，得把每块 state 依次喂给轮函数组合（本轮只验证了链接层）。
    """
    padded = pkcs7_pad(data, block)
    out, prev = [], iv
    for i in range(0, len(padded), block):
        st = aes_v3_cbc_state(padded[i:i + block], prev)
        out.append(st)
        prev = b"\x00" * block      # 占位：真正的 prev 应是上一块的密文（需轮函数产出）
    return out

