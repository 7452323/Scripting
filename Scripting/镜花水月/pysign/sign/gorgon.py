"""
X-Gorgon（抖音 aid=1128，26 字节）。

## 状态：**已验证**

用抖音 23.3.0 `libmetasec_ml.so` 在 unidbg 里做 oracle，逐字节差分还原出完整算法，
再拿 **45 条真机样本回代**：

- family A：25/25 命中
- family B：20/20 命中

还原过程、原始数据、被排除的假设见 `docs/x-gorgon-structure.md`。

## 算法

```
in[0:4]  = md5(query_string)[:4]
in[4:8]  = payload[:4]          # 也就是 x-ss-stub 的前 4 字节
in[8:12] = cookies[:4]
in[12:16]= 20 04 02 04          # 常量
in[16:20]= ts (4 字节大端)      # 系统时钟，不是 url 里的 ts 参数

b = in ⊕ TABLE[family]
b[i] = nibble_swap(b[i]) ^ b[i+1]        (i = 0..18)
b[i] = bitrev8(b[i]) ^ 0xEB              (i = 0..18)
b[19] = nibble_swap(b[19]) ^ b[0]
b[19] = bitrev8(b[19]) ^ 0xEB

X-Gorgon = PREFIX[family] + b
```

两个 family 的表和前缀都是实测值，不是从别的仓库抄的。

## ⚠️ 已知边界

1. **family 的选择规则：已还原为「进程级调用计数的奇偶」。**
   16 次**完全相同的输入**实测序列：

   ```
   下标 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
   族   A  A  B  A  B  A  B  A  B  A  B  A  B  A  B
   ```

   与输入、与时间戳都无关（同一次实验里 `ts` 相同而族不同；
   不同 query / path / header 也不改变序列）。前两次是预热（都为 A），
   之后严格交替。用 `FamilyCounter` 复现这条序列。
   **注意**：计数是**进程级**的，所以在真机上序列相位取决于
   进程启动后已经发生过多少次签名调用。
2. 上面 A/B 那套值是在 **23.3.0** 的 so 上测的。**38.7.0 已另案还原**：它确实会
   换族 —— 同一进程内前缀里的状态量 F 会推进，每个 F 对应一张不同的表（见下节）。
   旧说法「38.7.0 不使用换族规则、恒为 family C」**已被证伪**：那是所有历史
   oracle 都只取进程头 7 次签名造成的**采样假象**，那一段 F 恰好恒为 `0x4a80`
   （前缀 `8404804a0000`）。
3. `params` 必须是 **query 串**（`?` 之后那段），不是整个 url。

## 38.7.0：多 family（F 状态量）

38.7.0 的 26 字节 X-Gorgon 结构::

    X-Gorgon = "8404" || LE32(F) || Body(20B)
    Body     = cascade20( in20 XOR T(F) )

`F` 是**进程内状态量**，落在 `0x20` 网格上；每个 F 对应一张 20 字节表。`in20`
布局与级联（`cascade20`）与 23.3.0 **完全相同**。前缀字节 `[2:6]` 就是 `LE32(F)`，
所以前缀 = `"8404" + F.to_bytes(4, "little").hex()`（例：F=`0x4a80` → `8404804a0000`）。

实测的 13 个 F 及其表见 `TABLES_387` / `PREFIXES_387`，用 `family387()` 取用；
`make_x_gorgon(..., family387=0x4a80)` 或 `family="0x4a80"` 可直接生成。
`Gorgon387FamilyState` 复现 60 次同输入实测到的 F 推进序列。注意：**真机相位
取决于进程启动后已发生的签名次数**，且 **F 的更新规则本身尚未定位**。
"""

import hashlib

from .native import reverse_bits

# ---------------------------------------------------------------- 实测常量

# 两张 20 字节表（真机 oracle 反解，45/45 回代命中）
TABLES = {
    "A": bytes.fromhex("cc90ae8574ae429cc36ffd9b9983446b6fec7442"),
    "B": bytes.fromhex("f9af7fb5f5a07dd97f677485b97bcfbfe765fd7f"),
    # 38.7.0 表：3 个独立样本（不同 query / 不同 X-Khronos）反解结果逐字节一致
    "C": bytes.fromhex("27903858d6f995cea6bbfea712885bc9ce89f9b6"),
}

