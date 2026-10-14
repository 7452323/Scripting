"""
douyin-sign — TikTok/Douyin All-in-One Signature Package.

Provides sign_all() for header generation and sign_mobile_request()
for end-to-end signed Mobile API calls.
"""

import asyncio
import json
import time
from typing import Optional

from . import khronos
from . import ssstub
from . import gorgon
from . import constants as const
from . import protobuf
from . import native
from . import aes
from . import rc4
from . import simon
from . import dyn_encode
from . import abogus
from .abogus import abogus_sign, abogus_url
from . import websign
from .websign import websign_sign, canonical_query, is_protected
from . import helios
from .helios import PROFILES as HELIOS_PROFILES
from . import soter
from . import medusa
from .medusa import make_x_medusa
from .device import (
    Device, register_device, make_seed_device,
    APP_ID, LICENSE_ID, MSSDK_VER_STR, MSSDK_VER_CODE,
)

MOBILE_API_BASE = "https://api.douyin.com"


def sign_all(method="GET", url="", body=b"", cookies="", device=None,
             helios_profile=None):
    """生成一次请求所需的所有签名头。

    Args:
        method:  HTTP method
        url:     完整请求 URL
        body:    请求体 bytes
        cookies: Cookie 字符串（或 Encoding 字符串）
        device:  Device 对象（传入后用于 X-Argus 等设备指纹签名）
        helios_profile: 传入 ``"fanqie"`` / ``"hongguo"`` / ``"douyin"``
                        时额外生成 X-Helios（SPECK-128/256，见 sign.helios）

    Returns:
        dict of header name -> header value
    """
    headers = {}

    # ★ 同一个时间戳必须贯穿所有签名头：X-Khronos 是**十进制秒**，
    #   38.7.0 的 X-Argus/X-Ladon 都直接由它派生（见 sign/khronos.py 顶部证据）。
    ts = int(time.time())
    headers["X-Khronos"] = khronos.make_x_khronos(ts)

    body_bytes = body if isinstance(body, bytes) else body.encode() if body else b""
    headers["X-SS-STUB"] = ssstub.make_x_ss_stub(body_bytes)

    url_str = url if isinstance(url, str) else url.decode()
    params_bytes = (url_str.split("?", 1)[1].encode() if "?" in url_str else b"")
    cookies_str = cookies if isinstance(cookies, str) else (cookies.decode() if cookies else "")
    cookies_bytes = cookies_str.encode()

    # ts 在函数开头已统一计算（与 X-Khronos 同一个值）
    headers["X-Gorgon"] = gorgon.make_x_gorgon(
        params=params_bytes,
        payload=body_bytes,
        cookies=cookies_bytes,
        ts=ts,
        is_arm64=True,
    )

    # X-Ladon — 抖音形态（aid=1128），**已用真机向量验证**（见 sign/ladon.py）。
    # 番茄/红果要用 sign/helios.py 的 SPECK-128/256 形态。
    try:
        from .ladon import make_x_ladon
        headers["X-Ladon"] = make_x_ladon(khronos=ts, aid=APP_ID)
    except Exception:
        pass  # Ladon 不阻塞主流程

    # X-Helios（SPECK-128/256，按 App 常量）
    if helios_profile:
        try:
            headers["X-Helios"] = helios.sign_profile(ts, helios_profile)
        except Exception:
            pass  # Helios 不阻塞主流程

    # X-Argus（需 device info）
    if device is not None and device.device_id:
        try:
            headers["X-Argus"] = make_x_argus_default(
                params=params_bytes,
                payload=body_bytes,
                ts=ts,
                device=device,
            )
        except Exception:
            pass  # Argus 不阻塞主流程

    return headers


# ---------------------------------------------------------------------------
# 抖音 38.7.0：一站式「版本一致」的完整头集合
#
# 为什么需要它：38.7.0 的头形态与 23.3.0 **不是一套**——
#   X-Argus = base64(LE_u32(khronos))（4 字节，不再是长 protobuf 形态）
#   X-Ladon = 4 字节闭式（不再走 SPECK/长形态）
#   X-Gorgon = "8404" ‖ LE32(F) ‖ Body(20B)（F 是进程内状态量）
# 旧 sign_all() 默认走的是 23.3.0 的那套，拿它去签 38.7.0 的请求头形态就不对了。
# ---------------------------------------------------------------------------

DOUYIN_387_GORGON_F = 0x4A80  # 文档中的 "family C"；也是新进程前 7 次签名的取值


