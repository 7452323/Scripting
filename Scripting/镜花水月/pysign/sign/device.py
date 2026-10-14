"""
device — 抖音设备身份管理

负责 device_id / install_id / iid 的注册与导入。
注册本身需签名（鸡生蛋），因此首次注册使用预置 seed 参数。
"""

import asyncio
import json
import os
import random
import string
import time
from typing import Optional

from . import khronos, ssstub, gorgon


# ── 预置 Seed（备用，仅首次注册用） ──────────────────────────
SEED_DEVICE_ID = "7412345678901234567"
SEED_INSTALL_ID = "1234567890123456"
SEED_IID = "1234567890123456"

DEVICE_MODELS = [
    "SM-S928B", "SM-S926B", "SM-S925B", "SM-F946B", "SM-F936B",
    "iPhone15,3", "iPhone15,2", "iPhone16,1",
    "Pixel 9 Pro", "Pixel 8 Pro",
]
DEVICE_BRANDS = ["samsung", "apple", "google"]
OS_VERSIONS = ["33", "34", "35", "36", "17.0", "18.0", "18.2"]
# App versions seen in the wild: 38.x/39.x are the builds the constants were
# originally extracted from, 46.x/47.x are current. The signing constants did
# not move across them (see README "Constants hardening"), so the newest
# version is the sane default.
APP_VERSIONS = ["46.0.42", "47.1.4", "39.5.0", "38.5.0"]

# MSSDK / licence parameters X-Argus has to carry. A mismatch here fails
# silently — the signature looks well-formed and risk control just returns an
# empty result set. `mssdk_ver_code` is the discriminator: it changes when the
# native MSSDK changes, which is also when the static sign key can go stale.
APP_ID = 1233
MSSDK_VER_CODE = 83952160
MSSDK_VER_STR = "v05.01.02-alpha.7-ov-android"
LICENSE_ID = 2142840551

DEVICE_REGISTER_URL = "https://log.snssdk.com/service/2/device_register/"
MOBILE_API_BASE = "https://api.douyin.com"


def _random_hex(length: int) -> str:
    return "".join(random.choices("0123456789abcdef", k=length))

def _random_digits(length: int) -> str:
    return "".join(random.choices("0123456789", k=length))

def _generate_openudid() -> str:
    return _random_hex(16)

def _generate_cdid() -> str:
    return _random_hex(16)

def _generate_clientudid() -> str:
    return _random_hex(20)