# 6 字节前缀：0404 + family 标记 + 0000
PREFIXES = {
    "A": "0404e0010000",
    "B": "040480020000",
    # 38.7.0 前缀（实测，与 23.3.0 不同）
    "C": "8404804a0000",
}

# ------------------------------------------------------ 38.7.0 多 family（F）

# F 是「进程内状态量」，落在 0x20 网格上；每个 F 一张 20 字节表。
# 表由 in20 XOR T(F) 过 cascade20 回代逐字节命中（13/13）。键用 "0x4a80" 形式。
#
# 注意：**不要**把这些键并进上面的 TABLES / PREFIXES —— 那两个字典被约定为
# 23.3.0 的 A/B/C 三族（tests/test_sign.py 断言 set(TABLES) == {"A","B","C"}）。
TABLES_387 = {
    "0x4a80": bytes.fromhex("27903858d6f995cea6bbfea712885bc9ce89f9b6"),  # 即旧 "C"
    "0x4aa0": bytes.fromhex("566de9d3dc7f909ba398c2ff4ddf6562fba9797f"),
    "0x4ac0": bytes.fromhex("cfe39bdad6e390af1310fbf48f6fddd5b2649427"),
    "0x4ae0": bytes.fromhex("c8d7b03e5c6de581912891c883a783c881c98b3f"),
    "0x4b00": bytes.fromhex("f3fdd280dca6e7eac687c9fcd3ebd44998e2b1db"),
    "0x4b60": bytes.fromhex("c4c9cbd8a4a5839fabdbb7aed9f33cc9afb86ffd"),
    "0x4b80": bytes.fromhex("5fed17c983fdd4cd802b82fcddebfbc9f4ed9bdb"),
    "0x4ba0": bytes.fromhex("af65e64b3ec5abc58d3fb0bccbef8fb95aebb94b"),
    "0x4c00": bytes.fromhex("8f4dee27f2b8b84554c7c8b4afc2ae62cd8f8ea4"),
    "0x4c20": bytes.fromhex("f0c3df7662c0e8d4dca9a98183aea589e8c062dd"),
    "0x4c40": bytes.fromhex("fe72e3c00dccdfdf633ea9c3939091b4f7c7c74a"),
    "0x4c60": bytes.fromhex("56d887ecff5cdbd8938fd6b463c275a46da4a7db"),
    "0x4c80": bytes.fromhex("a7958bf3cf9fc5b2dbc743b4edc4d062b42c6666"),
}

# 38.7.0 前缀 = "8404" + LE32(F)。例：F=0x4a80 -> "8404804a0000"。
PREFIXES_387 = {
    key: "8404" + int(key, 16).to_bytes(4, "little").hex()
    for key in TABLES_387
}


def _normalize_387_key(f) -> str:
    """把 38.7.0 的 F 归一化成 `TABLES_387` 的键（`"0x4a80"` 形式）。"""
    if isinstance(f, int):
        key = f"0x{f:04x}"
    elif isinstance(f, str):
        try:
            key = f"0x{int(f.strip(), 16):04x}"
        except ValueError as exc:
            raise ValueError(f"无法把 {f!r} 解析成 F") from exc
    else:
        raise ValueError(f"F 必须是 int 或 '0x4a80' 形式的字符串，收到 {f!r}")
    if key not in TABLES_387:
        raise ValueError(
            f"F 必须是实测的 13 个之一 {sorted(TABLES_387)}，收到 {f!r}")
    return key


def family387(f):
    """公开接口：把 38.7.0 的 F 映射到「表 + 前缀」。

    Args:
        f: F 状态量 —— `0x4a80` 这样的 int，或 `"0x4a80"` 形式的字符串。

    Returns:
        `(key, table, prefix)`：key 形如 `"0x4a80"`；table 是 20 字节表；
        prefix 是 12 个 hex 字符的前缀。

    Raises:
        ValueError: F 不在实测的 13 个之内。

    Example:
        >>> family387(0x4a80)
        ('0x4a80', b"...", '8404804a0000')
    """
    key = _normalize_387_key(f)
    return key, TABLES_387[key], PREFIXES_387[key]