def sign_all_387(
    url="",
    body=b"",
    cookies="",
    khronos=None,
    *,
    gorgon_f=DOUYIN_387_GORGON_F,
    with_argus=True,
    with_ladon=True,
    with_helios=True,
    with_medusa=False,
    helios_aid="douyin",
):
    """一次调用产出**抖音 38.7.0 形态**的完整请求头集合（各头形态互相一致）。

    Args:
        url:      完整请求 URL（签名只吃 ``?`` 之后的 query）
        body:     请求体（bytes/str），进 X-SS-STUB 与 Gorgon 的 ``in[4:8]``
        cookies:  Cookie 字符串（进 Gorgon 的 ``in[8:12]``）
        khronos:  秒级时间戳（缺省当前时间）；**同一次请求所有头共用它**
        gorgon_f: X-Gorgon 的 `F`（38.7.0 的进程内状态量，落在 0x20 网格上）。
                  **它等于签名输出缓冲区地址低 16 位，无法离线预测**（见
                  docs/gorgon387-f-rule-status.md）；默认 ``0x4a80``，与历史
                  oracle 的前 7 次签名一致。真机逐字节复现时需要知道当前的 F。
        with_argus / with_ladon / with_helios: 是否产出对应头（默认全开）
        with_medusa: 是否产出 X-Medusa。**默认关**：当前只有**结构级**封装
                  （``sign/medusa_head.py``），AES_V3 块函数未还原 ⇒ 不是有效签名。
        helios_aid:  ``helios.PROFILES`` 的键（``douyin``/``fanqie``/``hongguo``）

    Returns:
        dict[str, str]；**不包含** ``X-Perseus``（38.7.0 根本不产出该头）与
        ``X-Neptune``（仿真产物，真机语义未知）。
    """
    from .khronos import make_x_khronos
    from .ssstub import make_x_ss_stub
    from . import argus as _argus
    from . import ladon as _ladon
    from . import gorgon as _gorgon
    from . import helios as _helios

    if khronos is None:
        khronos = int(time.time())
    khronos = int(khronos)

    url_str = url if isinstance(url, str) else url.decode()
    query = url_str.split("?", 1)[1] if "?" in url_str else ""
    body_bytes = body if isinstance(body, bytes) else (body.encode() if body else b"")
    cookies_str = cookies if isinstance(cookies, str) else (cookies.decode() if cookies else "")

    headers = {
        "X-Khronos": make_x_khronos(khronos),
        "X-SS-STUB": make_x_ss_stub(body_bytes),
        "X-Gorgon": _gorgon.make_x_gorgon(
            params=query.encode(),
            payload=body_bytes,
            cookies=cookies_str.encode(),
            ts=khronos,
            family387=gorgon_f,
        ),
    }
    if with_argus:
        headers["X-Argus"] = _argus.make_x_argus_387(khronos)
    if with_ladon:
        headers["X-Ladon"] = _ladon.make_x_ladon_387(khronos)
    if with_helios:
        headers["X-Helios"] = _helios.sign_profile(khronos, helios_aid)
    if with_medusa:
        from . import medusa_head as _medusa_head
        headers["X-Medusa"] = _medusa_head.make_x_medusa_387(khronos)
    return headers


def sign_mobile_request(
    method: str = "GET",
    path: str = "",
    body: dict = None,
    device: Optional[Device] = None,
    params: dict = None,
    *,
    return_headers: bool = False,
) -> dict:
    """向 Mobile API 发签名请求。

    使用 ``api.douyin.com``（而非 www.douyin.com/aweme/v1/web/）
    Mobile API 端点。自动算签名、带设备信息、发请求。

    Args:
        method:        HTTP method (GET / POST)
        path:          API 路径，如 ``/aweme/v1/aweme/post/``
        body:          JSON 请求体 dict
        device:        Device 对象（缺省用 seed 设备）
        params:        URL 查询参数 dict
        return_headers: 如果 True，只返回签名头不实际发请求

    Returns:
        返回响应 JSON（dict），或签名头 dict（``return_headers=True``）

    Example:
        >>> result = sign_mobile_request(
        ...     "GET",
        ...     "/aweme/v1/aweme/post/",
        ...     params={"sec_user_id": "MS4wLjAB..."},
        ... )
        >>> result["aweme_list"]
    """
    from ._http import request_json as _request_json

    d = device or make_seed_device()

    # Build full URL
    qs = "&".join(f"{k}={v}" for k, v in (params or {}).items())
    url = f"{MOBILE_API_BASE}{path}"
    if qs:
        url += f"?{qs}"

    # Body
    body_bytes = json.dumps(body, separators=(",", ":")).encode() if body else b""

    # Cookie from device
    cookies_str = d.to_cookie()

    # Sign
    sig_headers = sign_all(
        method=method,
        url=url,
        body=body_bytes,
        cookies=cookies_str,
        device=d,
    )

    if return_headers:
        return sig_headers

    # Real request
    req_headers = {
        **d.to_headers(),
        **sig_headers,
        "Content-Type": "application/json; charset=utf-8",
    }

    resp = _request_json(
        method,
        url,
        headers=req_headers,
        data=body_bytes if method == "POST" else None,
        timeout=30,
    )
    return resp


