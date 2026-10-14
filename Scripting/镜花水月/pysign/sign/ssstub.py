"""
X-SS-STUB generation — 请求体的 MD5（App 头用**大写**十六进制）。

证据（三处独立来源一致）::

1. 真实设备抓包（TikTok，aid=1233）::

       body = "account_sdk_source=app&multi_login=1&mix_mode=1&username=76716a7760627637"
       X-SS-STUB: AFAB3892DC07AA8D95D49D68B9FF63CA          # 大写

2. 红果短剧（aid=8662）参考实现：`md5(body).hexdigest().upper()`
3. 番茄小说签名实现：`generate_stub()` 同样 `.upper()`

注意：Gorgon 内部用的是**同一份 MD5 的原始字节**（`bytes.fromhex()` 大小写无关），
所以改大小写不会影响 Gorgon 结果，只影响**发出去的请求头**。
"""

import hashlib
from typing import Union

__all__ = ["make_x_ss_stub", "md5_hex_upper", "md5_hex_lower"]


def md5_hex_upper(data) -> str:
    """MD5 大写十六进制（App 头使用的形式）。"""
    if data is None:
        data = b""
    if isinstance(data, str):
        data = data.encode("utf-8")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        data = bytes(data)
    return hashlib.md5(bytes(data)).hexdigest().upper()


def md5_hex_lower(data) -> str:
    """MD5 小写十六进制（内部计算/旧版兼容）。"""
    return md5_hex_upper(data).lower()


def make_x_ss_stub(body: Union[bytes, str, None] = None, upper: bool = True) -> str:
    """生成 X-SS-STUB 头值。

    Args:
        body:  请求体（bytes / str / None）；空体按空串的 MD5 处理
        upper: 是否大写（App 默认大写，与真机抓包一致）

    Returns:
        32 字符十六进制 MD5
    """
    value = md5_hex_upper(body)
    return value if upper else value.lower()
