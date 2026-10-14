"""
X-Argus token generation.
Build protobuf payload → SM3 hash → SIMON encrypt → AES-CBC encrypt → base64.
Direct translation from armxe Mobile/helpers/argus.py.
"""

import base64
import hashlib
import random
import secrets
import struct
from typing import Optional

from ._crypto_compat import AES as _AES, pad
from . import _crypto_compat as _sm3

from .constants import get_sign_key
from .dyn_encode import dyn_encode
from .native import reverse_bits, ror, validate, validate_32, byteswap, bit_swap, byteswap_32
from .simon import SIMON
from .gorgon import make_x_gorgon


def _get_request_hash(data: bytes) -> bytes:
    """SM3 hash, take first 6 bytes."""
    return bytes.fromhex(_sm3.sm3_hash(msg=data))[:6]


def _simon_encode(pt: list, key: list):
    """SIMON-128/128 encrypt."""
    return SIMON().encode(pt=pt, k=key)


def _mix(key: bytes) -> int:
    """
    Mix function: XOR/shift confusion over pairs of bytes.
    Translated from helpers/argus.py mix().
    """
    A = 0
    T = 0
    for i in range(0, len(key), 2):
        B = key[i] ^ A
        C = (T >> 0x3) & 0xFFFFFFFF
        D = C ^ B
        E = D ^ T
        F = (E >> 0x5) & 0xFFFFFFFF
        G = (E << 0xB) & 0xFFFFFFFF
        H = key[i + 1] | G
        I = F ^ H
        J = I ^ E
        T = ~J & 0xFFFFFFFF
    return T


def _encrypt_enc_pb(data: bytes, length: int) -> bytes:
    """
    enc_pb encryption: XOR first 8 bytes cyclically over rest, then reverse.
    """
    d = list(data)
    xor_array = d[:8]
    for i in range(8, length):
        d[i] ^= xor_array[i % 4]
    d = d[::-1]
    return bytes(d)


def generate_argus_protobuf(
    params: bytes,
    payload: bytes,
    ts: int,
    app_id: int,
    app_version: str,
    app_launch_time: int,
    device_type: str,
    sdk_version: str,
    sdk_version_code: int,
    license_id: int,
    device_id: Optional[str] = None,
    device_token: Optional[str] = None,
    dyn_seed: Optional[str] = None,
    dyn_version: Optional[int] = None,
) -> bytes:
    """
    Generate the protobuf payload for X-Argus.

    Args:
        params:           URL query params bytes
        payload:          Request body bytes
        ts:               Unix timestamp
        app_id:           Application ID (e.g., 1233)
        app_version:      App version string (e.g., "38.3.0")
        app_launch_time:  App launch time in ms
        device_type:      Device model string (e.g., "SM925")
        sdk_version:      SDK version string
        sdk_version_code: SDK version code
        license_id:       License ID
        device_id:        Optional device ID
        device_token:     Optional device token
        dyn_seed:         Optional dynamic seed
        dyn_version:      Optional dynamic version (1-8)

    Returns:
        Serialized protobuf bytes
    """
    from .protobuf import ProtoBuf

    rand_value = random.randint(0, 0x7fffffff)

    proto = {
        1: 0x20200929 << 1,
        2: 2,
        3: rand_value << 1,
        4: str(app_id),
        6: str(license_id),
        7: app_version,
        8: sdk_version,
        9: sdk_version_code << 1,
        10: bytes(8),
        12: ts << 1,
        13: _get_request_hash(bytearray(payload)),
        14: _get_request_hash(bytearray(params)),
        15: {
            1: random.randint(20, 250) << 1,
            7: app_launch_time << 1,
        },
        17: ts << 1,
        20: "none",
        21: 312 << 1,
        23: {
            1: device_type,
            2: 5 << 1,
            3: 'googleplay',
            4: 209748992 << 1,
        },
        25: 1 << 1,
        28: 1008 << 1,
    }

    if device_id:
        proto[5] = device_id

    if device_token:
        proto[16] = device_token

    if dyn_seed:
        proto[24] = dyn_seed
        proto[25] = 5 << 1
        proto[26] = {
            1: dyn_version << 1,
            2: bytes.fromhex(dyn_encode(dyn_version=dyn_version, params=params, payload=payload, rand=rand_value)),
        }
        proto[29] = 516112
        proto[30] = 6
        proto[31] = 620944317 << 1

    # Sort keys ascending
    proto = {k: proto[k] for k in sorted(proto.keys())}
    return ProtoBuf(proto).toBuf()