class Device:
    """抖音设备身份。

    Attributes:
        device_id:   设备 ID（数字字符串）
        install_id:  安装 ID（数字字符串）
        iid:         IID（数字字符串）
        openudid:    设备 OpenUDID
        cdid:        CDID
        clientudid:  客户端 UDID
        device_type: 设备型号
        os:          操作系统（0=Android, 14=iOS）
        os_version:  OS 版本
        app_version: App 版本
        channel:     渠道
    """

    def __init__(
        self,
        device_id: str,
        install_id: str = "",
        iid: str = "",
        *,
        openudid: str = "",
        cdid: str = "",
        clientudid: str = "",
        device_type: str = "",
        os: int = 0,
        os_version: str = "",
        app_version: str = "",
        channel: str = "",
    ):
        self.device_id = device_id
        self.install_id = install_id or device_id
        self.iid = iid or self.install_id
        self.openudid = openudid or _generate_openudid()
        self.cdid = cdid or _generate_cdid()
        self.clientudid = clientudid or _generate_clientudid()
        self.device_type = device_type or random.choice(DEVICE_MODELS)
        self.os = os
        self.os_version = os_version or random.choice(OS_VERSIONS)
        self.app_version = app_version or random.choice(APP_VERSIONS)
        self.channel = channel or "googleplay"

    def to_cookie(self) -> str:
        """生成请求用的 Cookie 字符串。"""
        parts = [
            f"install_id={self.install_id}",
            f"odin_tt=00000000000000000000000000000000",
            f"sessionid=",
            f"sessionid_ss=",
        ]
        if self.iid:
            parts.append(f"iid={self.iid}")
        return "; ".join(parts)

    def to_headers(self) -> dict:
        """生成设备签名头（供 Mobile API 使用）。"""
        return {
            "User-Agent": self.user_agent,
            "Cookie": self.to_cookie(),
            "X-Requested-With": "com.ss.android.ugc.aweme",
        }

    @property
    def user_agent(self) -> str:
        """生成 App UA。"""
        if self.os == 14:
            return (
                f"Aweme/{self.app_version} (iOS {self.os_version}; "
                f"{self.device_type})"
            )
        return (
            f"com.ss.android.ugc.aweme/{self.app_version} "
            f"(Android {self.os_version}; {self.device_type})"
        )

    def register_payload(self) -> dict:
        """生成注册请求的 JSON 体。"""
        return {
            "device_type": self.device_type,
            "device_platform": "android" if self.os == 0 else "ios",
            "os_version": self.os_version,
            "channel": self.channel,
            "device_brand": random.choice(DEVICE_BRANDS),
            "device_model": self.device_type,
            "openudid": self.openudid,
            "cdid": self.cdid,
            "clientudid": self.clientudid,
            "resolution": "1080*1920",
            "language": "zh-Hans-CN",
            "region": "CN",
            "app_version": self.app_version,
            "app_name": "aweme",
            "aid": "1128",
            "sdk_version": "3.0.0",
            "version_code": "380500",
            "tz_name": "Asia/Shanghai",
            "tz_offset": "28800",
            "carrier": "CMCC",
            "mcc_mnc": "46000",
            "rom": "MIUI",
            "sys_rom": "MIUI14",
            "manifest_version_code": "380500",
            "update_version_code": "380500",
            "_rticket": str(int(time.time() * 1000)),
        }

    def to_dict(self) -> dict:
        """序列化为字典（可用于持久化）。"""
        return {
            "device_id": self.device_id,
            "install_id": self.install_id,
            "iid": self.iid,
            "openudid": self.openudid,
            "cdid": self.cdid,
            "clientudid": self.clientudid,
            "device_type": self.device_type,
            "os": self.os,
            "os_version": self.os_version,
            "app_version": self.app_version,
            "channel": self.channel,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Device":
        """从字典恢复设备。"""
        return cls(
            device_id=data["device_id"],
            install_id=data.get("install_id", ""),
            iid=data.get("iid", ""),
            openudid=data.get("openudid", ""),
            cdid=data.get("cdid", ""),
            clientudid=data.get("clientudid", ""),
            device_type=data.get("device_type", ""),
            os=data.get("os", 0),
            os_version=data.get("os_version", ""),
            app_version=data.get("app_version", ""),
            channel=data.get("channel", ""),
        )


def make_seed_device() -> Device:
    """创建预置 Seed 设备（首次注册用，无真实 device_id）。"""
    return Device(
        device_id=SEED_DEVICE_ID,
        install_id=SEED_INSTALL_ID,
        iid=SEED_IID,
        os=0,
    )

# ── 注册 ───────────────────────────────────────────────

async def register_device(
    *,
    device: Optional[Device] = None,
    httpx_client: Optional["httpx.AsyncClient"] = None,
) -> Device:
    """向抖音注册一个新设备。

    向 log.snssdk.com/service/2/device_register/ 发 POST，
    仅使用 X-Gorgon / X-Khronos / X-SS-STUB 签名（无需 X-Argus）。
    注册成功后返回带真实 device_id / install_id 的 Device 对象。

    Args:
        device:        预置设备信息（缺省则生成随机设备）
        httpx_client:  已弃用（保留仅为向后兼容）；内部统一走 stdlib urllib

    Returns:
        注册完成的 Device 对象

    Raises:
        RuntimeError: 注册失败（HTTP 非 200 或返回错误状态）
    """
    from ._http import request as _http_request

    d = device or make_seed_device()

    payload = d.register_payload()
    body = json.dumps(payload, separators=(",", ":")).encode()
    url = DEVICE_REGISTER_URL

    # 用 sign_all 算签名（先不传 device）
    headers = __sign(url=url, body=body, device=d)
    headers.update(d.to_headers())
    headers["Content-Type"] = "application/json; charset=utf-8"

    status, raw = _http_request("POST", url, headers=headers, data=body, timeout=30)
    if status != 200:
        raise RuntimeError(
            f"device register failed: HTTP {status} {raw[:200]!r}"
        )

    data = json.loads(raw.decode("utf-8", "replace")) if raw else {}
    device_id = data.get("device_id", 0)
    if not data.get("status_code", 1) and device_id not in (0, "0", None, ""):
        # 注册成功 → 用真实值覆盖设备
        d.device_id = str(device_id)
        d.install_id = str(data.get("install_id", d.install_id))
        d.iid = str(data.get("iid", d.iid))
        return d

    print(f"[device] registration failed (device_id={device_id}), fallback to seed")
    return make_seed_device()


def __sign(url: str, body: bytes, device: Device) -> dict:
    """内部签名包装（供 register_device 和 sign_mobile_request 共用）。"""
    from . import khronos, ssstub, gorgon

    ts = round(time.time())
    params_bytes = url.split("?", 1)[1].encode() if "?" in url else b""

    return {
        "X-Khronos": khronos.make_x_khronos(),
        "X-SS-STUB": ssstub.make_x_ss_stub(body),
        "X-Gorgon": gorgon.make_x_gorgon(
            params=params_bytes,
            payload=body,
            cookies=device.to_cookie().encode(),
            ts=ts,
            is_arm64=True,
        ),
    }
