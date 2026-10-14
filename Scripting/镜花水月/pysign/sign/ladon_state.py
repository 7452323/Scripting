"""抖音 38.7.0 X-Ladon **同进程连签状态维度**模型。

背景
----
``sign.ladon.make_x_ladon_387`` 是「**新进程内首次签名**」的闭式，27/27 真机样本
逐字节命中。但同一进程内连续签名（harness ``-Dsignrepeat=N``）时，X-Ladon 会在

* **真值**（byte0 = ``0xEC``）与
* **退化值**（byte0 = ``0x00``）

之间按调用序号奇偶交替，且真值之间还有确定性漂移 —— 即 X-Ladon **不是**
X-Khronos 的纯函数，而是 ``f(kh, 进程内调用状态)``。

本模块把「进程内调用状态」显式建模出来。数据共 **11 个独立进程 / 63 次调用**：
``tests/data/ladon387_repeat_runs.json``（3 run / 17 调用，§70/§71 原始证据）
＋ ``tests/data/ladon387_repeat_ext.json``（8 run / 46 调用，本轮扩展证据）。

模型（给定进程状态后）
----------------------
设 ``n`` 为 1-based 调用序号、``kh`` 为 X-Khronos、``BE`` 为 X-Ladon 四字节按大端
读成的 32 位整数：

* ``n == 1``：``BE = ladon_be_387(kh)``（闭式，与状态无关）。
* ``n`` 为偶数：``BE = 退化值``（byte0 == 0，≡ 0 mod 16）。
* ``n`` 为奇数且 ``n > 1``：``BE = 闭式高 20 位(kh) | low12``，其中

  ``low12 = (0x7FE - 16 * ((kh & 0xFF) + D)) & 0xFFF``，``D`` 是进程内漂移。

``D`` 是**进程级自由量**（第 ``ord = (n+1)//2`` 个奇调取 ``drift[ord]``）。
``make_x_ladon_387_repeat(kh, n, state)`` 是直接可调用的入口。

======================  docstring 结论分级  ======================

【已验证】（有本轮 63 次调用的逐字节证据）
------------------------------------------
V1. ``n = 1`` 恒等于闭式 ``ladon_be_387(kh)``，与状态无关。11/11 进程首调命中。
V2. **非退化调用的高 20 位恒等于闭式的高 20 位**（状态只动低 12 位）。37/37，0 违反。
V3. ``n`` 为偶数 → 退化值：byte0 == 0x00 且 ≡ 0 (mod 16)。26/26 命中。
V4. 退化值**不是**单一常量；实测 ``{0x480, 0x490, 0x4A0, 0x4B0, 0x4F0, 0x530}``，
    且同一进程内也会变化（``rep11_1``：``0x480 → 0x4B0 → 0x530``）。
V5. 非退化调用的低 12 位满足 ``low12 = (0x7FE - 16*((kh&0xFF)+D)) & 0xFFF``：
    **给定每进程的 ``D`` 序列后，全部 63 次观测逐字节命中**（``test_*_reproduces_*``）。
V6. ``D`` **不是** ``(n, kh)`` 的函数：同一序号跨进程取 ``±16``；16 个进程存在
    「同 kh 多值」。故模型对 ``n >= 2`` 必须携带状态，否则显式报错。
V7. ``D`` 实测取值集合（精确）：
    ``{0, 15, 16, -16, 23, 24, -24, 7, -17, -10, -25, -57, -59}``
    —— 以 ±16 / ±24 为主，另有 ±1 抖动与少数大偏移。
V8. 10/11 进程内 ``D`` 符号恒定；``rep11_1`` 在第 5 个奇调**由正翻负**
    （``+23 → -57``）。

【推测】（证据支持但未定论，**不要当结论用**）
----------------------------------------------
P1. ``D`` 的**主形态**是 ``0, s·16, s·24, s·24, …``（``s = ±1`` 为进程级符号），
    即 §77「干净模型」的形态。仅给 1 个进程级符号位时，该形态命中 26/37 个奇调。
P2. 观测到的偏差是叠加在 P1 上的小抖动（``23=24-1``、``15=16-1``、``-17=-(16+1)``）
    与偶发大偏移（``rep11_1`` 的 ``-57/-59``、``rep5_5`` 的 ``-25``、``rep5_4`` 的 ``-10``）。
P3. 退化值是**本次调用未写入**的残留缓冲内容（故 byte0 恒 0、恒 ≡ 0 mod 16），
    因此随进程内历史变化。
P4. ``D`` 来自 native 侧一个**每进程初始化、随调用演进**的计数器 / 缓冲区偏移，
    初值携带 ASLR 熵 ⇒ 进程内确定、跨进程不可预测。可同时解释「符号跨进程不同」
    与「与 kh 无关」。

【未知】（无证据，不得据此下结论）
----------------------------------
U1. ``D`` 的**生成律**：为什么是 ±16 / ±24？±1 抖动从哪来？``rep11_1`` 为何翻转？
U2. 退化值的生成律与取值集合的边界（实测 6 个值是否穷尽，未知）。
U3. 状态能否被主动重置；是否与 ``signrepeat`` 之外的维度（并发、不同 API 路径）耦合。
U4. 静态路线未成功：``/root/research/apk/so/dis.txt`` 的 header 发射循环被 OLLVM
    混淆，未能定位状态变量（本项标**无信息**，不构成反证）。

对「D 来源」三个候选假设的裁定
------------------------------
* **是调用计数 n 吗？** —— 否，**已证伪**（V6：同一序号跨进程取 ±16）。
* **是前一次的中间值吗？** —— 无支持。同一「前一次 eff」（如 ``eff=55``）在不同
  进程给出的 ``D`` 覆盖 ``{-16, -24, +16, +24}`` ⇒ ``D ≠ f(前次中间值)``。
* **是某个内部 tick 吗？** —— **未定论**。与「单调递增 tick」不符（``run1/run2``
  递减、``rep11_1`` 非单调），但「非单调内部状态」仍可能；需 native 侧探针。

用法
----
>>> from sign.ladon_state import make_x_ladon_387_repeat, classic_state
>>> make_x_ladon_387_repeat(1791377688, 1)                     # 首调：无需状态
'7ApGfg=='
>>> make_x_ladon_387_repeat(1791377688, 3, classic_state(-1))  # 同进程第 3 次调用（主形态）
'7ApHfg=='

要精确复现某个进程，先用 ``infer_state(run["samples"])`` 从该进程自身的观测标定
出 ``LadonState``，再把它传给 ``make_x_ladon_387_repeat``。
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Iterable

from .ladon import ladon_be_387, make_x_ladon_387

__all__ = [
    "DEGENERATE_LADON_BE",
    "DEGENERATE_SET",
    "LadonState",
    "classic_state",
    "drift_from_ladon",
    "first_call_be",
    "first_call_x_ladon",
    "infer_state",
    "make_x_ladon_387_repeat",
    "predict_be",
    "predict_x_ladon",
]

#: 最常见的退化值（byte0 == 0x00，≡ 0 mod 16）。
DEGENERATE_LADON_BE = 0x00000480

#: 实测出现过的全部退化值（见 tests/data/ladon387_repeat_ext.json）。
DEGENERATE_SET = frozenset({0x480, 0x490, 0x4A0, 0x4B0, 0x4F0, 0x530})

_LOW12_BASE = 0x7FE  # 闭式低 12 位的基（线性项 (kh & 0xff) 的系数是 -16）


def _pick(seq: tuple, k: int):
    """取第 k 个（0-based）；越界则沿用最后一个。"""
    if not seq:
        raise ValueError("空序列")
    return seq[min(k, len(seq) - 1)]


@dataclass(frozen=True)
class LadonState:
    """一个进程内连签的状态维度。

    字段
    ----
    drift:
        ``drift[ord-1]`` = 第 ``ord`` 个**奇数次**调用（ord = 1, 2, ...）相对
        ``kh & 0xFF`` 的有符号漂移 ``D``。``drift[0]`` 必须为 0（首调闭式）。
        这是**逐序号的自由量**：模型不声称能从 ``(n, kh)`` 生成它（见模块 U1）。
    degenerate:
        ``degenerate[k]`` = 第 ``k+1`` 个**偶数次**调用（n = 2, 4, ...）返回的
        退化值；越界沿用最后一个。默认 ``(0x480,)``。

    形态约束（``__post_init__`` 强制）：``drift[0] == 0``；退化值 byte0 == 0
    且为 16 的倍数。
    """

    drift: tuple = (0,)
    degenerate: tuple = (DEGENERATE_LADON_BE,)

    def __post_init__(self) -> None:
        if not self.drift:
            raise ValueError("drift 至少要含首调的 0")
        if self.drift[0] != 0:
            raise ValueError("drift[0] 必须为 0（进程首调恒满足闭式）")
        for d in self.degenerate:
            if d % 16 != 0 or (d >> 24) != 0:
                raise ValueError(f"退化值形态非法: {d:#x}")

    # -- 查询 ----------------------------------------------------------
    def drift_for_ordinal(self, ordinal: int) -> int:
        """第 ``ordinal`` 个奇调（1-based）的漂移。"""
        if ordinal < 1:
            raise ValueError("ordinal 从 1 开始")
        return _pick(self.drift, ordinal - 1)

    def degenerate_for_even(self, even_ordinal: int) -> int:
        """第 ``even_ordinal`` 个偶调（1-based，即 n = 2*even_ordinal）的退化值。"""
        if even_ordinal < 1:
            raise ValueError("even_ordinal 从 1 开始")
        return _pick(self.degenerate, even_ordinal - 1)


def classic_state(sign: int = 1, degenerate: int = DEGENERATE_LADON_BE) -> LadonState:
    """【推测 P1】§77 的「干净」状态：``|D|`` 序列 ``0, 0x10, 0x18, 0x18``；退化值恒定。

    ``sign`` = +1 或 -1。这是 3 次老 run 观测到的形态，扩展数据表明它只是**主形态**
    （26/37 奇调命中），**不是**精确律（见 ``docs/ladon-state-model.md`` 的证伪一节）。
    """
    if sign not in (1, -1):
        raise ValueError("sign 只能是 +1 / -1")
    return LadonState(
        drift=(0, 0x10 * sign, 0x18 * sign, 0x18 * sign),
        degenerate=(degenerate,),
    )


def first_call_be(khronos: int) -> int:
    """进程首调（n = 1）：与状态无关的闭式。"""
    return ladon_be_387(khronos)


def first_call_x_ladon(khronos: int) -> str:
    """进程首调（n = 1）的 base64 X-Ladon（8 字符）。"""
    return make_x_ladon_387(khronos)


def _low12_with_drift(khronos: int, drift: int) -> int:
    eff = ((khronos & 0xFF) + drift) & 0xFF
    return (_LOW12_BASE - 16 * eff) & 0xFFF


def drift_from_ladon(khronos: int, ladon_be: int) -> int:
    """从一次**非退化**观测反推该调的漂移 ``D``（有符号，取值区间 −128..127）。

    这是 ``infer_state`` 的原子操作，也用于测试与文档对账。
    """
    low12 = ladon_be & 0xFFF
    eff = ((_LOW12_BASE - low12) // 16) % 256
    return ((eff - (khronos & 0xFF) + 128) % 256) - 128


def predict_be(n: int, khronos: int, state: LadonState | None = None) -> int:
    """预测第 ``n`` 次（1-based）调用的大端 32 位 X-Ladon。

    ``n == 1`` 时不需要 ``state``；``n >= 2`` 时必须给出 ``state``，否则抛错 ——
    这正是「X-Ladon 不是 kh 纯函数」的可执行表达（V6）。
    """
    if n < 1:
        raise ValueError("调用序号 n 从 1 开始")
    if n == 1:
        return first_call_be(khronos)
    if state is None:
        raise ValueError(
            f"n={n} 的 X-Ladon 依赖进程内状态（无法由 (n, kh) 推出），"
            "请传入 LadonState（可用 infer_state 从观测反推，或 classic_state 取主形态）"
        )
    if n % 2 == 0:
        return state.degenerate_for_even(n // 2)
    base = ladon_be_387(khronos)
    return (base & 0xFFFFF000) | _low12_with_drift(
        khronos, state.drift_for_ordinal((n + 1) // 2)
    )


def predict_x_ladon(n: int, khronos: int, state: LadonState | None = None) -> str:
    """``predict_be`` 的 base64 形式（8 字符），与真机 X-Ladon 同构。"""
    return base64.b64encode(predict_be(n, khronos, state).to_bytes(4, "big")).decode()


def make_x_ladon_387_repeat(
    khronos: int, call_index: int, state: LadonState | None = None
) -> str:
    """同进程第 ``call_index`` 次签名的 X-Ladon（base64，8 字符）—— **主入口**。

    参数
    ----
    khronos:    该次调用的 X-Khronos（uint32）。
    call_index: 进程内 1-based 调用序号 ``n``。
    state:      ``LadonState``；``call_index == 1`` 时可省略（闭式），
                ``call_index >= 2`` 时**必须**提供，否则抛 ``ValueError``。

    返回值：``base64(BE 的 4 个大端字节)``。

    说明
    ----
    ``call_index >= 2`` 的取值依赖进程级自由量 ``D``（U1 未解），**不能**由
    ``(kh, n)`` 推出。要精确复现某进程，先用 ``infer_state`` 从该进程的观测标定；
    只想取「主形态」则用 ``classic_state(±1)``（26/37 命中，**非精确**）。
    """
    return predict_x_ladon(call_index, khronos, state)


# ------------------------------------------------------------------ 状态反推

def infer_state(samples: Iterable) -> LadonState:
    """从同一进程的观测样本反推状态（**标定**，非外推）。

    ``samples`` 为可迭代 dict，至少含 ``idx`` / ``khronos`` / ``ladon_be``
    （``ladon_be`` 为 16 进制字符串）。

    ``drift`` 是逐序号的自由量：模型**不**声称能从 ``(n, kh)`` 预测它
    （见模块 U1）；本函数只把观测编码成可复用的状态对象，使模型能 100% 复现该进程。
    """
    drift: list[int] = []
    degen: list[int] = []
    for s in sorted(samples, key=lambda x: int(x["idx"])):
        idx = int(s["idx"])
        kh = int(s["khronos"])
        be = int(str(s["ladon_be"]), 16)
        if idx % 2 == 0:
            degen.append(be)
            continue
        ordinal = (idx + 1) // 2
        while len(drift) < ordinal:
            drift.append(0)
        if ordinal == 1:
            drift[0] = 0
        else:
            drift[ordinal - 1] = drift_from_ladon(kh, be)
    if not drift:
        raise ValueError("样本里没有奇数次调用")
    return LadonState(drift=tuple(drift),
                      degenerate=tuple(degen) or (DEGENERATE_LADON_BE,))