def make_x_argus_default(
    params: bytes,
    payload: bytes,
    ts: int,
    device: Device,
    sign_key: bytes = None,
    dyn_version: int = 8,
) -> str:
    """用 Device 信息生成 X-Argus（默认参数）。"""
    from .argus import make_x_argus

    return make_x_argus(
        params=params,
        payload=payload,
        ts=ts,
        app_id=APP_ID,
        app_version=device.app_version,
        app_launch_time=int(time.time() * 1000 - 60000),
        device_type=device.device_type,
        sdk_version=MSSDK_VER_STR,
        sdk_version_code=MSSDK_VER_CODE,
        license_id=LICENSE_ID,
        device_id=device.device_id,
        device_token=device.install_id,
        dyn_seed="default",
        dyn_version=dyn_version,
        sign_key=sign_key,
    )


def sign_web_request(
    path: str = "",
    params: dict = None,
    user_agent: str = None,
    cookie: str = "",
    method: str = "GET",
) -> dict:
    """向 Web API 发签名请求（用 X-Bogus）。

    走 ``www.douyin.com/aweme/v1/web/`` 端点，兼容你现在的 API。

    Args:
        path:       API 路径，如 ``/aweme/v1/web/aweme/post/``
        params:     URL 查询参数 dict
        user_agent: 浏览器 UA（缺省用 Chrome 120）
        cookie:     Cookie 字符串
        method:     HTTP method（默认 GET）

    Returns:
        响应 JSON（dict）

    Examples:
        >>> result = sign_web_request(
        ...     "/aweme/v1/web/aweme/post/",
        ...     params={"sec_user_id": "MS4wLjAB...", "count": "6"},
        ... )
        >>> result["aweme_list"]
    """
    from ._http import request_json as _request_json
    from .bogus import sign_full

    if user_agent is None:
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/120.0.0.0"
        )

    qs = "&".join(f"{k}={v}" for k, v in (params or {}).items())
    base_url = f"https://www.douyin.com{path}"

    if qs:
        # sign_full 返回 "params&X-Bogus=xxx"
        signed_part = sign_full(qs, user_agent)
        full_url = f"{base_url}?{signed_part}"
    else:
        full_url = base_url

    headers = {
        "User-Agent": user_agent,
        "Referer": "https://www.douyin.com/",
    }
    if cookie:
        headers["Cookie"] = cookie

    return _request_json(method, full_url, headers=headers, timeout=30)


def sign_web_request_abogus(
    path: str = "",
    params: dict = None,
    user_agent: str = None,
    cookie: str = "",
    method: str = "GET",
    window_env: str = None,
    aid: int = 6383,
    page_id: int = 6241,
) -> dict:
    """向 Web API 发签名请求（用 A-Bogus —— 当前抖音网页端算法）。

    ``sign_web_request()`` 走的是已弃用但仍可用的 X-Bogus；现代抖音网页端
    校验的是 A-Bogus（SM3 双哈希 + RC4 + 变体 base64），所以这条是首选。

    Args:
        path:       API 路径，如 ``/aweme/v1/web/hot/search/list/``
        params:     URL 查询参数 dict
        user_agent: 浏览器 UA（缺省用 Chrome 120）
        cookie:     Cookie 字符串
        method:     HTTP method（默认 GET）
        window_env: 环境指纹串；缺省用标准 Chrome/Win32 指纹
        aid:        App ID，默认 6383（抖音网页版）
        page_id:    Page ID，默认 6241

    Returns:
        响应 JSON（dict）

    Examples:
        >>> result = sign_web_request_abogus(
        ...     "/aweme/v1/web/hot/search/list/",
        ...     params={"detail_list": "1"},
        ... )
        >>> result["status_code"]
        0
    """
    from ._http import request_json as _request_json
    from .abogus import abogus_sign

    if user_agent is None:
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/120.0.0.0"
        )

    qs = "&".join(f"{k}={v}" for k, v in (params or {}).items())
    base_url = f"https://www.douyin.com{path}"
    if qs:
        sig = abogus_sign(
            qs, user_agent, window_env=window_env, aid=aid, page_id=page_id,
        )
        full_url = f"{base_url}?{qs}&a_bogus={sig}"
    else:
        full_url = base_url

    headers = {
        "User-Agent": user_agent,
        "Referer": "https://www.douyin.com/",
    }
    if cookie:
        headers["Cookie"] = cookie

    return _request_json(method, full_url, headers=headers, timeout=30)


__all__ = [
    "sign_all", "sign_all_387", "DOUYIN_387_GORGON_F",
    "sign_mobile_request", "sign_web_request",
    "sign_web_request_abogus",
    "Device", "register_device", "make_seed_device",
    "abogus_sign", "abogus_url",
    "helios", "HELIOS_PROFILES", "soter",
    "medusa", "make_x_medusa",
]
