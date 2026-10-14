# -*- coding: utf-8 -*-
"""X-Medusa 头部 20 字节 —— **已逐字节验证**（抖音 23.3.0 oracle）。

结论
----
抖音 X-Medusa 的前 20 字节**不含任何随机量**，它是 X-Khronos 的确定性函数：

    head20 = concat( LE_dword( X-Khronos ^ K[i] ) for i in 0..4 )

    K = [0x00000002, 0x6c956c36, 0x9b5a7235, 0x651dd4e4, 0x2679b8c8]

证据（可复现）
--------------
* 样本：23.3.0 oracle 两次独立 run，共 **20 条**（`base/ts+1/ts+2/rticket/`
  `device_id/iid/uuid/openudid/path/stub/ua/aid` + 8 条同输入重复）。
* 对每条样本算 ``dword[i] ^ X-Khronos``，**20 条样本给出完全相同的 5 个常量**
  —— 跨 run 也相同，说明 K 是全局常量，不是每进程/每次调用派生。
* 同一 run 内 8 条**同输入**样本：逐位置统计，只有 ``0,4,8,12,16``
  （即 5 个 dword 的最低字节）变化，其余 15 字节恒定 —— 与
  ``khronos`` 低位在变、高位不变完全吻合。
* 正文 210 字节（``head20`` 之后）在同输入样本间**全部**变化 → 随机量只存在于正文。

K 常量的出处
------------
把 ``K[1:4]`` 按小端拼成 16 字节得到
``366c956c 35725a9b e4d41d65 c8b87926``，该 16 字节在抖音 23.3.0 的
``libmetasec_ml.so`` 里**逐字节命中**，位于文件偏移 **0x84118**（vaddr 同值），
且处于一片 16 字节条目的常量表之中（邻域含 ``facedead`` 魔术常量）。
38.7.0 的 ``libmetasec_ml.so`` 里搜不到 → 新版已更换该表。

未解决
------
正文 210 字节未破：不是 ``K[1:4]`` 作 AES-128 密钥的 ECB/CBC（已试 4 种偏移 ×
3 种模式，全部不产生「同输入样本明文一致」）。详见 ``docs/x-medusa.md``。
"""
from __future__ import annotations

import struct

# 5 个掩码常量；来源：23.3.0 oracle 20 样本反推 + so 偏移 0x84118 逐字节核对
MEDUSA_HEAD_MASK = (
    0x00000002,
    0x6C956C36,
    0x9B5A7235,
    0x651DD4E4,
    0x2679B8C8,
)

#: so 里那张 16 字节常量表的文件偏移（抖音 23.3.0 `libmetasec_ml.so`）
MEDUSA_KEY_TABLE_OFFSET = 0x84118


def medusa_head(khronos: int) -> bytes:
    """由 X-Khronos 生成 X-Medusa 的前 20 字节。

    >>> medusa_head(1791305413).hex()
    'c726c56af34a5006f0549ff121f2d80f0d9ebc4c'
    """
    return b"".join(
        struct.pack("<I", (khronos & 0xFFFFFFFF) ^ k) for k in MEDUSA_HEAD_MASK
    )


def medusa_key16() -> bytes:
    """``K[1:4]`` 小端拼出的 16 字节 —— 即 so 偏移 0x84118 处那张表的内容。"""
    return b"".join(struct.pack("<I", k) for k in MEDUSA_HEAD_MASK[1:])


if __name__ == "__main__":
    # 自检：与 oracle 样本逐字节对拍
    samples = [
        (1791305413, "c726c56af34a5006f0549ff121f2d80f0d9ebc4c"),
        (1791305414, "c426c56af04a5006f3549ff122f2d80f0e9ebc4c"),
        (1791305415, "c526c56af14a5006f2549ff123f2d80f0f9ebc4c"),
        (1791305416, "ca26c56afe4a5006fd549ff12cf2d80f009ebc4c"),
        (1791305417, "cb26c56aff4a5006fc549ff12df2d80f019ebc4c"),
        (1791305418, "c826c56afc4a5006ff549ff12ef2d80f029ebc4c"),
        (1791305419, "c926c56afd4a5006fe549ff12ff2d80f039ebc4c"),
        (1791305420, "ce26c56afa4a5006f9549ff128f2d80f049ebc4c"),
        (1791305890, "a028c56a94445006975a9ff146fcd80f6a90bc4c"),
        (1791305891, "a128c56a95445006965a9ff147fcd80f6b90bc4c"),
        (1791305892, "a628c56a92445006915a9ff140fcd80f6c90bc4c"),
        (1791305893, "a728c56a93445006905a9ff141fcd80f6d90bc4c"),
        (1791305894, "a428c56a90445006935a9ff142fcd80f6e90bc4c"),
        (1791305895, "a528c56a91445006925a9ff143fcd80f6f90bc4c"),
    ]
    bad = [(k, medusa_head(k).hex(), want) for k, want in samples
           if medusa_head(k).hex() != want]
    print(f"{len(samples) - len(bad)}/{len(samples)} 命中")
    for b in bad:
        print("  MISS", b)
    print("key16 =", medusa_key16().hex())


# ── 38.7.0 变体（抖音 29.1.0 / libmetasec_ml.so 38.7.0）────────────────
# 实测两样本交叉验证：A^B == 0x000002A1 == (1791343486 ^ 1791343071) 的低 16 位
MEDUSA_HEAD_MASK_387 = (
    0x00000005,  # 极小常量（23.3.0 为 2，疑为头部版本/长度计数器）
    0xCA4F4B2D,
    0x430D7549,
    0x2CAEB53F,
    0x56CC6D22,
)


