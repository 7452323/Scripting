# -*- coding: utf-8 -*-
"""X-Medusa 38.7.0 —— 常量的**独立反解器**（只用仓库既有数据，不跑 unidbg）。

本模块不引入任何新常量，只做一件事：把 `sign/medusa387.py` /
`sign/aes_v3_bits.py` 里那些「静态逐条解码得到」的常量，**用真机 golden 反解一遍**，
从而把置信度从「静态解码（高）」提升到「运行时钉死（最高）」。

反解的三组问题

1. **旋转位道映射**（`K_ROT_TABLE_387` / `BIT_MAP`）
   数据：`tests/data/aes_v3_bits_live_387.json`（3 个独立 run 的
   `sum_in`(31B) / `base_T`(256B，写前缓冲) / `sum_key`(256B，写后缓冲) / `mix_out`(31B)）。
   真机语义是**选择性位写**：对字节 `i` 的位 `b`，
   `key[qi*8+qb] 的 lane = (r+K_b)&7` 被置成该位，其余位保持写前的 T 不变。于是
   - `sk^bt` 只有 0 或 1 个 bit（位道结构），由此读回 **lane**；
   - 写入值就是**结果位**本身 ⇒ `bit_b(si[i]) == (sk[idx]>>lane)&1`，由此读回 **源位 b**；
   31 个字节位置 × 3 个 run 交叉取交 ⇒ 唯一解。**不需要假设任何映射形式**。
   （注意：`(r+K)&7` 里的 `r` 在本数据里恒为 0 —— 见 `rotation_term_covered()`。）

2. **轮常量**（`xor_c`(=红果 `r_con2` 的 V0 项) / `sr_order` / `copy` / `mc_rows`）
   数据：`ROUND_HEAD_GOLDEN_387` / `ROUND2_GOLDEN_387`（hook 轮函数入口/出口）。
   - 列配对 `c`：`out[4i+j] = st[4i+j] ^ key[4i+c[j]]`，24 个排列全枚举 ⇒ **唯一**；
   - 复合字节置换：`post_SR[k] = sbox[state[perm[k]]]`，按**多重集**枚举全部一致置换；
   - `sr_order`：由复合置换 + 已知 `s_perm` 反解（唯一时）；
   - `(copy, mc_rows)`：用 `mc_out` 的 15 个可信字节枚举验证。

3. **长变体输入 + 信封**（`build_data_387` / `VERSION_DWORDS_387` / `rand_from_envelope`）
   数据：`medusa387_golden_long.json`（1 条完整 golden）+
   `medusa387_harvest54.json`（54 条真 token）。
   - 尾部直通：`C[248:] == data[248:]`（548B 逐字节）；
   - 稀疏层「每字节最多翻 1 bit」；
   - 54/54 条 token 的 5 个 dword 逐项 XOR 必须得到**同一个** khronos。

置信度边界（本模块**不**声称解决的，见 `docs/medusa387-gap-status.md`）：
`sign_key` 的**来源**、`(r+K)` 里的 `r>0` 段、短变体（32B token）的 `data` 布局、
AES_V3 块函数本体（VMP）、`key2` 的闭式，以及 L29 那条「每字节最多 1 bit」背后的
**具体**翻转规律（数据只够证伪当前模型，不够定案）。
"""

from __future__ import annotations

import base64
import collections
import itertools
import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
_DATA = os.path.join(_ROOT, "tests", "data")

LIVE_BITS_JSON = os.path.join(_DATA, "aes_v3_bits_live_387.json")
LONG_GOLDEN_JSON = os.path.join(_DATA, "medusa387_golden_long.json")
HARVEST_JSON = os.path.join(_DATA, "medusa387_harvest54.json")


# ─────────────────────────────────────────────── 0. 数据装载

def load_live_runs(path: str = LIVE_BITS_JSON) -> dict:
    """读 `aes_v3_bits_live_387.json`，返回 {meta..., 'runs': [ {si,bt,sk,mk,mo} ]}。"""
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    runs = []
    for r in raw["runs"]:
        runs.append({
            "si": bytes.fromhex(r["sum_in"]),    # 源字节（写入值）
            "bt": bytes.fromhex(r["base_T"]),    # 写前缓冲（堆垃圾 T）
            "sk": bytes.fromhex(r["sum_key"]),   # 写后缓冲
            "mk": bytes.fromhex(r["mix_key"]),   # mix 入口读到的缓冲
            "mo": bytes.fromhex(r["mix_out"]),   # collect 的输出
        })
    return {
        "w1_keybuf_bytes": raw.get("w1_keybuf_bytes"),
        "qwords": raw.get("qwords"),
        "runs": runs,
    }


