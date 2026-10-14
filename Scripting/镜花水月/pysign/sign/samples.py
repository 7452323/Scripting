"""
sign.samples — 真机抓包样本校验。

样本 JSON 里每个条目是一次真实请求抓到的签名头，外加 `*_raw` 的原始字节
repr（例如 ``X-Helios_raw: "b'\\x89od~...'"``）。本模块把这些头重新过一遍
本地实现，报告哪些能复现、哪些不能、哪些缺输入无法判定。

⚠️ 样本只有签名头，没有当时的 cookie / body / 完整 query，所以依赖完整请求
上下文的算法（X-Gorgon 的 cookie 段、X-Argus 的 query 摘要）无法离线复现。
本模块对这类头标记为 ``skipped`` 并说明缺什么，绝不假装验证过。

样本结构（番茄小说 aid=1967 抓包）::

    {
      "X-Khronos": "1785585278",
      "X-Gorgon":  "840460f00000eea1ecc577c8f7ce3d2eb5976a4777995abfeeaa",
      "X-Helios":  "6wIPJnL0/ZiOuZOH3YD2/LBKKS30n2Z2lL8vXa1mRx7msZcX",
      "X-Helios_raw": "b'\\xeb\\x02\\x0f&...'",
      "_url": "https://api5-normal-sinfonlineb.fqnovel.com/...",
      "_label": "book_info"
    }
"""

import ast
import base64
import re

from . import helios as _helios

# 解密验证时按顺序试的 App 编号；只有正确的 aid 会解出合法明文。
_HELIOS_AIDS = (1967, 8662, 1128, 3019, 2329)


def _raw_of(sample, name):
    """把样本里的 ``<name>_raw``（bytes 的 repr）解回 bytes。"""
    raw = sample.get(f"{name}_raw")
    if raw is None:
        return None
    try:
        value = ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return None
    if isinstance(value, str):
        value = value.encode("latin-1")
    return bytes(value)


def _check_b64_matches_raw(sample, name):
    """头本身应是 raw 的 base64（去 padding 后比对）。"""
    raw = _raw_of(sample, name)
    head = sample.get(name)
    if raw is None or head is None:
        return None
    want = base64.b64encode(raw).decode().rstrip("=")
    return head.rstrip("=") == want


# 每个头一个判定函数：返回 (status, note)，status ∈ {passed, failed, skipped}
def _v_khronos(sample):
    v = sample.get("X-Khronos")
    if not v:
        return "skipped", "样本里没有这个头"
    if re.fullmatch(r"\d{10}", v):
        return "passed", "10 位秒级时间戳"
    if re.fullmatch(r"[0-9a-f]{8}", v):
        return "passed", "8 位 hex 时间戳"
    return "failed", f"时间戳格式异常: {v!r}"


def _v_gorgon(sample):
    v = sample.get("X-Gorgon")
    if not v:
        return "skipped", "样本里没有这个头"
    if not re.fullmatch(r"[0-9a-f]{52}", v):
        return "failed", f"长度/字符集异常（期望 52 hex）: {len(v)}"
    if not (v.startswith("8404") or v.startswith("0404")):
        return "failed", f"前缀异常: {v[:4]}"
    return "skipped", "格式正确；复现需要当时的 cookie/body（样本未含）"


def _v_base64_head(sample, name, expected_len=None):
    v = sample.get(name)
    if not v:
        return "skipped", "样本里没有这个头"
    try:
        raw = base64.b64decode(v + "=" * (-len(v) % 4), validate=True)
    except Exception as e:
        return "failed", f"不是合法 base64: {e}"
    if expected_len is not None and len(raw) != expected_len:
        return "failed", f"解码 {len(raw)} 字节，期望 {expected_len}"
    same = _check_b64_matches_raw(sample, name)
    if same is False:
        return "failed", "头与 *_raw 不一致"
    return "skipped", f"格式正确（{len(raw)} 字节）；复现需要密钥/明文（样本未含）"


def _helios_roundtrip(sample, name):
    """X-Helios / X-Ladon 是 SPECK-128/256，可离线解密验证。

    用每个候选 aid 解一遍，只有明文形如 ``{khronos}-{license}-{aid}``
    且第一段与 X-Khronos 完全一致才算通过——猜错 aid 只会得到随机字节。
    """
    v = sample.get(name)
    if not v:
        return "skipped", "样本里没有这个头"
    try:
        base64.b64decode(v + "=" * (-len(v) % 4), validate=True)
    except Exception as e:
        return "failed", f"不是合法 base64: {e}"

    khronos = sample.get("X-Khronos")
    for aid in _HELIOS_AIDS:
        res = _helios.verify(v, aid)
        if not res.get("ok"):
            continue
        if khronos and str(res["khronos"]) != str(khronos):
            continue
        return "passed", (
            f"解密还原 {res['plaintext']!r}（aid={aid}, head={res['head']}）"
        )
    return "failed", "所有候选 aid 均解不出合法明文"