def medusa_head387(khronos: int) -> bytes:
    """38.7.0: ``head20 = 5 x LE_dword(X-Khronos ^ K[i])``。

    与 :func:`medusa_head` 同构，仅常量表不同。
    验证：两独立样本（Khronos 1791343486 / 1791343071）逐字节命中。
    """
    return b"".join(struct.pack("<I", (khronos & 0xFFFFFFFF) ^ k)
                    for k in MEDUSA_HEAD_MASK_387)


MEDUSA_HEAD_387_VECTORS = [
    (1791343486, "7bbbc56a53f08aa037cec829410e6b465cd6093c"),
    (1791343071, "dab9c56af2f28aa096ccc829e00c6b46fdd4093c"),
]  # (X-Khronos, head20 hex)


# ── 38.7.0 body 封套（本轮结构定界结果）──────────────────────────────
#
# 实测两条真值（perseus387_headers.json，ctrl 799B / ioreq 801B）:
#
#   X-Medusa = base64( head20(20B) ‖ body )
#   body     = seg2(2B) ‖ payload
#   payload  = 00 01 ‖ <高熵随机> ‖ [X(4B)][X(4B)][Y(2B)]
#
# 依据:
#   * body[2:4] 恒为 00 01（两样本一致；799 字节里同时出现的概率 ~1/65536²）
#   * 尾部恒定「同一 4 字节连续两次 + 2 字节」，重复值每次不同
#   * payload 去掉上述固定部分后：199 个 dword 全部唯一、无周期、
#     六种简单变换均不露结构 ⇒ 高熵随机
#
# ⚠️ 随机段的**具体取值**来自 native 侧 PRNG（so 导入 rand/srand），
#    纯 Python 无法复现同一次输出；本函数按**已观测的封套**生成，
#    形状与长度合法，但未在服务端验证过（文档如实标注）。
import os as _os

MEDUSA_BODY_PREFIX_387 = b"\x00\x01"
MEDUSA_PAYLOAD_LEN_387 = 797  # 观测值：797（ctrl）/ 799（ioreq）
# ⚠️ 长度**不是固定值**。3 次连签 run 共 17 次观测：总长 812–827（payload 790–805），
#    跨度 15 字节。本常量只是**生成器默认参数**，不要当成真机固定长度。见 §72。


def make_x_medusa_387(khronos: int, seg2: bytes | None = None,
                      payload_len: int = MEDUSA_PAYLOAD_LEN_387,
                      rand: bytes | None = None,
                      tail: bytes | None = None) -> str:
    """按 38.7.0 已观测封套生成 X-Medusa（base64）。

    Args:
        khronos:     X-Khronos（与头部其它字段同源）
        seg2:        2 字节段；None 则随机
        payload_len: payload 总长（含固定前缀与尾部），默认 797
        rand:        中间高熵随机段；None 则 ``os.urandom``
        tail:        尾部 10 字节；None 则按 ``[X(4B)][X(4B)][Y(2B)]`` 随机生成。
                     显式传入时必须是 10 字节且 ``t[0:4] == t[4:8]``。

    Returns:
        base64(head20 ‖ seg2 ‖ 00 01 ‖ rand ‖ tail)

    Note:
        只显式给 ``seg2``/``rand`` 时输出**仍不确定**（尾部每次随机）。
        要完全可复现，三个可变段都要显式给。
    """
    import base64 as _b64

    if seg2 is None:
        seg2 = _os.urandom(2)
    if len(seg2) != 2:
        raise ValueError("seg2 必须为 2 字节")

    if tail is None:
        tail_x = _os.urandom(4)
        tail = tail_x + tail_x + _os.urandom(2)
    else:
        if len(tail) != 10:
            raise ValueError("tail 必须为 10 字节")
        if tail[0:4] != tail[4:8]:
            raise ValueError("tail 必须满足 t[0:4] == t[4:8]")

    mid_len = payload_len - len(MEDUSA_BODY_PREFIX_387) - len(tail)
    if mid_len < 0:
        raise ValueError("payload_len 太小")
    mid = rand if rand is not None else _os.urandom(mid_len)
    if len(mid) != mid_len:
        raise ValueError(f"rand 长度应为 {mid_len}，实际 {len(mid)}")

    payload = MEDUSA_BODY_PREFIX_387 + mid + tail
    raw = medusa_head387(khronos) + seg2 + payload
    return _b64.b64encode(raw).decode()


if __name__ == "__main__387":
    ok = sum(1 for k, w in MEDUSA_HEAD_387_VECTORS if medusa_head387(k).hex() == w)
    print(f"38.7.0 head20: {ok}/{len(MEDUSA_HEAD_387_VECTORS)}")
    v = make_x_medusa_387(1791343486)
    import base64 as _b
    raw = _b.b64decode(v)
    print(f"生成样例: {len(v)} 字符 -> {len(raw)}B")
    print(f"  head20  = {raw[:20].hex()}")
    print(f"  seg2    = {raw[20:22].hex()}")
    print(f"  payload = {raw[22:26].hex()} ... {raw[-10:].hex()}")
    print(f"  长度对齐观测: {len(raw)} vs ctrl 819 / ioreq 821")
