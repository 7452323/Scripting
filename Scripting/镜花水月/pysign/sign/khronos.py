"""
X-Khronos generation.

``X-Khronos`` 是**秒级 Unix 时间戳的十进制字符串**（与请求 URL 里的 ``ts=`` 同值）。

真机证据（本仓库自带样本）::

    tests/data/perseus387_headers.json
        "X-Khronos": "1791343486"                      # ← 十进制，不是 hex
        "X-Argus"  : "frvFag=="  → base64 解码 7e bb c5 6a
                                   = LE u32 0x6AC5BB7E = 1791343486   ✅ 同一次请求

38.7.0 的 ``X-Argus`` 就是 ``base64(LE_u32(X-Khronos))``，所以这里一旦返回 hex，
下游（Argus 387 / Ladon 387 / 重放窗口）全部会跟着错 —— 必须十进制。

历史 bug：早期版本返回 ``hex(ts)[2:]``（形如 `6ac99771`），会让服务端把请求判为过期。
"""

import time

__all__ = ["make_x_khronos"]


def make_x_khronos(ts=None) -> str:
    """生成 X-Khronos 头值（十进制秒级时间戳）。

    Args:
        ts: 可选的秒级时间戳（int / float / 十进制字符串）；缺省取当前时间。

    Returns:
        十进制字符串，例如 ``"1791343486"``
    """
    if ts is None:
        ts = time.time()
    return str(int(ts))
