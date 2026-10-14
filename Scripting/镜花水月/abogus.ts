/**
 * 抖音网页端签名：`a_bogus`（2026-10 现行算法）
 *
 * 来源：z-mio/ParseHub `src/parsehub/provider_api/douyin.py` 的 ABogus 类（纯 Python 移植），
 *       此处按 1:1 行为移植为纯 TypeScript（不依赖任何 Scripting API，可直接被 JS 环境复用）。
 *
 * 用法：
 *   const params = { device_platform: "webapp", aid: "6383", ... }   // 注意：顺序敏感
 *   const query = new URLSearchParams(params) ... → 交给 signWebQuery 之类拼接
 *   const aBogus = abogus(params)
 *
 * ⚠️ 签名对象是「除 a_bogus / uifid / timestamp 之外的那批参数」，且**参数顺序必须与最终发送一致**。
 */

/* ────────────────────────── SM3（GB/T 32905-2016） ────────────────────────── */

const IV = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e]

function rotl(x: number, n: number): number {
  n %= 32
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

function p0(x: number): number { return (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0 }
function p1(x: number): number { return (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0 }
function ff(j: number, x: number, y: number, z: number): number {
  return j < 16 ? (x ^ y ^ z) >>> 0 : ((x & y) | (x & z) | (y & z)) >>> 0
}
function gg(j: number, x: number, y: number, z: number): number {
  return j < 16 ? (x ^ y ^ z) >>> 0 : ((x & y) | (~x & z)) >>> 0
}

/** SM3 摘要（返回 32 字节） */
export function sm3(msg: Uint8Array): Uint8Array {
  const len = msg.length
  const bitLen = len * 8
  const padLen = ((len + 9 + 63) >> 6) << 6                // 补到 64 字节整数倍
  const buf = new Uint8Array(padLen)
  buf.set(msg)
  buf[len] = 0x80
  // 末 8 字节写比特长度（大端，高位在前）
  const hi = Math.floor(bitLen / 4294967296)
  const lo = bitLen >>> 0
  buf[padLen - 8] = (hi >>> 24) & 255
  buf[padLen - 7] = (hi >>> 16) & 255
  buf[padLen - 6] = (hi >>> 8) & 255
  buf[padLen - 5] = hi & 255
  buf[padLen - 4] = (lo >>> 24) & 255
  buf[padLen - 3] = (lo >>> 16) & 255
  buf[padLen - 2] = (lo >>> 8) & 255
  buf[padLen - 1] = lo & 255

  const v = IV.slice()
  const w = new Array<number>(68)
  const w1 = new Array<number>(64)

  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4
      w[i] = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0
    }
    for (let j = 16; j < 68; j++) {
      w[j] = (p1((w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) >>> 0) ^ rotl(w[j - 13], 7) ^ w[j - 6]) >>> 0
    }
    for (let j = 0; j < 64; j++) w1[j] = (w[j] ^ w[j + 4]) >>> 0

    let [A, B, C, D, E, F, G, H] = v
    for (let j = 0; j < 64; j++) {
      const tj = j < 16 ? 0x79cc4519 : 0x7a879d8a
      const ss1 = rotl((rotl(A, 12) + E + rotl(tj, j)) >>> 0, 7)
      const ss2 = (ss1 ^ rotl(A, 12)) >>> 0
      const tt1 = (ff(j, A, B, C) + D + ss2 + w1[j]) >>> 0
      const tt2 = (gg(j, E, F, G) + H + ss1 + w[j]) >>> 0
      D = C
      C = rotl(B, 9)
      B = A
      A = tt1
      H = G
      G = rotl(F, 19)
      F = E
      E = p0(tt2)
    }
    v[0] = (v[0] ^ A) >>> 0; v[1] = (v[1] ^ B) >>> 0; v[2] = (v[2] ^ C) >>> 0; v[3] = (v[3] ^ D) >>> 0
    v[4] = (v[4] ^ E) >>> 0; v[5] = (v[5] ^ F) >>> 0; v[6] = (v[6] ^ G) >>> 0; v[7] = (v[7] ^ H) >>> 0
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (v[i] >>> 24) & 255
    out[i * 4 + 1] = (v[i] >>> 16) & 255
    out[i * 4 + 2] = (v[i] >>> 8) & 255
    out[i * 4 + 3] = v[i] & 255
  }
  return out
}

function utf8(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)) }
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i)
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)) }
  }
  return new Uint8Array(out)
}