# ─────────────────────────────────── 1. 旋转位道映射（K 表）反解

def multibit_deltas(runs) -> list:
    """返回 `sk^bt` 里单字节出现 >1 个 bit 的 (run, idx) —— 应恒为空集。

    这是「选择性位写」这一结构先验的**可证伪**形式：若映射不是逐位覆写，
    这里会立刻炸出来。
    """
    bad = []
    for ri, r in enumerate(runs):
        for idx in range(min(len(r["sk"]), len(r["bt"]))):
            d = r["sk"][idx] ^ r["bt"][idx]
            if bin(d).count("1") > 1:
                bad.append((ri, idx, d))
    return bad


def solve_bit_dispatch(runs, nbytes: int = 31) -> dict:
    """从 (si, bt, sk) 反解位道映射：`qb -> (lane, src_bit)`。

    对每个输出字节 `idx = i*8 + qb`：
      * `lane`  = 唯一那个「所有 run 的 `sk^bt` 都只可能落在这里」的位号
                  （若三次 `sk^bt` 全为 0，则这一位未能定位 ⇒ 由交叉取交补齐）；
      * `src_bit` = 满足 `bit_b(si[i]) == (sk[idx]>>lane)&1`（3 个 run 同时成立）的 `b`。
    31 个字节位置对同一个 `qb` 取交后应得**唯一** (lane, src_bit)。

    返回 `{qb: (lane, src_bit)}`；无法唯一确定时抛 `ValueError`（宁失败不猜）。
    """
    n = len(runs)
    assert n >= 2, "至少需要 2 个 run 才能交叉取交"
    lanes = {}
    for idx in range(nbytes * 8):
        ds = [r["sk"][idx] ^ r["bt"][idx] for r in runs]
        ok = {l for l in range(8) if all(x == 0 or x == (1 << l) for x in ds)}
        if not ok:
            raise ValueError("idx %d: sk^bt 不是 0/单 bit（位道结构不成立）" % idx)
        lanes[idx] = ok

    per_qb = {}
    for qb in range(8):
        inter = None
        for i in range(nbytes):
            idx = i * 8 + qb
            cs = set()
            for l in lanes[idx]:
                for b in range(8):
                    if all(((r["si"][i] >> b) & 1) == ((r["sk"][idx] >> l) & 1)
                           for r in runs):
                        cs.add((l, b))
            inter = cs if inter is None else (inter & cs)
        if len(inter) != 1:
            raise ValueError("qb=%d 不能唯一定位：%r" % (qb, sorted(inter)))
        per_qb[qb] = inter.pop()
    return per_qb


def dispatch_as_bit_map(per_qb: dict) -> dict:
    """把 `{qb: (lane, src_bit)}` 转成 `aes_v3_bits.BIT_MAP` 的形式
    `{src_bit: (qb, K)}`（取 `K = lane`，即 r == 0 的那一档）。"""
    return {b: (qb, lane) for qb, (lane, b) in per_qb.items()}


def bit_map_normalized(bit_map: dict) -> dict:
    """把 `K` 统一到 `K & 7`。

    `BIT_MAP[0] == (5, -1)` 是 `(r + (-1)) & 7` 在 r = 0 时的写法，
    与 `lane = 7` 等价。反解器只能观察到 lane 本身，因此比较必须在 mod 8 下做，
    否则会出现「物理上相等、字典上不等」的假阴性。
    """
    return {b: (qb, k & 7) for b, (qb, k) in bit_map.items()}


def rotation_term_covered(cfg: dict) -> bool:
    """`(r+K)&7` 里的 `r = i // qwords` 是否被该数据覆盖（即存在 r>0 的样本）。

    真机 `w1 = 795` 字节 ⇒ `qwords = 99`（见 golden 元数据）；
    `len(data) = 31 < 99` ⇒ 单次调用内 **r 恒为 0**。也就是说：
    golden 只钉死了 `K_b` 本身，`+r` 那一项**在本数据里不可观测**。
    """
    q = cfg.get("qwords") or max(1, len(cfg["runs"][0]["si"]))
    return any(len(r["si"]) > q for r in cfg["runs"])