def _lookup_table(family) -> bytes:
    """family → 20 字节表。既接受 23.3.0 的 A/B/C，也接受 38.7.0 的 F。"""
    if family in TABLES:
        return TABLES[family]
    return TABLES_387[_normalize_387_key(family)]


def _lookup_prefix(family) -> str:
    """family → 前缀 hex。既接受 23.3.0 的 A/B/C，也接受 38.7.0 的 F。"""
    if family in PREFIXES:
        return PREFIXES[family]
    return PREFIXES_387[_normalize_387_key(family)]


# in[12:16] 的常量段
_FIX = bytes.fromhex("20040204")


def _nibble_swap(x: int) -> int:
    return ((x >> 4) & 0xF) | ((x << 4) & 0xFF)


# ---------------------------------------------------------------- 核心

def transform(in20: bytes, family: str = "A") -> bytes:
    """20 字节输入 → 20 字节正文（不含前缀）。

    这是已验证的那条级联。`in20` 的布局见模块 docstring。

    `family` 既可以是 23.3.0 的 `"A"`/`"B"`/`"C"`，也可以是 38.7.0 的 F
    —— `"0x4a80"` 形式的字符串，或 `0x4a80` 这样的 int（见 `family387()`）。
    """
    table = _lookup_table(family)
    if len(in20) != 20:
        raise ValueError(f"in20 必须是 20 字节，收到 {len(in20)}")

    b = bytearray(x ^ y for x, y in zip(in20, table))

    for i in range(19):
        b[i] = _nibble_swap(b[i]) ^ b[i + 1]
    for i in range(19):
        b[i] = reverse_bits(b[i]) ^ 0xEB

    b[19] = _nibble_swap(b[19]) ^ b[0]
    b[19] = reverse_bits(b[19]) ^ 0xEB

    return bytes(b)


class FamilyCounter:
    """复现实测到的 family 序列（进程级调用计数）。

    实测序列（16 次同输入，两次独立实验复现）::

        下标 0  1  2  3  4  5  6  7 ...
        族   A  A  B  A  B  A  B  A ...

    即：**前两次为 A，之后严格交替**。这条序列与请求内容、时间戳都无关。

    ⚠️ **仅适用于 23.3.0**。38.7.0 **不是**这条规则：它确实会换族 —— 同一进程内
    状态量 F 会推进，每个 F 一张表（见 `Gorgon387FamilyState` 与 `TABLES_387`）。
    旧说法「38.7.0 不使用换族规则、恒为 family C」**已被证伪**：那只是历史 oracle
    都只取进程头 7 次签名造成的采样假象，那一段 F 恰好恒为 `0x4a80`
    （前缀 `8404804a0000`）。

    计数是**进程级**的 —— 真机上一个新进程里第一次签名调用拿到的相位，
    取决于进程内在此之前发生过多少次签名调用。所以本类默认从实测相位开始，
    也允许显式给 `phase` 对齐目标进程。
    """

    def __init__(self, phase: int = 0) -> None:
        self._n = phase

    def next(self) -> str:
        """取下一个 family，并推进计数。"""
        i = self._n
        self._n += 1
        # 实测：下标 0、1 为 A；此后 2→B 3→A 4→B ...（奇数 A、偶数 B）
        if i < 2:
            return "A"
        return "A" if (i & 1) else "B"

    def reset(self, phase: int = 0) -> None:
        self._n = phase


# 38.7.0 实测的 F 推进序列：进程内第 k 次签名 → F。
# ⚠️ 这是 harness（unidbg）实测的**跃迁点**，不是从 so 里读出的规则。
_GORGON387_SEQUENCE = (
    (0x4A80, 7),   # 第 1-7 次
    (0x4AA0, 2),   # 第 8-9 次
    (0x4AC0, 8),   # 第 10-17 次
    (0x4AE0, 2),   # 第 18-19 次
    (0x4B00, 8),   # 第 20-27 次
    (0x4B60, 2),   # 第 28-29 次
    (0x4B80, 8),   # 第 30-36 次
    (0x4BA0, 2),   # 第 37-38 次
    (0x4C00, 8),   # 第 39-46 次
    (0x4C20, 2),   # 第 47-48 次
    (0x4C40, 8),   # 第 49-56 次
    (0x4C60, 2),   # 第 57-58 次
    (0x4C80, 1),   # 第 59 次
)
_GORGON387_TOTAL = sum(count for _, count in _GORGON387_SEQUENCE)  # = 60


