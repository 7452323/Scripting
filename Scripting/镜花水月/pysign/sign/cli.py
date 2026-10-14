"""
sign.cli — 命令行入口。

用法：
    python -m sign.cli mobile --path /aweme/v1/aweme/post/ --param sec_user_id=MS4wLjAB... --param count=6
    python -m sign.cli web    --path /aweme/v1/web/hot/search/list/ --param detail_list=1
    python -m sign.cli helios --profile fanqie
    python -m sign.cli helios --verify <48字符令牌> --aid 1967
    python -m sign.cli selftest
    python -m sign.cli verify-samples tests/fixtures/fanqie_samples.json

`mobile` / `web` / `helios` 只打印签名结果，不发请求；
`selftest` 跑一遍全部签名器的自检向量；
`verify-samples` 用真机抓包样本校验算法输出（需要样本文件）。
"""

import argparse
import json
import sys
import time


def _parse_params(pairs):
    params = {}
    for p in pairs or []:
        if "=" not in p:
            continue
        k, v = p.split("=", 1)
        params[k] = v
    return params


def cmd_mobile(args):
    from . import sign_all
    from .device import Device, make_seed_device

    if args.device_json:
        with open(args.device_json) as f:
            device = Device.from_dict(json.load(f))
    else:
        device = make_seed_device()

    params = _parse_params(args.param)
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"https://api.douyin.com{args.path}"
    if qs:
        url += f"?{qs}"

    body = args.body.encode() if args.body else b""
    headers = sign_all(
        method=args.method,
        url=url,
        body=body,
        cookies=device.to_cookie(),
        device=device,
    )
    out = {"url": url, "method": args.method, "headers": headers}
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def cmd_headers387(args):
    """生成抖音 38.7.0 形态的**完整**头集合（一站式）。"""
    import json as _json

    from . import sign_all_387

    kh = args.khronos or None
    h = sign_all_387(
        url=args.url,
        body=(args.body or "").encode(),
        cookies=args.cookies or "",
        khronos=kh,
        gorgon_f=int(args.gorgon_f, 0) if args.gorgon_f else 0x4A80,
        with_medusa=args.medusa,
        helios_aid=args.helios_aid,
    )
    if args.json:
        print(_json.dumps(h, ensure_ascii=False, indent=2))
    else:
        for k, v in h.items():
            print(f"{k}: {v}")
    return 0


def cmd_web(args):
    from .bogus import sign_full

    params = _parse_params(args.param)
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    ua = args.user_agent
    signed = sign_full(qs, ua) if qs else qs
    url = f"https://www.douyin.com{args.path}"
    if signed:
        url += f"?{signed}"
    print(json.dumps({"url": url, "user_agent": ua}, indent=2, ensure_ascii=False))
    return 0