def encode_argus_fn(protobuf: bytes, sign_key: bytes = None) -> str:
    """
    Encode an X-Argus token from protobuf data.

    Process:
    protobuf → pad → SIMON-128/128 encrypt → mix → enc_pb → headers → AES-CBC → base64

    Args:
        protobuf:  Serialized protobuf bytes
        sign_key:  32-byte signing key (default from constants)

    Returns:
        Base64-encoded X-Argus string
    """
    if sign_key is None:
        sign_key = get_sign_key()

    protobuf = pad(protobuf, _AES.block_size)
    length = len(protobuf)
    random_bytes = secrets.token_bytes(4)

    # SM3 derive key
    sm3_buffer = sign_key + random_bytes + sign_key
    sm3_output = bytes.fromhex(_sm3.sm3_hash(bytearray(sm3_buffer)))
    key = sm3_output[:32]

    # Prepare SIMON key list (4 uint64 values)
    key_list = []
    for i in range(2):
        key_list += list(struct.unpack("<QQ", key[i * 16:i * 16 + 16]))

    # SIMON encrypt each 16-byte block
    pointer = bytearray(length)
    for i in range(length // 16):
        pt = list(struct.unpack("<QQ", protobuf[i * 16:i * 16 + 16]))
        ct = _simon_encode(pt, key_list)
        pointer[i * 16:i * 16 + 8] = ct[0].to_bytes(8, byteorder='little')
        pointer[i * 16 + 8:i * 16 + 16] = ct[1].to_bytes(8, byteorder='little')

    pointer = pointer[:length]

    # Mix and xor_key
    mixed = _mix(random_bytes[2:4])
    mixed = struct.pack(">I", mixed)
    mixed = mixed[::-1]
    xor_key = mixed + mixed
    pointer = xor_key + pointer

    # enc_pb transformation
    b_buffer = _encrypt_enc_pb(pointer, length + 8)

    # Build headers
    headers = bytes([
        0xec,
        random.randint(0x10, 0xFF),
        random.randint(0x10, 0xFF),
        random.randint(0x10, 0xFF),
        random.randint(0x10, 0xFF),
        0x01,
        random.randint(0x10, 0xFF),
        0x02,
        0x18,
    ])
    b_buffer = headers + b_buffer + random_bytes[2:4]

    # AES-CBC encrypt
    aes_key = hashlib.md5(sign_key[:16]).digest()
    aes_iv = hashlib.md5(sign_key[16:]).digest()
    cipher = _AES.new(aes_key, _AES.MODE_CBC, aes_iv)
    output = cipher.encrypt(pad(b_buffer, _AES.block_size))
    output = random_bytes[0:2] + output

    return base64.b64encode(output).decode()


def make_x_argus(
    params: bytes,
    payload: bytes,
    ts: int,
    app_id: int,
    app_version: str,
    app_launch_time: int,
    device_type: str,
    sdk_version: str,
    sdk_version_code: int,
    license_id: int,
    device_id: Optional[str] = None,
    device_token: Optional[str] = None,
    dyn_seed: Optional[str] = None,
    dyn_version: Optional[int] = None,
    sign_key: bytes = None,
) -> str:
    """
    Generate X-Argus token.

    Combines generate_protobuf + encode_argus_fn.

    Args:
        params:           URL query params bytes
        payload:          Request body bytes
        ts:               Unix timestamp
        app_id:           Application ID
        app_version:      App version string
        app_launch_time:  App launch time in ms
        device_type:      Device model
        sdk_version:      SDK version string
        sdk_version_code: SDK version code
        license_id:       License ID
        device_id:        Optional device ID
        device_token:     Optional device token
        dyn_seed:         Optional dynamic seed
        dyn_version:      Optional dynamic version (1-8)
        sign_key:         32-byte signing key (default from constants)

    Returns:
        Base64-encoded X-Argus string
    """
    if sign_key is None:
        sign_key = get_sign_key()

    protobuf = generate_argus_protobuf(
        params=params, payload=payload, ts=ts,
        app_id=app_id, app_version=app_version,
        app_launch_time=app_launch_time, device_type=device_type,
        sdk_version=sdk_version, sdk_version_code=sdk_version_code,
        license_id=license_id, device_id=device_id,
        device_token=device_token, dyn_seed=dyn_seed, dyn_version=dyn_version,
    )

    return encode_argus_fn(protobuf=protobuf, sign_key=sign_key)


# --- 38.7.0 形态（本轮破解，逐字节验证） ---------------------------------
#
# 抖音 38.7.0 的 X-Argus **不是** 23.3.0 那套 protobuf+SM3+SIMON+AES，
# 而是一个极简的确定性函数：
#
#     X-Argus(38.7.0) = base64( LE_dword(X-Khronos) )      # 4 字节
#
# 证据（两条独立真值，`tests/data/perseus387_headers.json`）:
#
#     ctrl  kh=1791343486 (0x6ac5bb7e) -> "frvFag=="  raw=7ebbc56a  ✅
#     ioreq kh=1791343071 (0x6ac5b9df) -> "37nFag=="  raw=dfb9c56a  ✅
#
# 两样本 raw ^ kh == 0（完全一致），⇒ 无额外密钥、无随机量、无加密。

def make_x_argus_387(khronos: int) -> str:
    """38.7.0 抖音 X-Argus = ``base64(LE_dword(X-Khronos))``。

    >>> make_x_argus_387(1791343486)
    'frvFag=='
    >>> make_x_argus_387(1791343071)
    '37nFag=='
    """
    return base64.b64encode(struct.pack("<I", khronos & 0xFFFFFFFF)).decode()


X_ARGUS_387_VECTORS = [
    (1791343486, "frvFag=="),
    (1791343071, "37nFag=="),
]  # (X-Khronos, X-Argus)


# --- 解密（已验证） -------------------------------------------------------

def decrypt_x_argus(x_argus: str, sign_key: bytes = None):
    """
    解密 X-Argus（抖音形态）。

    逐行复刻 huaerxiela/douyin-algorithm 的 ``argus.cpp::decrypt_argus``。

    已验证：仓库 tests/fixtures/argus_real.json 里的 4 条真机 base64
    （取自该仓库 main.cpp 的 test_decrypt_argus）全部解出合法 protobuf，
    可见 app_id ``"1128"``、固定串 ``"15880932..."`` 等字段。

    Args:
        x_argus:  base64 的 X-Argus 串
        sign_key: 32 字节签名密钥，默认抖音的 DOUYIN_SIGN_KEY

    Returns:
        dict: {
            "random_num": int,
            "protobuf": bytes,       # SIMON 解密后的 protobuf
            "aes_plain": bytes,      # AES 解密 + 去填充后的明文
        }
    """
    from .constants import DOUYIN_SIGN_KEY
    from .simon import simon_dec

    if sign_key is None:
        sign_key = DOUYIN_SIGN_KEY

    argus = base64.b64decode(x_argus)
    rand_right = struct.unpack_from("<H", argus, 0)[0]

    aes_key = hashlib.md5(sign_key[:16]).digest()
    aes_iv = hashlib.md5(sign_key[16:]).digest()
    cipher = _AES.new(aes_key, _AES.MODE_CBC, aes_iv)
    plain = cipher.decrypt(argus[2:])
    pad_len = plain[-1] if plain else 0
    if 0 < pad_len <= 16 and plain[-pad_len:] == bytes([pad_len]) * pad_len:
        plain = plain[:-pad_len]

    ln = len(plain)
    rand_left = struct.unpack_from("<H", plain, ln - 2)[0]
    random_num = ((rand_left << 16) | rand_right) & 0xFFFFFFFF

    b = bytearray(plain[9:ln - 2])
    tail = bytes(b[len(b) - 8:len(b)])
    for i in range(len(b) - 8):
        b[i] ^= tail[i % 4]
    b.reverse()

    sm3_in = sign_key + struct.pack("<I", random_num) + sign_key
    key = list(struct.unpack("<4Q", bytes.fromhex(_sm3.sm3_hash(list(sm3_in)))))

    body = bytes(b[8:])
    pb = bytearray()
    for i in range(len(body) // 16):
        ct = struct.unpack_from("<2Q", body, i * 16)
        pt = simon_dec(ct, key)
        pb += struct.pack("<2Q", *pt)

    return {"random_num": random_num, "protobuf": bytes(pb), "aes_plain": plain}