class Gorgon387FamilyState:
    """复现实测到的 38.7.0 F 推进序列（进程内状态量）。

    实测序列（60 次同输入连签，三个独立进程一致）::

        第 1-7→0x4a80   8-9→0x4aa0   10-17→0x4ac0   18-19→0x4ae0
        20-27→0x4b00    28-29→0x4b60 30-36→0x4b80   37-38→0x4ba0
        39-46→0x4c00    47-48→0x4c20 49-56→0x4c40   57-58→0x4c60
        59→0x4c80

    ⚠️ **这是 harness 实测序列，真机相位取决于进程启动后已发生的签名次数。**
    第 k 次签名落到哪个 F，**不能**假定与 harness 的 k 相同 —— 真机对拍前必须
    按目标进程实际发生过的签名次数对齐 `phase`。

    ⚠️ **F 的更新规则本身尚未定位。** F 不是请求的函数、不是墙钟的函数，也不是
    单调计数器（输入交替时实测出现过回退 `0x4ae0 → 0x4ac0`）。本类只做「按观测
    序列推演」，**不外推**：超出实测的 60 次即抛 `IndexError`。

    Example:
        >>> s = Gorgon387FamilyState()
        >>> [s.next() for _ in range(3)]
        ['0x4a80', '0x4a80', '0x4a80']
    """

    def __init__(self, phase: int = 0) -> None:
        self._n = phase

    def next(self) -> str:
        """取下一个 F 的键（`"0x4a80"` 形式），并推进计数。"""
        i = self._n
        self._n += 1
        for f, count in _GORGON387_SEQUENCE:
            if i < count:
                return f"0x{f:04x}"
            i -= count
        raise IndexError(
            f"签名序号 {self._n - 1} 超出实测范围（前 {_GORGON387_TOTAL} 次）；"
            "F 的更新规则尚未定位，不能外推"
        )

    def reset(self, phase: int = 0) -> None:
        self._n = phase


def make_x_gorgon(
    params: bytes,
    payload: bytes,
    cookies: bytes,
    ts: int,
    is_arm64: bool = True,
    family: str = "A",
    family387=None,
) -> str:
    """
    Generate X-Gorgon header value (Douyin aid=1128).

    Args:
        params:   URL query string bytes (without '?')
        payload:  Request body bytes (or 16 bytes of zeros); first 4 go to in[4:8]
        cookies:  Cookie string bytes (or 16 bytes of zeros)
        ts:       Unix timestamp in **seconds** (system clock, big-endian)
        is_arm64: **已废弃**，保留只为兼容旧调用。真机前缀是 0404 开头，
                  跟这个参数无关。
        family:   23.3.0 的 "A" / "B" / "C"，或 38.7.0 的 F（"0x4a80" 字符串
                  或 `0x4a80` 这样的 int）。默认 "A"，与旧行为一致。
        family387: 38.7.0 的 F（`0x4a80` int 或 "0x4a80" 字符串）。**给了它就
                  忽略 `family`**；默认 None ⇒ 走旧的 A/B/C 路径。

    Returns:
        26 字节的 hex 字符串（52 字符）
    """
    fam = family387 if family387 is not None else family

    in20 = bytearray(20)
    in20[0:4] = hashlib.md5(params or b"").digest()[:4]
    in20[4:8] = (payload + b"\x00" * 4)[:4]
    in20[8:12] = (cookies + b"\x00" * 4)[:4]
    in20[12:16] = _FIX
    in20[16:20] = (ts & 0xFFFFFFFF).to_bytes(4, byteorder="big")

    return _lookup_prefix(fam) + transform(bytes(in20), fam).hex()