def reproduce_live(cfg: dict) -> dict:
    """用仓库里的 `sum_data`/`mix_columns` 逐 run 复算 golden，返回命中统计。"""
    from .aes_v3_bits import mix_columns, sum_data

    q = cfg.get("qwords") or 31
    nbytes = len(cfg["runs"][0]["si"])
    out = {"sum_hits": 0, "sum_total": 0, "mix_hits": 0, "mix_total": 0}
    for r in cfg["runs"]:
        n = nbytes * 8
        got = sum_data(r["si"], q, r["bt"])[:n]
        out["sum_hits"] += sum(1 for a, b in zip(got, r["sk"][:n]) if a == b)
        out["sum_total"] += n
        got2 = mix_columns(bytes(nbytes), r["bt"], q)[:nbytes]
        out["mix_hits"] += sum(1 for a, b in zip(got2, r["mo"]) if a == b)
        out["mix_total"] += nbytes
    return out


# ─────────────────────────────────── 2. 轮常量反解

def solve_xor_column(st_in: bytes, key: bytes, out: bytes) -> list:
    """解 `out[4i+j] = st_in[4i+j] ^ key[4i+c[j]]` 的列配对 `c`（24 排列全枚举）。

    返回全部一致的 `c`（真机数据上应恰有一个 —— 也就是可证伪的强约束）。
    """
    hits = []
    for c in itertools.permutations(range(4)):
        if all(out[4 * i + j] == st_in[4 * i + j] ^ key[4 * i + c[j]]
               for i in range(4) for j in range(4)):
            hits.append(c)
    return hits


def consistent_compound_perms(sub: bytes, post_sr: bytes) -> list:
    """解 `post_SR[k] == sbox[state[perm[k]]]` 的全部一致置换。

    按**多重集**处理（值有重复时会有多个候选）—— 这正是
    「只取 `.index()` 第一个命中」的写法会给出**错**答案的情形。
    """
    out = []

    def rec(k, used, acc):
        if k == 16:
            out.append(tuple(acc))
            return
        for idx in range(16):
            if idx in used or sub[idx] != post_sr[k]:
                continue
            rec(k + 1, used | {idx}, acc + [idx])

    rec(0, set(), [])
    return out


