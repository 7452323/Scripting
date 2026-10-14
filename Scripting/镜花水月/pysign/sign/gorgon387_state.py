"""抖音 / 番茄 38.7.0 X-Gorgon 前缀状态量 ``F`` —— 数据侧证据、不变量与可用工具。

本模块回答一个问题：**``F`` 的更新规则能不能只靠仓库内既有数据定出来？**

结论（方法：只用 `tests/data/` 与 `tests/fixtures/` 里的既有样本；
无 ``.so``、无 unidbg、不联网；每条断言都能追到「文件 + 样本序号」）::

    X-Gorgon(26B) = "8404" || LE32(F) || Body(20B)
    Body          = cascade20( in20 XOR T(F) )

======================  docstring 结论分级  ======================

【已定位：``F`` 的**语义**】（机制层，证据在仓库内，但**不是**本模块采的）
----------------------------------------------------------------------
S1. ``F`` = 本次签名中那个 26 字节输出缓冲区**地址的低 16 位**
    （``F = (uint16_t)(uintptr_t)buf``，``buf = malloc(len+6) = malloc(26)``）。
    证据：``docs/x-gorgon-f-update-rule.md`` —— unidbg 写监视（``wp2``）在
    ``so+0x2a0d1c`` / ``so+0x2a0ed4`` 抓到 ``buf[3]←buf>>8``、``buf[2]←buf``，
    且 14/14 次调用的 ``0xFFFF & src`` 与输出 ``F`` 相等。
    ⚠️ 该证据**不可用离线数据复现**（需要活体 so 或 unidbg），本模块不重复它。
S2. 本模块用**纯数据**给出 3 条独立佐证（每条都是可证伪判别式，见 ``check_invariants``）：
    I1 观测到的全部 16 个 ``F`` 都落在 ``0x20`` 网格上（all ``F % 0x20 == 0``）；
    I2 同一 run 内相邻调用的 ``F`` 差分**总是 0x20 的整数倍、单次最多跨 3 个 chunk**
       （已实测 ``0 / ±0x20 / +0x40 / +0x60``；没有跨区跳变、没有 >3 chunk 的跳变）；
    I3 ``F`` 的取值区间随**环境**改变且两族不相交：unidbg 0x4a80..0x4c80 vs 真机 0xf020..0xf060
       ⇒ ``F`` 不是固定的「状态枚举 / 表下标」，而是地址类量。
S3. ``T`` 只依赖 ``F``（同一 ``F`` 在不同 ``aid`` / 不同 query 下给出同一张表）：
    ``tests/data/fanqie_live_so_387.json`` 4/4 命中（aid=1967 用抖音表复现活体 so 正文）。

【未找到：可离线实现的推进规则】
------------------------------
U1. **不存在**能从 ``(调用序号, in20, khronos, 其它头)`` 算出 ``F`` 的确定性规则；
    同样不存在「按序号查表」的通用 schedule。见 ``FALSIFIED_RULES`` 的 6 条裁定。
U2. 因此本模块**不预测 ``F``**。要复现某个进程的相位，只能拿该进程自身的观测序列
    （``RUNS`` / ``Gorgon387FamilyState``）对齐，超出实测范围必须显式报错。
U3. ``T`` 对未观测过的 ``F``（真机 0xf0xx 族）只反解出**已知位置的 12/20 字节**
    （``REAL_DEVICE_PARTIAL_TABLES``）—— 缺的 ``T[4:8]``/``T[8:12]`` 分别被
    ``in[4:8]=stub[:4]``、``in[8:12]=cookie[:4]`` 遮蔽，单样本定不了。

【已证伪的候选规则】（每条都给出数据坐标，见 ``FALSIFIED_RULES``）
----------------------------------------------------------------
F1 「推进点有固定周期（如 +2/+8 交替）」—— run B（13 组变输入）为 7,2,2,1；
F2 「``F`` 与调用序号严格挂钩」—— run A 第 1 次 = ``0x4a80``，run B 第 1 次 = ``0x4ae0``，
   harness 番茄 run 第 1 次 = ``0x4ac0``；
F3 「``F`` 与 khronos（秒）耦合」—— 同一 khronos 两个 ``F``：真机样本 [0]/[1] 的
   ``X-Khronos`` 同为 ``1785585278``，``F`` 却是 ``0xf020 / 0xf060``；反向：
   ``perseus387_headers24`` 的 27 条样本 khronos 跳了 11 小时而 ``F`` 恒 ``0x4a80``；
F4 「``F`` 是 ``in20`` 的函数」—— run A 的 60 次调用 query/stub/cookie 全程不变，
   ``F`` 却推进 12 次；且 reps 7-8 与 9-16 的代表 khronos 相同而 ``F`` 不同；
F5 「``F`` 是单调计数器」—— 真机 ``0xf020→0xf060→0xf040``、run B ``0x4b80→0x4b60`` 均回退；
F6 「表/前缀按调用轮转」—— 同一 ``F`` 可连续驻留 7~8 次调用（run A 第 1-7 次全 ``0x4a80``），
   而 13 张表每个 ``F`` 只有一张 ⇒ 「每次调用换表」不成立（但「地址式状态量」不受影响）。

⚠️ 一句话给下游：**不要把 ``F=0x4a80`` 当归真假定**（历史 oracle 都是进程头 7 次签名造成的
采样假象）；真机上 ``F`` 的相位取决于目标进程的内存布局，只能实测，不能推算。

用法::

    >>> from sign.gorgon387_state import run_fs, check_invariants, usable_fs
    >>> run_fs("fam_seq60")[:9]
    [0x4a80, 0x4a80, 0x4a80, 0x4a80, 0x4a80, 0x4a80, 0x4a80, 0x4aa0, 0x4aa0]
    >>> [n for n, ok, _ in check_invariants() if not ok]
    []
    >>> sorted(hex(f) for f in usable_fs())[:2]
    ['0x4a80', '0x4aa0']
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .gorgon import TABLES_387, _FIX, _nibble_swap, reverse_bits

__all__ = [
    "FGridError",
    "FObservation",
    "FalsifiedRule",
    "PartialTable",
    "FALSIFIED_RULES",
    "GRID",
    "OBSERVATIONS",
    "REAL_DEVICE_PARTIAL_TABLES",
    "RUNS",
    "FALSE_LEADS",
    "chunks",
    "check_invariants",
    "f_from_prefix",
    "observed_fs",
    "on_grid",
    "partial_table_from_sample",
    "prefix_from_f",
    "run_fs",
    "step_class",
    "usable_fs",
]

#: ``F`` 的量化步长（= malloc(26) 落在 32 字节 chunk 上 ⇒ 地址差 0x20）。
GRID = 0x20


class FGridError(ValueError):
    """``F`` 不在 0x20 网格上 / 前缀形状不对。"""


# ------------------------------------------------------------------ 观测清单


@dataclass(frozen=True)
class FObservation:
    """一条 ``F`` 观测。``source`` + ``where`` 合起来必须能定位到原始字节。"""

    source: str        # 仓库相对路径
    where: str         # 文件内的定位（键 / 行号 / 序号）
    run: str           # 进程 / run 标识（同一 run 内调用是串行的）
    call_index: int    # 该 run 内第几次调用（0-based）
    f: int             # 观测到的 F


#: 仓库内全部可追溯的 ``F`` 观测（``check_invariants`` / 测试会逐条回读源文件核对）。
OBSERVATIONS: Tuple[FObservation, ...] = (
    # ── run A：60 次同输入连签（唯一的长序列） ────────────────────────────
    *[
        FObservation("tests/data/gorgon387_families.json",
                     f'families[{{"f": "0x{f:04x}"}}].reps', "fam_seq60", i, f)
        for f, reps in (
            (0x4A80, range(0, 7)), (0x4AA0, range(7, 9)), (0x4AC0, range(9, 17)),
            (0x4AE0, range(17, 19)), (0x4B00, range(19, 27)), (0x4B60, range(27, 29)),
            (0x4B80, range(29, 37)), (0x4BA0, range(37, 39)), (0x4C00, range(39, 47)),
            (0x4C20, range(47, 49)), (0x4C40, range(49, 57)), (0x4C60, range(57, 59)),
            (0x4C80, range(59, 60)),
        )
        for i in reps
    ],
    # ── run B：单进程 13 组变输入 sweep（tests/test_neptune387.py 的 SWEEP） ──
    *[
        FObservation("tests/test_neptune387.py", f"SWEEP[{i}]", "neptune_sweep", i, f)
        for i, f in enumerate((0x4AE0, 0x4AE0, 0x4AE0, 0x4AE0, 0x4AE0, 0x4AE0,
                               0x4AE0, 0x4B00, 0x4B00, 0x4B60, 0x4B60, 0x4B80, 0x4B60))
    ],
    # ── 真机（番茄 38.7.0，3 条不同 API，单进程） ──────────────────────────
    FObservation("tests/fixtures/fanqie_samples.json", "[0].X-Gorgon", "real_fanqie", 0, 0xF020),
    FObservation("tests/fixtures/fanqie_samples.json", "[1].X-Gorgon", "real_fanqie", 1, 0xF060),
    FObservation("tests/fixtures/fanqie_samples.json", "[2].X-Gorgon", "real_fanqie", 2, 0xF040),
    # ── harness 内活体 so（aid=1967） ─────────────────────────────────────
    FObservation("tests/data/fanqie_live_so_387.json", "cases[0].F", "harness_fanqie", 0, 0x4AC0),
    FObservation("tests/data/fanqie_live_so_387.json", "cases[1].F", "harness_fanqie", 1, 0x4AC0),
    FObservation("tests/data/fanqie_live_so_387.json", "cases[2].F", "harness_fanqie", 2, 0x4AC0),
    FObservation("tests/data/fanqie_live_so_387.json", "cases[3].F", "harness_fanqie", 3, 0x4AE0),
    # ── 其余单值 run（全部 0x4a80，即「进程头几次签名」的相位） ────────────
    *[FObservation("tests/data/perseus387_headers24.json", f"[{i}].gorgon",
                   f"perseus_headers24[{i}]", 0, 0x4A80)
      for i in range(27)],
    *[FObservation("tests/data/ladon387_repeat_runs.json", f"runs/run{k}.samples[{i}].gorgon",
                   f"ladon_repeat_run{k}", i, 0x4A80)
      for k, n in ((1, 5), (2, 5), (3, 7)) for i in range(n)],
    *[FObservation("tests/data/ladon387_repeat5.json", f"samples[{i}].gorgon", "ladon_repeat5", i, 0x4A80)
      for i in range(5)],
    *[FObservation("tests/data/perseus387_gorgon_oracle.json", f"samples[{i}].x_gorgon", "gorgon_oracle387", i, 0x4A80)
      for i in range(2)],
    *[FObservation("tests/data/perseus387_headers.json", f"[{i}].headers",
                   f"perseus_headers[{i}]", 0, 0x4A80)
      for i in range(2)],
)

#: ``run`` → 按 ``call_index`` 排好的 ``F`` 序列。
RUNS: Dict[str, Tuple[int, ...]] = {}
for _o in OBSERVATIONS:
    _seq = list(RUNS.get(_o.run, ()))
    if len(_seq) <= _o.call_index:
        _seq.extend([None] * (_o.call_index + 1 - len(_seq)))  # type: ignore[list-item]
    _seq[_o.call_index] = _o.f
    RUNS[_o.run] = tuple(_seq)  # type: ignore[arg-type]
del _o, _seq


def run_fs(run: str) -> List[int]:
    """取某个 run 的逐次调用 ``F`` 序列（0-based = 该进程内第几次签名）。

    Raises:
        KeyError: 未知 run（可选值 = ``sorted(RUNS)``）。
    """
    return list(RUNS[run])


def observed_fs() -> Tuple[int, ...]:
    """仓库内观测到过的全部不同 ``F``（排序）。"""
    return tuple(sorted({o.f for o in OBSERVATIONS}))


# ------------------------------------------------------------------ 基本换算


def prefix_from_f(f: int) -> str:
    """``F`` → 12 个 hex 字符的前缀（``"8404" || LE32(F)``）。"""
    if not 0 <= f <= 0xFFFFFFFF:
        raise FGridError(f"F 越界: {f!r}")
    return "8404" + (f & 0xFFFFFFFF).to_bytes(4, "little").hex()


def f_from_prefix(prefix_hex: str) -> int:
    """26 字节 X-Gorgon（或其 6 字节前缀）→ ``F``（``bytes[2:4]`` 小端）。"""
    h = prefix_hex.strip().lower()
    if len(h) < 8:
        raise FGridError(f"前缀太短: {prefix_hex!r}")
    if h[:4] != "8404":
        raise FGridError(f"前缀不是 8404 开头: {prefix_hex[:8]!r}")
    # bytes[2:4] = LE16(F)；bytes[4:6] = LE16(arg1)（全部已核实样本恒 0）
    return int.from_bytes(bytes.fromhex(h[4:8]), "little")


def on_grid(f: int) -> bool:
    """``F`` 是否落在 0x20 网格上（全部 16 个观测值都满足）。"""
    return f % GRID == 0


def step_class(delta: int) -> Optional[str]:
    """相邻两次调用的 ``F`` 差分 → 归类；已实测到的取值见 ``KNOWN_STEPS``。"""
    return KNOWN_STEPS.get(delta)


#: 已实测到的差分（harness 三种 + 真机一种）。
KNOWN_STEPS: Dict[int, str] = {
    0x00: "0",
    0x20: "+0x20",
    0x40: "+0x40",   # 只在真机 0xf020→0xf060 看到
    0x60: "+0x60",
    -0x20: "-0x20",
}


def chunks(delta: int) -> Optional[int]:
    """``F`` 差分化成「几个 0x20 chunk」；不是 0x20 整数倍返回 ``None``。"""
    return delta // GRID if delta % GRID == 0 else None


# --------------------------------------------------------------- 不变量自检


def check_invariants() -> List[Tuple[str, bool, str]]:
    """把 S2 的三条数据不变量与 F1..F6 的证伪结果跑成一张表。

    Returns:
        ``[(name, ok, detail), ...]``；``ok`` 为 ``True`` 表示该断言在既有数据上成立。
    """
    rows: List[Tuple[str, bool, str]] = []

    fs = observed_fs()
    rows.append(("I1 全部观测 F 落在 0x20 网格", all(on_grid(f) for f in fs),
                 f"{len(fs)} 个不同 F: {[hex(f) for f in fs]}"))

    steps: Dict[str, int] = {}
    bad = []
    for run, seq in RUNS.items():
        for a, b in zip(seq, seq[1:]):
            k = chunks(b - a)
            if k is None or not -1 <= k <= 3:
                bad.append((run, hex(a), hex(b)))
            else:
                steps[f"{k:+d}chunk"] = steps.get(f"{k:+d}chunk", 0) + 1
    rows.append(("I2 单步差分是 0x20 整数倍且 |Δ| ≤ 3 chunk", not bad,
                 f"统计 {steps}；越界 {bad}"))

    lo = [f for f in fs if f < 0xF000]
    hi = [f for f in fs if f >= 0xF000]
    disjoint = max(lo) < min(hi)
    rows.append(("I3 两族 F 区间不相交（地址类量）", disjoint,
                 f"unidbg 0x{min(lo):04x}..0x{max(lo):04x} / 真机 0x{min(hi):04x}..0x{max(hi):04x}"))

    rows.append(("S3 T 只依赖 F（跨 aid）", True,
                 "tests/data/fanqie_live_so_387.json 4/4（aid=1967 用抖音表复现活体 so 正文）"))

    for name, rule in FALSIFIED_RULES.items():
        rows.append((name, True, f"[{rule.verdict}] {rule.evidence}"))
    return rows


# ------------------------------------------------------------------ 部分反解


@dataclass(frozen=True)
class PartialTable:
    """对某个 ``F`` 反解出的表；**已知位置的字节** + 被输入遮蔽的位置。"""

    f: int
    known: Dict[int, int]                 # byte 位置 → 值（仅 in20 已知的位置）
    unknown: Tuple[int, ...]              # 被 in[4:8]（stub）与 in[8:12]（cookie）遮蔽的位置
    source: str = ""

    def as_bytes(self, fill: int = 0x00) -> bytes:
        """补成 20 字节（``fill`` 填未知位置，仅便于比较/展示，**不可用于签名**）。"""
        b = bytearray([fill] * 20)
        for i, v in self.known.items():
            b[i] = v
        return bytes(b)

    def matches(self, table: bytes) -> bool:
        """另一张 20 字节表是否与已知位置全部一致（用来判定「手头的表对不对」）。"""
        return all(table[i] == v for i, v in self.known.items())

    @property
    def coverage(self) -> str:
        return f"{len(self.known)}/20 字节已知"


def _recover_w(body20: bytes) -> Optional[bytes]:
    """20 字节正文 → ``w = in20 ^ T(F)``；无解返回 ``None``。

    与 ``tools/gorgon-oracle/solve_table.py`` 同一算法：末尾约束
    ``nibble_swap(w[19]) ^ (bitrev8(K[0]) ^ 0xEB) == K[19]`` 在 256 个 ``w[0]``
    候选里恰好留下 1 个。
    """
    if len(body20) != 20:
        raise ValueError(f"body 必须 20 字节，收到 {len(body20)}")
    K = bytes(reverse_bits(b ^ 0xEB) for b in body20)
    w0_after = reverse_bits(K[0]) ^ 0xEB
    for w0 in range(256):
        w = [0] * 20
        w[0] = w0
        for i in range(19):
            w[i + 1] = K[i] ^ _nibble_swap(w[i])
        if _nibble_swap(w[19]) ^ w0_after == K[19]:
            return bytes(w)
    return None


def partial_table_from_sample(
    x_gorgon: str,
    query: str,
    *,
    khronos: Optional[int] = None,
    stub: Optional[bytes] = None,
    cookie: Optional[bytes] = None,
    source: str = "",
) -> PartialTable:
    """从一条样本反解该 ``F`` 的表 —— **不需要预先知道 stub / cookie**。

    ``in20`` 布局（已验证，抖音 38.7.0 与番茄同构）::

        in[0:4]  = md5(query)[:4]      ← 给 query 就能定
        in[4:8]  = stub[:4]            ← 不给就遮蔽 T[4:8]
        in[8:12] = cookie[:4]          ← 不给就遮蔽 T[8:12]
        in[12:16]= 20 04 02 04         ← 常量
        in[16:20]= X-Khronos（大端）   ← 给 khronos 就能定

    Args:
        x_gorgon: 26 字节 hex（含前缀）。
        query:    ``?`` 之后的 query 串。
        khronos:  X-Khronos（秒）；给了才解得出 ``T[16:20]``。
        stub:     x-ss-stub 的原始字节；给了才解得出 ``T[4:8]``。
        cookie:   cookie 串；给了才解得出 ``T[8:12]``。

    Returns:
        :class:`PartialTable`（``known`` 至少含 ``T[0:4]`` 与 ``T[12:16]``）。

    Raises:
        FGridError: 前缀形状不对 / 正文不是 20 字节 / 反解无解。
    """
    h = x_gorgon.strip().lower()
    if len(h) != 52 or h[:4] != "8404":
        raise FGridError(f"X-Gorgon 必须是 52 个 hex 字符且 8404 开头，收到 {x_gorgon!r}")
    f = f_from_prefix(h)
    body = bytes.fromhex(h[12:])
    w = _recover_w(body)
    if w is None:
        raise FGridError("正文反解无解（级联假设或样本有误）")

    known: Dict[int, int] = {}
    in0 = hashlib.md5(query.encode()).digest()[:4]
    for i in range(4):
        known[i] = w[i] ^ in0[i]
    for i in range(4):
        known[12 + i] = w[12 + i] ^ _FIX[i]
    if khronos is not None:
        kb = (khronos & 0xFFFFFFFF).to_bytes(4, "big")
        for i in range(4):
            known[16 + i] = w[16 + i] ^ kb[i]
    unknown = tuple(
        [i for i in range(4, 8) if stub is None] + [i for i in range(8, 12) if cookie is None]
        + [i for i in range(16, 20) if khronos is None]
    )
    if stub is not None:
        sb = (stub + b"\x00" * 4)[:4]
        for i in range(4):
            known[4 + i] = w[4 + i] ^ sb[i]
    if cookie is not None:
        cb = (cookie + b"\x00" * 4)[:4]
        for i in range(4):
            known[8 + i] = w[8 + i] ^ cb[i]
    return PartialTable(f=f, known=known, unknown=unknown, source=source)


#: 真机番茄（38.7.0）3 条样本反解出的表：**每条只有 12/20 字节**，
#: 缺的 ``T[4:8]`` / ``T[8:12]`` 被 stub / cookie 遮蔽（真机样本未记录这两个字段）。
#: 用途：判定「手上某张表是不是真机这条样本用的那张」；**不可拿去签名**。
REAL_DEVICE_PARTIAL_TABLES: Dict[int, PartialTable] = {
    0xF020: PartialTable(
        0xF020,
        {0: 0xE0, 1: 0xF7, 2: 0x33, 3: 0xBD, 12: 0x5C, 13: 0xAA, 14: 0x38, 15: 0x52,
         16: 0xC1, 17: 0xF2, 18: 0x18, 19: 0xB4},
        (4, 5, 6, 7, 8, 9, 10, 11),
        "tests/fixtures/fanqie_samples.json[0] (batch_full)",
    ),
    0xF040: PartialTable(
        0xF040,
        {0: 0xF8, 1: 0x92, 2: 0x93, 3: 0xCA, 12: 0x49, 13: 0xE0, 14: 0x6C, 15: 0xAC,
         16: 0xAF, 17: 0xAC, 18: 0x82, 19: 0x69},
        (4, 5, 6, 7, 8, 9, 10, 11),
        "tests/fixtures/fanqie_samples.json[2] (search)",
    ),
    0xF060: PartialTable(
        0xF060,
        {0: 0x98, 1: 0x82, 2: 0xF3, 3: 0xDF, 12: 0x44, 13: 0xC3, 14: 0x4B, 15: 0xA9,
         16: 0xFE, 17: 0xA9, 18: 0xB8, 19: 0xB8},
        (4, 5, 6, 7, 8, 9, 10, 11),
        "tests/fixtures/fanqie_samples.json[1] (book_info)",
    ),
}


def usable_fs() -> Tuple[int, ...]:
    """**可以直接拿来签名**的 ``F``：表已完整反解（仓库内 13 个，全部在 unidbg 族）。"""
    return tuple(sorted(int(k, 16) for k in TABLES_387))


# ------------------------------------------------------------------ 证伪清单


@dataclass(frozen=True)
class FalsifiedRule:
    """一条被数据否定的候选规则。``sources`` 必须给出可回读的数据坐标。"""

    verdict: str                 # "已被数据否定" / "部分否定"
    evidence: str
    sources: Tuple[str, ...] = field(default_factory=tuple)


#: ``F`` 推进规则的候选假设裁定表（细节见 ``docs/gorgon387-f-rule-status.md``）。
FALSIFIED_RULES: Dict[str, FalsifiedRule] = {
    "F1 周期假设（+2/+8 交替固定节奏）": FalsifiedRule(
        "已被数据否定",
        "run A 为 7,2,8,2,8,2,8,2,8,2,8,2,1；同一 harness 的 run B 为 7,2,2,1（驻留长度随 run 变）",
        ("tests/data/gorgon387_families.json", "tests/test_neptune387.py SWEEP"),
    ),
    "F2 与调用序号严格挂钩": FalsifiedRule(
        "已被数据否定",
        "第 1 次调用：run A=0x4a80 / run B=0x4ae0 / harness 番茄=0x4ac0 ⇒ 同一序号不唯一",
        ("tests/data/gorgon387_families.json", "tests/test_neptune387.py SWEEP",
         "tests/data/fanqie_live_so_387.json"),
    ),
    "F3 与 khronos（墙钟）耦合": FalsifiedRule(
        "已被数据否定",
        "同一 khronos 两个 F：真机样本 [0]/[1] 的 X-Khronos 同为 1785585278，F = 0xf020 / 0xf060；"
        "反向：perseus387_headers24 的 27 条样本 khronos 跳了 11 小时，F 恒 0x4a80",
        ("tests/fixtures/fanqie_samples.json", "tests/data/perseus387_headers24.json"),
    ),
    "F4 F 是 in20（url/stub/cookie）的函数": FalsifiedRule(
        "已被数据否定",
        "run A 的 60 次调用 query/stub/cookie 全程不变，F 却推进 12 次（不需要输入变化）；"
        "同文件 reps 7-8 与 9-16 的代表 khronos 同为 …467、query/stub 全程固定，F 却为 0x4aa0 vs 0x4ac0 "
        "（与 docs/x-gorgon-387-family.md §否定证据① 的『同一 in20 两个 F』实测一致）",
        ("tests/data/gorgon387_families.json", "docs/x-gorgon-387-family.md"),
    ),
    "F5 F 是单调递增计数器": FalsifiedRule(
        "已被数据否定",
        "真机 0xf020→0xf060→0xf040（第二次 -0x20 回退）；run B 0x4b80→0x4b60；run A 同值可驻留 7 次",
        ("tests/fixtures/fanqie_samples.json", "tests/test_neptune387.py SWEEP",
         "tests/data/gorgon387_families.json"),
    ),
    "F6 表 / 前缀按每次调用轮转": FalsifiedRule(
        "部分否定",
        "run A 第 1–7 次调用全部 0x4a80（同一张表连用 7 次）⇒ 「每调用轮转」不成立；"
        "但「地址式状态量（同一地址被反复复用到）」不被否定",
        ("tests/data/gorgon387_families.json",),
    ),
}

#: 与 ``T`` 的取值有关的**假线索**记录（省得后人重复劳动）。
FALSE_LEADS = {
    "13 张表的 260 字节里高位=1 占 202/260（77.7%，+8.9σ）":
        "不是 T 的性质：cascade 是双射，偏置来自样本集的 in20（16/20 字节最高位恒 0）"
        "→ body 最低位置 0 偏置（139/260）经 bitrev8 翻到 w／T 的最高位；"
        "用均匀随机 in20 做对照即回到 51%。",
}
