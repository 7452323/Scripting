"""
X-Helios / X-Ladon (metasec, SPECK-128/256).

结构（真机抓包逆向 + 逐字节验证）::

    head   = 4 字节随机数 (bionic libc rand(), RAND_MAX=0x7FFFFFFF → MSB 恒 0)
    key    = MD5(head || str(aid)).hexdigest()   # 32 个 ASCII 十六进制字符
    K0..K3 = LE u64(md5hex[0:8]) / [8:16] / [16:24] / [24:32]
    rk     = SPECK-128/256 密钥编排, 34 轮
    pt     = f"{khronos}-{license_id}-{sig_aid}"  # 26 字节
    ct     = SPECK-128 ECB, 无 IV, PKCS7 填充到 32 字节
    out    = base64(head || ct)                   # 48 字符, 无 padding

X-Helios 与 X-Ladon 是同一算法，只是各自用独立的随机数 head。

验证：tests/fixtures/fanqie_samples.json 里 3 条番茄小说真机抓包，
解密后均还原出 ``{X-Khronos}-1611921764-3019``，与样本头逐字节吻合。
"""

from __future__ import annotations   # ← 3.9 兼容：注解里的 `bytes | None` 在 3.9 会运行时求值失败

import base64
import hashlib
import secrets

MASK64 = 0xFFFFFFFFFFFFFFFF
ROUNDS = 34

# 每个 App 一套常量。key_aid 进 MD5，sig_aid 进明文，两者不总是同一个数。
PROFILES = {
    "fanqie": {"key_aid": 1967, "license_id": 1611921764, "sig_aid": 3019},
    "hongguo": {"key_aid": 8662, "license_id": 1588093228, "sig_aid": 8662},
    "douyin": {"key_aid": 1128, "license_id": 1588093228, "sig_aid": 1128},
}


def _ror64(value: int, count: int) -> int:
    count %= 64
    if count == 0:
        return value & MASK64
    return ((value >> count) | (value << (64 - count))) & MASK64


def _rol64(value: int, count: int) -> int:
    return _ror64(value, (64 - count) % 64)


def make_head() -> bytes:
    """libc rand() 风格的 4 字节随机头（MSB 清零）。"""
    return secrets.randbits(31).to_bytes(4, "little")


def derive_key_words(head: bytes, aid) -> list:
    """MD5(head || str(aid)) 的 hex 摘要按 LE 读成 4 个 u64。"""
    md5hex = hashlib.md5(head + str(aid).encode("ascii")).hexdigest().encode("ascii")
    return [int.from_bytes(md5hex[i:i + 8], "little") for i in range(0, 32, 8)]


def key_schedule(words: list) -> list:
    """SPECK-128/256 密钥编排 → 34 个轮密钥。"""
    table = [words[0]]
    queue = list(words[2:])
    first, second = words[0], words[1]
    for i in range(ROUNDS):
        v = (_ror64(second, 8) + first) & MASK64
        v ^= i
        queue.append(v)
        v ^= _ror64(first, 61)
        table.append(v & MASK64)
        first, second = v & MASK64, queue.pop(0)
    return table


def encrypt_block(round_keys: list, block: bytes) -> bytes:
    d0 = int.from_bytes(block[:8], "little")
    d1 = int.from_bytes(block[8:16], "little")
    for i in range(ROUNDS):
        d1 = round_keys[i] ^ ((d0 + _ror64(d1, 8)) & MASK64)
        d0 = (d1 ^ _ror64(d0, 61)) & MASK64
    return d0.to_bytes(8, "little") + d1.to_bytes(8, "little")


def decrypt_block(round_keys: list, block: bytes) -> bytes:
    d0 = int.from_bytes(block[:8], "little")
    d1 = int.from_bytes(block[8:16], "little")
    for i in range(ROUNDS - 1, -1, -1):
        d0 = _rol64(d0 ^ d1, 61)
        d1 = _rol64((d1 ^ round_keys[i]) - d0 & MASK64, 8)
    return d0.to_bytes(8, "little") + d1.to_bytes(8, "little")


def pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    pad = block - len(data) % block
    return data + bytes([pad]) * pad


def pkcs7_unpad(data: bytes, block: int = 16) -> bytes:
    if not data or len(data) % block:
        return data
    pad = data[-1]
    if 1 <= pad <= block and data[-pad:] == bytes([pad]) * pad:
        return data[:-pad]
    return data


def encrypt_payload(plain: bytes, round_keys: list) -> bytes:
    padded = pkcs7_pad(plain)
    return b"".join(
        encrypt_block(round_keys, padded[i:i + 16])
        for i in range(0, len(padded), 16)
    )


def decrypt_payload(cipher: bytes, round_keys: list) -> bytes:
    out = b"".join(
        decrypt_block(round_keys, cipher[i:i + 16])
        for i in range(0, len(cipher), 16)
    )
    return pkcs7_unpad(out)


def sign(
    khronos: int,
    aid,
    license_id,
    sig_aid=None,
    head: bytes | None = None,
) -> str:
    """生成 X-Helios / X-Ladon 令牌。

    Args:
        khronos:    与 X-Khronos 相同的时间戳（秒）
        aid:        进 MD5 的 App 编号
        license_id: 明文第二段（安装时间 / license id）
        sig_aid:    明文第三段，缺省与 aid 相同
        head:       4 字节随机头，缺省本地生成

    Returns:
        48 字符 base64
    """
    if sig_aid is None:
        sig_aid = aid
    head = head if head is not None else make_head()
    if len(head) != 4:
        raise ValueError("head 必须是 4 字节")
    keys = key_schedule(derive_key_words(head, aid))
    plain = f"{khronos}-{license_id}-{sig_aid}".encode("ascii")
    return base64.b64encode(head + encrypt_payload(plain, keys)).decode()


def sign_profile(khronos: int, profile: str = "fanqie", license_id=None,
                 head: bytes | None = None) -> str:
    """按内置 App 常量签名。"""
    if profile not in PROFILES:
        raise KeyError(f"未知 profile: {profile}（可选 {sorted(PROFILES)}）")
    p = PROFILES[profile]
    return sign(
        khronos=khronos,
        aid=p["key_aid"],
        license_id=p["license_id"] if license_id is None else license_id,
        sig_aid=p["sig_aid"],
        head=head,
    )


def verify(token: str, aid) -> dict:
    """解密一个令牌，返回 {ok, plaintext, khronos, license_id, sig_aid}。

    只对已知 aid 的令牌有效；aid 猜错时明文是随机字节，``ok`` 为 False。
    """
    try:
        raw = base64.b64decode(token + "=" * (-len(token) % 4))
    except Exception as e:
        return {"ok": False, "error": f"非法 base64: {e}"}
    if len(raw) < 20 or (len(raw) - 4) % 16:
        return {"ok": False, "error": f"长度异常: {len(raw)}"}

    head, body = raw[:4], raw[4:]
    keys = key_schedule(derive_key_words(head, aid))
    plain = decrypt_payload(body, keys)
    try:
        text = plain.decode("ascii")
    except UnicodeDecodeError:
        return {"ok": False, "head": head.hex()}

    parts = text.split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return {"ok": False, "head": head.hex(), "plaintext": repr(plain)}

    khronos, license_id, sig_aid = (int(p) for p in parts)
    return {
        "ok": True,
        "head": head.hex(),
        "plaintext": text,
        "khronos": khronos,
        "license_id": license_id,
        "sig_aid": sig_aid,
    }
