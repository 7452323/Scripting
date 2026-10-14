"""
Constants for the douyin-sign package.
Load from JSON/hex files in constants/current/ with fallback defaults.
"""

import json
import os
import base64

# Default paths
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CONSTANTS_DIR = os.path.join(_BASE_DIR, 'constants', 'current')

# Default values
DEFAULT_SIGN_KEY_B64 = "wC8lD4bMTxmNVwY5jSkqi3QWmrphr/58ugLko7UZgWM="
DEFAULT_SIGN_KEY = base64.b64decode(DEFAULT_SIGN_KEY_B64)

# 抖音（aid=1128）签名密钥。**已用 4 条真机 X-Argus 验证**：解密得到合法
# protobuf（可见 app_id "1128"、固定串 "15880932..." 等字段）。
# 出处：huaerxiela/douyin-algorithm argus.cpp（douyin_23.2.0_arm64 逆向）。
DOUYIN_SIGN_KEY_B64 = "jr36OAbsxc7nlCPmAp7YJUC8Ihi7fq73HLaR96qKovU="
DOUYIN_SIGN_KEY = base64.b64decode(DOUYIN_SIGN_KEY_B64)

# X-Gorgon：两张 20 字节表 + 两个前缀，均为 23.3.0 oracle 反解、45/45 回代命中。
# 权威副本在 sign/gorgon.py 的 TABLES / PREFIXES；这里保持同步，避免旧常量残留。
DEFAULT_GORGON_TABLES = {
    "A": bytes.fromhex("cc90ae8574ae429cc36ffd9b9983446b6fec7442"),
    "B": bytes.fromhex("f9af7fb5f5a07dd97f677485b97bcfbfe765fd7f"),
}
DEFAULT_GORGON_PREFIXES = {
    "A": bytes.fromhex("0404e0010000"),
    "B": bytes.fromhex("040480020000"),
}
# 兼容旧名（历史值 ce7c47e4…/8404a0ae1000 是未验证的 armxe TikTok 常量，已弃用）
DEFAULT_GORGON_TABLE = DEFAULT_GORGON_TABLES["A"]
DEFAULT_GORGON_PREFIX_ARM64 = DEFAULT_GORGON_PREFIXES["A"]
DEFAULT_GORGON_PREFIX = DEFAULT_GORGON_PREFIXES["A"]

# Protobuf field configuration
DEFAULT_PROTOBUF_FIELDS = {
    "f1_value": 0x20200929,
    "f2_value": 2,
    "f21_value": 312,
    "f23_device_type_value": 5,
    "f23_channel": "googleplay",
    "f23_dpi": 209748992,
    "f25_value": 1,
    "f28_value": 1008,
    "f29_default": 516112,
    "f30_default": 6,
    "f31_default": 620944317,
}


def _load_hex_file(filename: str) -> bytes:
    """Load a hex file from constants/current/"""
    path = os.path.join(_CONSTANTS_DIR, filename)
    if os.path.isfile(path):
        with open(path, 'r') as f:
            return bytes.fromhex(f.read().strip())
    return None


def _load_json_file(filename: str) -> dict:
    """Load a JSON file from constants/current/"""
    path = os.path.join(_CONSTANTS_DIR, filename)
    if os.path.isfile(path):
        with open(path, 'r') as f:
            return json.load(f)
    return None


def get_sign_key() -> bytes:
    """
    Get the sign key from constants/current/ or return the built-in default.

    `sign_key.b64` is what update.py writes and what ships in the repo;
    `sign_key.hex` / `sign_key.json` are kept for compatibility.
    """
    # sign_key.b64 — base64 text
    path = os.path.join(_CONSTANTS_DIR, 'sign_key.b64')
    if os.path.isfile(path):
        with open(path, 'r') as f:
            b64 = f.read().strip()
        if b64:
            try:
                key = base64.b64decode(b64, validate=True)
                if len(key) == 32:
                    return key
            except Exception:
                pass

    # Try sign_key.hex first (hex format)
    hex_data = _load_hex_file('sign_key.hex')
    if hex_data:
        return hex_data

    # Try sign_key.json
    json_data = _load_json_file('sign_key.json')
    if json_data and 'key' in json_data:
        return base64.b64decode(json_data['key'])

    # Fallback to default
    return DEFAULT_SIGN_KEY


def get_gorgon_table(family: str = "A") -> bytes:
    """取 X-Gorgon 的 20 字节表（family "A"/"B"）。

    先看 constants/current/gorgon_table.hex（A）/ gorgon_table_b.hex（B），
    没有就回落实测默认值。表的值来自 23.3.0 oracle 反解。
    """
    fname = 'gorgon_table.hex' if family == "A" else f'gorgon_table_{family.lower()}.hex'
    hex_data = _load_hex_file(fname)
    if hex_data:
        return hex_data
    return DEFAULT_GORGON_TABLES[family]


def get_gorgon_prefix(family: str = "A", is_arm64: bool = None) -> bytes:
    """取 X-Gorgon 的 6 字节前缀。

    `is_arm64` 已废弃（真机前缀一律 0404 开头，与架构无关），保留只为兼容旧调用。
    """
    return DEFAULT_GORGON_PREFIXES[family]


def get_protobuf_fields() -> dict:
    """
    Get protobuf field configuration from constants/current/ or return default.
    Expected file: protobuf_fields.json
    """
    json_data = _load_json_file('protobuf_fields.json')
    if json_data:
        return json_data
    return DEFAULT_PROTOBUF_FIELDS