def cmd_helios(args):
    """生成 / 校验 X-Helios（SPECK-128/256）。"""
    from . import helios

    if args.verify:
        res = helios.verify(args.verify, args.aid)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return 0 if res.get("ok") else 1

    ts = args.khronos or round(time.time())
    token = helios.sign_profile(ts, args.profile, head=(
        bytes.fromhex(args.head) if args.head else None
    ))
    out = {
        "profile": args.profile,
        "khronos": ts,
        "X-Helios": token,
        "verify": helios.verify(token, helios.PROFILES[args.profile]["key_aid"]),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def cmd_medusa(args):
    """生成 X-Medusa（红果短剧 aid=8662）。⚠️ 输出未经真机验证。"""
    from . import medusa

    url = args.url
    if "?" not in url:
        print(json.dumps(
            {"error": "URL 必须带 query —— query 的 SM3 取自问号之后的部分"},
            ensure_ascii=False,
        ))
        return 2

    params = dict(
        kv.split("=", 1)
        for kv in url.split("?", 1)[1].split("&")
        if "=" in kv
    )
    ts = args.khronos or round(time.time())
    device = {"device_id": args.device_id} if args.device_id else None
    body = json.loads(args.body) if args.body else None

    token = medusa.make_x_medusa(url, params, body, ts, device, args.content_type)
    print(json.dumps({
        "aid": medusa.AID,
        "license_id": medusa.LICENSE_ID,
        "khronos": ts,
        "X-Medusa": token,
        "length": len(token),
        "verified": False,
        "note": "未经真机逐字节验证，见 sign/medusa.py 模块 docstring",
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_selftest(args):
    """跑一遍已知向量自检，任一失败返回非 0。"""
    from .gorgon import make_x_gorgon
    from . import helios

    failures = []

    checks = [
        # 38.7.0 真机 oracle（与 tests/test_gorgon_387.py 的向量同源）
        (
            "x-gorgon/387-familyC",
            make_x_gorgon(b"aid=1128", b"", b"stor", 1791346902, family="C"),
            "8404804a000056b1b187c2bb0277a25dd81d1e62f1f58b4425e1",
        ),
        (
            "x-helios/fanqie",
            helios.sign(1785585278, 1967, 1611921764, 3019,
                        head=bytes.fromhex("eb020f26")),
            "6wIPJnL0/ZiOuZOH3YD2/LBKKS30n2Z2lL8vXa1mRx7msZcX",
        ),
    ]

    # 23.3.0（family A/B）没有高层向量，用「同输入可复现 + 前缀/长度」卡形式
    g23_a = make_x_gorgon(b"aid=1128&version_code=230300", b"", b"stor", 1791305420, False, family="A")
    g23_a2 = make_x_gorgon(b"aid=1128&version_code=230300", b"", b"stor", 1791305420, False, family="A")
    checks.append(("x-gorgon/2330-deterministic", g23_a, g23_a2))

    for name, got, want in checks:
        ok = got == want
        print(f"[{'ok' if ok else 'FAIL'}] {name}")
        if not ok:
            failures.append(name)
            print(f"       got  {got}")
            print(f"       want {want}")

    # 形状自检（无已知向量，只验格式/长度）
    from . import sign_all
    from .device import make_seed_device
    h = sign_all(
        "GET", "https://api.douyin.com/x?a=1", b"", "sessionid=x",
        make_seed_device(),
    )
    shape = {
        # X-Khronos = **十进制**秒级时间戳（真机样本 "1791343486"）
        "X-Khronos": (lambda v: len(v) == 10 and v.isdigit()),
        "X-SS-STUB": (lambda v: len(v) == 32 and v == v.upper()),
        # 23.3.0 = "0404"+family标记+"0000"；38.7.0 = "8404"+LE32(F)
        "X-Gorgon": (lambda v: len(v) == 52 and v[:4] in ("0404", "8404")),
        "X-Ladon": (lambda v: len(v) >= 8),
        "X-Argus": (lambda v: len(v) >= 8),
    }
    for k, pred in shape.items():
        v = h.get(k)
        ok = bool(v) and pred(v)
        print(f"[{'ok' if ok else 'FAIL'}] shape {k} = {str(v)[:48]}")
        if not ok:
            failures.append(k)

    if failures:
        print(f"\n{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("\nall checks passed")
    return 0


def cmd_verify_samples(args):
    """用真机抓包样本校验签名算法（样本文件含 _raw 与期望头）。"""
    from .samples import verify_sample_file

    with open(args.path) as f:
        samples = json.load(f)
    report = verify_sample_file(samples)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report.get("failed", 0) == 0 else 1


def build_parser():
    p = argparse.ArgumentParser(prog="douyin-sign", description="抖音/TikTok 签名工具")
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mobile", help="生成 Mobile API 签名头（X-Gorgon 家族）")
    m.add_argument("--path", required=True)
    m.add_argument("--method", default="GET")
    m.add_argument("--param", action="append", help="k=v，可重复")
    m.add_argument("--body", default="")
    m.add_argument("--device-json", default="")
    m.set_defaults(func=cmd_mobile)

    hs = sub.add_parser("headers387", help="抖音 38.7.0 形态的完整头集合（X-Argus/X-Ladon 短形态）")
    hs.add_argument("--url", required=True)
    hs.add_argument("--body", default="")
    hs.add_argument("--cookies", default="")
    hs.add_argument("--khronos", type=int, default=0, help="秒级时间戳，缺省当前时间")
    hs.add_argument("--gorgon-f", default=None,
                    help="X-Gorgon 的 F（如 0x4a80）；它是输出缓地址低 16 位，不可离线预测")
    hs.add_argument("--helios-aid", default="douyin", choices=["douyin", "fanqie", "hongguo"])
    hs.add_argument("--medusa", action="store_true", help="额外产出 X-Medusa（结构级，非有效签名）")
    hs.add_argument("--json", action="store_true")
    hs.set_defaults(func=cmd_headers387)

    w = sub.add_parser("web", help="生成 Web API 签名 URL（X-Bogus）")
    w.add_argument("--path", required=True)
    w.add_argument("--param", action="append", help="k=v，可重复")
    w.add_argument("--user-agent", default=(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/120.0.0.0"
    ))
    w.set_defaults(func=cmd_web)

    s = sub.add_parser("selftest", help="跑签名器自检")
    s.set_defaults(func=cmd_selftest)

    hl = sub.add_parser("helios", help="生成/校验 X-Helios（SPECK-128/256）")
    hl.add_argument("--profile", default="fanqie",
                    help="fanqie / hongguo / douyin")
    hl.add_argument("--khronos", type=int, default=0, help="时间戳，缺省取当前时间")
    hl.add_argument("--head", default="", help="4 字节随机头的 hex，便于复现")
    hl.add_argument("--verify", default="", help="改为校验一个已有的 X-Helios 令牌")
    hl.add_argument("--aid", type=int, default=1967, help="校验时用的 aid")
    hl.set_defaults(func=cmd_helios)

    md = sub.add_parser("medusa", help="生成 X-Medusa（红果短剧，⚠️ 未验证）")
    md.add_argument("--url", required=True, help="完整请求 URL（必须带 query）")
    md.add_argument("--body", default="", help="JSON 请求体")
    md.add_argument("--content-type", default="", help="请求 Content-Type")
    md.add_argument("--device-id", default="", help="设备 device_id")
    md.add_argument("--khronos", type=int, default=0, help="时间戳，缺省取当前时间")
    md.set_defaults(func=cmd_medusa)

    v = sub.add_parser("verify-samples", help="用抓包样本校验算法")
    v.add_argument("path")
    v.set_defaults(func=cmd_verify_samples)

    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