def compound_perm_claim(spec: dict) -> tuple:
    """声称的 `s_perm` + `sr_order` 的**复合**位置映射（观测量）。

    `new_S[j] = sbox[st[4*sp[j//4] + j%4]]`，`new_SR[i] = new_S[sr[i]]`
    ⇒ `perm[i] = 4*sp[sr[i]//4] + sr[i]%4`。
    """
    sp, sr = spec["s_perm"], spec["sr_order"]
    return tuple(4 * sp[sr[i] // 4] + sr[i] % 4 for i in range(16))


def sr_order_from_compound(perm: tuple, s_perm) -> tuple:
    """由复合置换与已知 `s_perm` 反解 `sr_order`（`s_perm` 是 0..3 的排列）。"""
    inv_sp = {s_perm[i]: i for i in range(4)}
    return tuple(4 * inv_sp[perm[i] // 4] + perm[i] % 4 for i in range(16))


def solve_tail_perms(after_SR: bytes, mc_out: bytes, limit: int = 15) -> list:
    """解 `(copy, mc_rows)`：`mc_out[:limit] == mix_columns(copy_perm(after_SR), mc_rows)`。

    `limit=15` 是因为真机 `MC_out` 的**末字节**是轨迹遗留值（MixColumns 的最后一次
    写入没落进轨迹），第 16 字节无真值可用（见 `medusa387.ROUND_HEAD_GOLDEN_387` 注释）。
    """
    from .medusa387 import _copy_perm, _mix_columns_rows

    hits = []
    for cp in itertools.permutations(range(4)):
        cpb = _copy_perm(after_SR, cp)
        for rows in itertools.permutations(range(4)):
            if _mix_columns_rows(cpb, rows)[:limit] == mc_out[:limit]:
                hits.append((cp, rows))
    return hits


def check_round_constants() -> dict:
    """把轮常量反解跑一遍，返回一份可断言的报告。

    含四块：
      * `round2_trailing`  : 4 个变体的**末尾 XOR 列配对**是否唯一且等于声称值；
      * `round2_roundtrip` : `round_2r_387` 能否逐字节复现 4 组 golden；
      * `head_xor_c`       : `ROUND_HEAD_GOLDEN_387` 各样本的 xor_c 候选（含是否唯一）；
      * `head_perm`        : 复合置换的候选数与「声称值 ∈ 候选集」。
    """
    from . import medusa387 as M

    rep = {
        "round2_trailing": {},
        "round2_roundtrip": {},
        "head_xor_c": {},
        "head_perm": {},
        "solved_sr_order": {},
        "tail_perms": {},
    }
    for v, (block, key48, out) in sorted(M.ROUND2_GOLDEN_387.items()):
        spec = M.ROUND_VARIANTS_387[v]
        sbox = M.load_sbox_variant(v)
        st = M._xor_column(block, key48[0:16], spec["xor_c"])
        st = M._sub_bytes_perm(st, sbox, spec["s_perm"])
        st = M._shift_rows_order(st, spec["sr_order"])
        st = M._copy_perm(st, spec["copy"])
        st = M._mix_columns_rows(st, spec["mc_rows"])
        st = M._xor_column(st, key48[16:32], spec["xor_c"])
        st = M._sub_bytes_perm(st, sbox, spec["s_perm"])
        st = M._shift_rows_order(st, spec["sr_order"])
        cands = solve_xor_column(st, key48[32:48], out)
        rep["round2_trailing"][v] = {
            "candidates": [tuple(c) for c in cands],
            "claim": tuple(spec["xor_c"]),
            "unique_and_matches": len(cands) == 1 and tuple(cands[0]) == tuple(spec["xor_c"]),
        }
        rep["round2_roundtrip"][v] = M.round_2r_387(v, block, key48) == out

    for v, samples in sorted(M.ROUND_HEAD_GOLDEN_387.items()):
        spec = M.ROUND_VARIANTS_387[v]
        sbox = M.load_sbox_variant(v)
        claim = compound_perm_claim(spec)
        for j, (block, key0, post_sr, mc_out) in enumerate(samples):
            if key0 is None:
                key0 = M.expand_key_387(M.CONFIG_KEY_387)[:16]
            hits = []
            for c in itertools.permutations(range(4)):
                st = M._xor_column(block, key0, c)
                sub = bytes(sbox[b] for b in st)
                if sorted(sub) == sorted(post_sr):
                    hits.append((c, sub))
            rep["head_xor_c"][(v, j)] = {
                "candidates": [tuple(c) for c, _ in hits],
                "claim": tuple(spec["xor_c"]),
                "unique_and_matches": len(hits) == 1 and tuple(hits[0][0]) == tuple(spec["xor_c"]),
            }
            for c, sub in hits:
                perms = consistent_compound_perms(sub, post_sr)
                rep["head_perm"][(v, j)] = {
                    "n_consistent": len(perms),
                    "claim_in_set": claim in perms,
                }
                if len(perms) == 1:
                    sr_solved = sr_order_from_compound(perms[0], spec["s_perm"])
                    rep["solved_sr_order"][(v, j)] = {
                        "sr_order": list(sr_solved),
                        "matches_claim": list(sr_solved) == list(spec["sr_order"]),
                    }
                if mc_out is not None:
                    sols = set()
                    for perm in perms:
                        # `after_S` 已经是**后 ShiftRows 态**（复合置换把 S 代换与
                        # shift_rows 一起吃掉了），不要再做一次 shift_rows。
                        after_S = bytes(sub[perm[i]] for i in range(16))
                        sols.update(solve_tail_perms(after_S, mc_out))
                    claim_cp = (tuple(spec["copy"]), tuple(spec["mc_rows"]))
                    rep["tail_perms"][(v, j)] = {
                        "n": len(sols),
                        "claim_in_set": claim_cp in sols,
                        "sole_solution_is_claim": len(sols) == 1 and next(iter(sols)) == claim_cp,
                    }
    return rep


# ─────────────────────────────────── 3. 长变体 / 信封

def long_variant_report(path: str = LONG_GOLDEN_JSON) -> dict:
    """核对长变体输入模板与稀疏层覆写边界（逐字节）。"""
    from .medusa387 import (SPARSE_OVERWRITE_387, build_data_387,
                            rand_from_envelope, version_block_387)

    with open(path, "r", encoding="utf-8") as fh:
        g = json.load(fh)
    tok = base64.b64decode(g["token_b64"] + "=" * (-len(g["token_b64"]) % 4))
    proto = bytes.fromhex(g["proto"])
    xout = bytes.fromhex(g["xmxor_out"])
    data = build_data_387(0, 0, xout, g["rand"])
    C = tok[25:]
    cut = SPARSE_OVERWRITE_387
    # 前 8 字节（0xa6 + xm_rand + check_bit）里 data[1:9] 未知，故只看 [9, cut)
    diffs = collections.Counter(bin(C[i] ^ data[i]).count("1") for i in range(9, cut))
    return {
        "token_len": len(tok),
        "C_len": len(C),
        "data_len": len(data),
        "version_block_ok": version_block_387(g["khronos"]) == tok[:20],
        "rand_ok": rand_from_envelope(tok) == g["rand"],
        "flags": tok[22:24].hex(),
        "k_byte": tok[24],
        "k_byte_matches_meta": tok[24] == g["k_byte"],
        "prefix": data[0],
        "proto_len": len(proto),
        "proto_len_equals_xmxor_out": len(proto) == len(xout),
        "data_len_relation": len(data) == 19 + len(xout),
        "tail_passthrough": C[cut:] == data[cut:],
        "tail_len": len(C) - cut,
        "diff_popcount_hist": dict(sorted(diffs.items())),
        "max_bits_per_byte": max(diffs) if diffs else 0,
    }


def harvest_report(path: str = HARVEST_JSON) -> dict:
    """54 条真 token 的信封核对（不依赖任何「假设」之外的东西）。"""
    from .medusa387 import PACKET_FLAGS_387, VERSION_DWORDS_387

    with open(path, "r", encoding="utf-8") as fh:
        h = json.load(fh)
    n = ok_ver = ok_flag = ok_k = 0
    khronos = []
    kbytes = collections.Counter()
    c0 = collections.Counter()
    lengths = collections.Counter()
    for key_hex, v in h.items():
        rb = bytes.fromhex(v["raw"])
        if bytes.fromhex(key_hex) != rb:
            continue                      # key 就是同一条 token 的 hex
        n += 1
        lengths[len(rb)] += 1
        if len(rb) <= 25:
            continue
        kh = {int.from_bytes(rb[i * 4:i * 4 + 4], "little") ^ VERSION_DWORDS_387[i]
              for i in range(5)}
        if len(kh) == 1:                   # 5 个 dword 必须解出同一个 khronos
            ok_ver += 1
            khronos.append(kh.pop())
        ok_flag += rb[22:24] == PACKET_FLAGS_387
        ok_k += 1                          # K 字节存在（见下）
        kbytes[rb[24]] += 1
        c0[rb[25]] += 1
    return {
        "n": n,
        "version_block_consistent": ok_ver,
        "flags_hl_hl": ok_flag,
        "k_byte_present": ok_k,
        "k_byte_distinct": len(kbytes),
        "khronos_min": min(khronos) if khronos else None,
        "khronos_max": max(khronos) if khronos else None,
        "khronos_distinct": len(set(khronos)),
        "raw_len_hist": dict(sorted(lengths.items())),
        "c0_values": dict(sorted(c0.items())),
    }


def key_material_report(path: str = os.path.join(_DATA, "medusa387_keyhash_vectors.json")) -> dict:
    """`sign_key` 的用法链自查：`SM3(sk ‖ rand_le ‖ sk) == key`（6/6）。

    ⚠️ 这**只是验证用法**，不是反解来源 —— SM3 原像不可求，
    6 组 (rand, key) 给不出 `sk` 的任何约束（见 gap 文档 §4）。
    """
    from .medusa387 import KEY_MATERIAL_GOLDEN_RAND_387, SIGN_KEY_387, derive_key_387

    with open(path, "r", encoding="utf-8") as fh:
        v = json.load(fh)
    hits = [derive_key_387(x["rand"]) == bytes.fromhex(x["key"]) for x in v["vectors"]]
    return {
        "n": len(hits),
        "hits": sum(hits),
        "sign_key_len": len(SIGN_KEY_387),
        "sign_key_is_32B": len(SIGN_KEY_387) == 32,
        "all_rand_u32": all(0 <= x["rand"] <= 0xFFFFFFFF for x in v["vectors"]),
        "invertible": False,   # SM3 原像：不可行
    }