def _v_helios(sample):
    return _helios_roundtrip(sample, "X-Helios")


def _v_ladon(sample):
    return _helios_roundtrip(sample, "X-Ladon")


def _v_argus(sample):
    return _v_base64_head(sample, "X-Argus")


def _v_medusa(sample):
    """X-Medusa 的**信封**可以离线验证，正文不行。

    信封 = 20 字节版本块 ⊕ khronos ‖ 2 字节随机 ‖ 2 字节长度标记(0x0100)。
    这三段在 3 条番茄小说真机抓包上逐字节吻合。正文需要 sign_key 与完整明文，
    样本里没有，所以复现不了。
    """
    v = sample.get("X-Medusa")
    if not v:
        return "skipped", "样本里没有这个头"
    kh = sample.get("X-Khronos")
    if not kh:
        return _v_base64_head(sample, "X-Medusa")

    from . import medusa as _medusa

    try:
        env = _medusa.parse_envelope(v, int(kh))
    except Exception as e:
        return "failed", f"信封解析失败: {e}"

    if env["marker"] != _medusa.LENGTH_MARKER:
        return "failed", (
            f"长度标记 {env['marker']} != 期望 {_medusa.LENGTH_MARKER}"
        )

    note = (
        f"信封逐字节吻合：version={env['version']}、长度标记={env['marker']}、"
        f"raw={env['raw_len']}B"
    )
    if env["app"]:
        note += f"、版本块匹配已知的 {env['app']} 常量"
    else:
        note += f"、版本块 {env['version_block']} 不在已知常量表里"
    note += f"；正文 {env['body_len']}B 需 sign_key，离线复现不了"
    return "passed", note


def _v_soter(sample):
    v = sample.get("X-Soter")
    if not v:
        return "skipped", "样本里没有这个头"
    from . import soter as _soter

    try:
        raw = base64.b64decode(v + "=" * (-len(v) % 4))
    except Exception as e:
        return "failed", f"不是合法 base64: {e}"
    if _soter.is_known(v):
        return "passed", (
            f"与已知常量逐字节一致（{len(raw)} 字节 = 4 字节标记 + 全零填充）"
        )
    return "skipped", (
        f"格式正确（{len(raw)} 字节），但与已知常量不同——可能是设备级取值"
    )


def _v_perseus(sample):
    """X-Perseus 没有公开的纯算实现，只能记一笔。"""
    v = sample.get("X-Perseus")
    if not v:
        return "skipped", "样本里没有这个头"
    return "skipped", (
        f"长度 {len(v)}；全网无公开纯算实现（只有 unidbg/Frida 桥接），无法离线校验"
    )


VERIFIERS = {
    "X-Khronos": _v_khronos,
    "X-Gorgon": _v_gorgon,
    "X-Helios": _v_helios,
    "X-Ladon": _v_ladon,
    "X-Argus": _v_argus,
    "X-Medusa": _v_medusa,
    "X-Soter": _v_soter,
    "X-Perseus": _v_perseus,
}


def verify_sample(sample, verifiers=None):
    """校验单个样本，返回 {header: {status, note}}。"""
    verifiers = verifiers or VERIFIERS
    out = {}
    for name, fn in verifiers.items():
        try:
            status, note = fn(sample)
        except Exception as e:  # 校验器自身崩了也算 failed，别吞
            status, note = "failed", f"校验器异常: {type(e).__name__}: {e}"
        out[name] = {"status": status, "note": note}
    return out


def verify_sample_file(samples):
    """校验样本列表，返回汇总报告。"""
    if isinstance(samples, dict):
        samples = samples.get("samples", [samples])

    counts = {"passed": 0, "failed": 0, "skipped": 0}
    entries = []
    for i, s in enumerate(samples):
        res = verify_sample(s)
        for r in res.values():
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        entries.append({
            "index": i,
            "label": s.get("_label", ""),
            "url": s.get("_url", ""),
            "headers": res,
        })

    return {
        "samples": len(samples),
        "passed": counts["passed"],
        "failed": counts["failed"],
        "skipped": counts["skipped"],
        "details": entries,
    }