export function sm3Hex(s: string): string {
  return Array.from(sm3(utf8(s))).map((b) => b.toString(16).padStart(2, "0")).join("")
}

/* ────────────────────────── ABogus ────────────────────────── */

const BASE64_ALPHABETS: Record<string, string> = {
  s0: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  s1: "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
  s2: "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=",
  s3: "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe",
  s4: "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe",
}

const UA_CODE = [
  76, 98, 15, 131, 97, 245, 224, 133, 122, 199, 241, 166, 79, 34, 90, 191,
  128, 126, 122, 98, 66, 11, 14, 40, 49, 110, 110, 173, 67, 96, 138, 252,
]

const DEFAULT_BROWSER = "1536|742|1536|864|0|0|0|0|1536|864|1536|864|1536|742|24|24|MacIntel"
const END_STRING = "cus"
const ARGUMENTS = [0, 1, 14]

function charCodes(s: string): number[] { return Array.from(s).map((c) => c.charCodeAt(0)) }
function fromCharCode(arr: number[]): string { return String.fromCharCode(...arr) }

/** random_list：把随机数摊成 4 个字节（与 Python 版逐行对应） */
function randomList(rnd: number, a = 170, b = 85, d = 0, e = 0, f = 0, g = 0): number[] {
  const r = rnd || Math.random() * 10000
  const v = [r, Math.trunc(r) & 255, Math.trunc(r) >> 8]
  v.push((v[1] & a) | d)
  v.push((v[1] & b) | e)
  v.push((v[2] & a) | f)
  v.push((v[2] & b) | g)
  return v.slice(v.length - 4)
}
const list1 = (r?: number) => randomList(r ?? 0, 170, 85, 1, 2, 5, 45 & 170)
const list2 = (r?: number) => randomList(r ?? 0, 170, 85, 1, 0, 0, 0)
const list3 = (r?: number) => randomList(r ?? 0, 170, 85, 1, 0, 5, 0)

function generateString1(r1 = 0, r2 = 0, r3 = 0): string {
  return fromCharCode(list1(r1)) + fromCharCode(list2(r2)) + fromCharCode(list3(r3))
}

/** list_4：固定骨架 + 17 个填充位（顺序与 Python 参数一一对应） */
function list4(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number,
  i: number, j: number, k: number, m: number, n: number, o: number, p: number, q: number, r: number): number[] {
  return [
    44, a, 0, 0, 0, 0, 24, b, n, 0, c, d, 0, 0, 0, 1, 0, 239, e, o, f, g,
    0, 0, 0, 0, h, 0, 0, 14, i, j, 0, k, m, 3, p, 1, q, 1, r, 0, 0, 0,
  ]
}

function endCheckNum(a: number[]): number {
  let r = 0
  for (const i of a) r ^= i
  return r
}

function rc4Encrypt(plaintext: string, key: string): string {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  let i = 0; j = 0
  const out: string[] = []
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256
    j = (j + s[i]) % 256
    const t = s[i]; s[i] = s[j]; s[j] = t
    out.push(String.fromCharCode(s[(s[i] + s[j]) % 256] ^ plaintext.charCodeAt(k)))
  }
  return out.join("")
}

/** 标准 s4 自定义 base64（generate_result） */
function generateResult(s: string, alphabetKey = "s4"): string {
  const alpha = BASE64_ALPHABETS[alphabetKey]
  const r: string[] = []
  for (let i = 0; i < s.length; i += 3) {
    let n: number
    if (i + 2 < s.length) n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2)
    else if (i + 1 < s.length) n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8)
    else n = s.charCodeAt(i) << 16
    const shifts = [18, 12, 6, 0]
    const masks = [0xfc0000, 0x03f000, 0x0fc0, 0x3f]
    for (let idx = 0; idx < 4; idx++) {
      const shift = shifts[idx]
      if (shift === 6 && i + 1 >= s.length) break
      if (shift === 0 && i + 2 >= s.length) break
      r.push(alpha[(n & masks[idx]) >>> shift])
    }
  }
  r.push("=".repeat((4 - (r.length % 4)) % 4))
  return r.join("")
}

function sm3BytesArray(data: string): number[] {
  return Array.from(sm3(utf8(data)))
}

/** Python: sm3.sm3_hash 再每 2 位十六进制转字节 —— 等价于对同一输入取 SM3 摘要字节 */
function sm3ToArray(data: string): number[] { return sm3BytesArray(data) }

function generateParamsCode(params: string): number[] {
  return sm3ToArray(fromCharCode(sm3ToArray(params + END_STRING)))
}
function generateMethodCode(method: string): number[] {
  return sm3ToArray(fromCharCode(sm3ToArray(method + END_STRING)))
}

function generateArgsCode(): number[] {
  const a: number[] = []
  for (let j = 24; j >= 0; j -= 8) a.push(ARGUMENTS[0] >> j)
  a.push(
    Math.trunc(ARGUMENTS[1] / 256),
    ARGUMENTS[1] % 256,
    ARGUMENTS[1] >> 24,
    ARGUMENTS[1] >> 16,
  )
  for (let j = 24; j >= 0; j -= 8) a.push(ARGUMENTS[2] >> j)
  return a.map((i) => i & 255)
}

function generateString2List(urlParams: string, method: string, startTime: number, endTime: number, browserLen: number): number[] {
  const paramsArray = generateParamsCode(urlParams)
  const methodArray = generateMethodCode(method)
  return list4(
    (endTime >> 24) & 255,
    paramsArray[21],
    UA_CODE[23],
    (endTime >> 16) & 255,
    paramsArray[22],
    UA_CODE[24],
    (endTime >> 8) & 255,
    endTime & 255,
    (startTime >> 24) & 255,
    (startTime >> 16) & 255,
    (startTime >> 8) & 255,
    startTime & 255,
    methodArray[21],
    methodArray[22],
    Math.trunc(endTime / 4294967296),
    Math.trunc(startTime / 4294967296),
    browserLen,
  )
}

function generateString2(urlParams: string, method: string, startTime: number, endTime: number, browser: string): string {
  const a = generateString2List(urlParams, method, startTime, endTime, browser.length)
  const e = endCheckNum(a)
  a.push(...charCodes(browser))
  a.push(e)
  return rc4Encrypt(fromCharCode(a), "y")
}

/** Python urllib.parse.urlencode 的等价实现（quote_plus：空格 → +，非 ASCII → %XX 大写） */
export function urlencode(params: Record<string, string>): string {
  const enc = (s: string) =>
    encodeURIComponent(s)
      .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
      .replace(/%20/g, "+")
  return Object.keys(params).map((k) => `${enc(k)}=${enc(String(params[k]))}`).join("&")
}

/** 生成 a_bogus（参数顺序 = 最终查询串里的顺序，且不含 a_bogus / uifid / timestamp） */
export function abogus(params: Record<string, string>, method = "GET"): string {
  const startTime = Date.now()
  const endTime = startTime + 4 + Math.floor(Math.random() * 5)          // Python: randint(4, 8)
  const string1 = generateString1()
  const string2 = generateString2(urlencode(params), method, startTime, endTime, DEFAULT_BROWSER)
  return generateResult(string1 + string2, "s4")
}

/** 供离线自检：用固定随机数与时间生成，结果可复现 */
export function abogusDeterministic(params: Record<string, string>, r1: number, r2: number, r3: number, startTime: number, endTime: number, method = "GET"): string {
  const string1 = generateString1(r1, r2, r3)
  const string2 = generateString2(urlencode(params), method, startTime, endTime, DEFAULT_BROWSER)
  return generateResult(string1 + string2, "s4")
}
