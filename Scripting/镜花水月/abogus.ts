/**
 * 抖音网页端签名：`a_bogus`（2026-11 与前端 JS 逐字节对齐）
 *
 * 来源：`7452323/douyin-sign` 的 `sign/abogus.py`（已用 NearHuiwen/TiktokDouyinCrawler 的
 *       `utils/a_bogus.js` 交叉验证，4 条 golden 逐字节相同）。此处 1:1 移植为纯 TypeScript，
 *       不依赖任何 Scripting API。
 *
 * 相比旧版（ParseHub 的 ABogus 移植）修正了三处真缺陷：
 *   1. 参数串哈希**不能**再 URL 编码一次（前端传的是已编码的 location.search）；
 *   2. UA 那一路必须**按实际 UA 动态算**（旧版硬编码 32 字节常量，换个 UA 就全错）；
 *   3. 变体 base64 尾组只吐 2~3 个字符、末尾固定补 1 个 `=`（旧版补足 4 个、且不补 `=`）。
 *
 * 用法：
 *   const params = { device_platform: "webapp", aid: "6383", ... }   // 顺序敏感
 *   const aBogus = abogus(params, "GET", { ua: DESKTOP_UA })
 *
 * ⚠️ 签名对象是「除 a_bogus / uifid / timestamp 之外的那批参数」，参数顺序必须与最终发送一致；
 *    `ua` 必须与请求头里真正发出去的 User-Agent 完全相同，否则 UA 那一路的哈希就对不上。
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
  return j < 16 ? (x ^ y ^ z) >>> 0 : (((x & y) | (~x & z))) >>> 0
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

/** 变体 base64 表（s3 = UA 那一路，s4 = 最终输出；与仓库 Python 版逐字符相同） */
const SHIFT_S3 = "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe"
const SHIFT_S4 = "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe"

/** 前端 window_env 默认串（与 sign/abogus.py 默认一致；golden 向量就是用这个算的） */
export const DEFAULT_WINDOW_ENV = "1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32"

/** 兜底 UA：实际调用**必须**传与请求头完全一致的那个 */
export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

const SUFFIX = "cus"
const ARGUMENTS: number[] = [0, 1, 14]
const AB_AID = 6383
const AB_PAGE_ID = 6241

function charCodes(s: string): number[] { return Array.from(s).map((c) => c.charCodeAt(0)) }
function fromCharCode(arr: number[]): string { return String.fromCharCode(...arr) }

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255
  return out
}

/** 取任意精度整数第 shift 个字节（不能用 `>>`：JS 位运算会先截成 int32） */
function byteAt(n: number, shift: number): number {
  return Math.floor(n / Math.pow(2, shift)) % 256
}

function rc4Bytes(key: number[], data: number[]): number[] {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) % 256
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  let i = 0; j = 0
  const out: number[] = []
  for (const b of data) {
    i = (i + 1) % 256
    j = (j + s[i]) % 256
    const t = s[i]; s[i] = s[j]; s[j] = t
    out.push(b ^ s[(s[i] + s[j]) % 256])
  }
  return out
}

/**
 * 变体 base64：**不补 `=`**，字符数 = ceil(len*4/3)
 * （前端 `result_encrypt` 循环到 `len/3*4`，尾组不足 3 字节时只吐 2~3 个字符）
 */
function rawEncode(s: string, table: string): string {
  const codes = charCodes(s)
  const total = Math.ceil((codes.length * 4) / 3)
  const out: string[] = []
  for (let i = 0; i < codes.length; i += 3) {
    const has2 = i + 1 < codes.length
    const has3 = i + 2 < codes.length
    let n = codes[i] << 16
    if (has2) n |= codes[i + 1] << 8
    if (has3) n |= codes[i + 2]
    out.push(table[(n >>> 18) & 63])
    if (has2) out.push(table[(n >>> 12) & 63])
    // 尾组还剩 2 字节时前端仍会吐第 3 个字符（第 4 个才需要 3 字节），多出的由 slice 裁掉
    if (has2) out.push(table[(n >>> 6) & 63])
    if (has3) out.push(table[n & 63])
  }
  return out.join("").slice(0, total)
}

/** 4 字节前缀：3 组（随机数, 固定掩码 [3,45] [1,0] [1,5]） */
function prefixBytes(randoms: number[]): number[] {
  const masks = [[3, 45], [1, 0], [1, 5]]
  const out: number[] = []
  for (let k = 0; k < 3; k++) {
    const r = Math.trunc(randoms[k] || 0)
    const lo = r % 256
    const hi = Math.floor(r / 256) % 256
    const [o0, o1] = masks[k]
    out.push((lo & 170) | (o0 & 85))
    out.push((lo & 85) | (o0 & 170))
    out.push((hi & 170) | (o1 & 85))
    out.push((hi & 85) | (o1 & 170))
  }
  return out
}

export interface AbogusOptions {
  /** 必须与请求头里的 User-Agent 完全一致（UA 那一路参与签名） */
  ua?: string
  /** 环境指纹串，缺省用前端默认（Win32 那串） */
  windowEnv?: string
  /** 毫秒时间戳（start_time） */
  timestamp?: number
  /** 三次 SM3 结束时的毫秒；缺省 timestamp + 0~3ms */
  endTimestamp?: number
  /** 前缀用的 3 个随机数（缺省随机） */
  randoms?: [number, number, number]
}

/** 对**已拼好的 query 串**签名（golden 对拍 / 需要精确控制顺序时用） */
export function abogusFromQuery(qs: string, opts: AbogusOptions = {}): string {
  const ua = opts.ua ?? DEFAULT_UA
  const env = opts.windowEnv ?? DEFAULT_WINDOW_ENV
  const start = Math.floor(opts.timestamp ?? Date.now())
  const end = Math.floor(opts.endTimestamp ?? (start + Math.floor(Math.random() * 4)))
  const randoms: number[] = opts.randoms ?? [0, 0, 0].map(() => Math.floor(Math.random() * 10001))

  // 三次 SM3：参数串 / 后缀 / UA（UA 那一路是 rc4 → 变体 b64(s3) → SM3）
  const hashParams = sm3(sm3(utf8(qs + SUFFIX)))
  const hashSuffix = sm3(sm3(utf8(SUFFIX)))
  const uaHash = sm3(latin1Bytes(rawEncode(fromCharCode(rc4Bytes([0, 1, 14], Array.from(utf8(ua)))), SHIFT_S3)))

  const envCodes = charCodes(env)
  const b: number[] = new Array<number>(80).fill(0)
  b[8] = 3
  b[10] = end
  b[16] = start
  b[18] = 44
  b[19] = 1                                   // 前端 b[19] 只承载 [1,0,1,5] 的首位
  b[20] = byteAt(start, 24)
  b[21] = byteAt(start, 16)
  b[22] = byteAt(start, 8)
  b[23] = start % 256
  b[24] = byteAt(start, 32)
  b[25] = byteAt(start, 40)
  b[26] = byteAt(ARGUMENTS[0], 24)
  b[27] = byteAt(ARGUMENTS[0], 16)
  b[28] = byteAt(ARGUMENTS[0], 8)
  b[29] = ARGUMENTS[0] % 256
  b[30] = Math.floor(ARGUMENTS[1] / 256) % 256
  b[31] = ARGUMENTS[1] % 256
  b[32] = byteAt(ARGUMENTS[1], 24)
  b[33] = byteAt(ARGUMENTS[1], 16)
  b[34] = byteAt(ARGUMENTS[2], 24)
  b[35] = byteAt(ARGUMENTS[2], 16)
  b[36] = byteAt(ARGUMENTS[2], 8)
  b[37] = ARGUMENTS[2] % 256
  b[38] = hashParams[21]
  b[39] = hashParams[22]
  b[40] = hashSuffix[21]
  b[41] = hashSuffix[22]
  b[42] = uaHash[23]                          // UA 这一路取 23/24（前端就这么写的）
  b[43] = uaHash[24]
  b[44] = byteAt(end, 24)
  b[45] = byteAt(end, 16)
  b[46] = byteAt(end, 8)
  b[47] = end % 256
  b[48] = b[8]
  b[49] = byteAt(end, 32)
  b[50] = byteAt(end, 40)
  b[51] = AB_PAGE_ID
  b[52] = byteAt(AB_PAGE_ID, 24)
  b[53] = byteAt(AB_PAGE_ID, 16)
  b[54] = byteAt(AB_PAGE_ID, 8)
  b[55] = AB_PAGE_ID % 256
  b[56] = AB_AID
  b[57] = AB_AID % 256
  b[58] = byteAt(AB_AID, 8)
  b[59] = byteAt(AB_AID, 16)
  b[60] = byteAt(AB_AID, 24)
  b[64] = envCodes.length
  b[65] = envCodes.length % 256
  b[66] = byteAt(envCodes.length, 8)
  b[69] = 0
  b[70] = 0
  b[71] = 0
  b[72] = (
    b[18] ^ b[20] ^ b[26] ^ b[30] ^ b[38] ^ b[40] ^ b[42] ^ b[21] ^
    b[27] ^ b[31] ^ b[35] ^ b[39] ^ b[41] ^ b[43] ^ b[22] ^
    b[28] ^ b[32] ^ b[36] ^ b[23] ^ b[29] ^ b[33] ^ b[37] ^
    b[44] ^ b[45] ^ b[46] ^ b[47] ^ b[48] ^ b[49] ^ b[50] ^
    b[24] ^ b[25] ^ b[52] ^ b[53] ^ b[54] ^ b[55] ^ b[57] ^
    b[58] ^ b[59] ^ b[60] ^ b[65] ^ b[66] ^ b[70] ^ b[71]
  ) & 255

  const core = [
    b[18], b[20], b[52], b[26], b[30], b[34], b[58], b[38],
    b[40], b[53], b[42], b[21], b[27], b[54], b[55], b[31],
    b[35], b[57], b[39], b[41], b[43], b[22], b[28], b[32],
    b[60], b[36], b[23], b[29], b[33], b[37], b[44], b[45],
    b[59], b[46], b[47], b[48], b[49], b[50], b[24], b[25],
    b[65], b[66], b[70], b[71],
  ]
  const payload = core.concat(envCodes, [b[72]])
  const encrypted = rc4Bytes([121], payload)
  const full = prefixBytes(randoms).concat(encrypted)
  return rawEncode(fromCharCode(full), SHIFT_S4) + "="
}

/** Python `urllib.parse.urlencode` 的等价实现（quote_plus：空格 → +，非 ASCII → %XX 大写） */
export function urlencode(params: Record<string, string>): string {
  const enc = (s: string) =>
    encodeURIComponent(s)
      .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
      .replace(/%20/g, "+")
  return Object.keys(params).map((k) => `${enc(k)}=${enc(String(params[k]))}`).join("&")
}

/**
 * 生成 a_bogus（参数顺序 = 最终查询串里的顺序，且不含 a_bogus / uifid / timestamp）
 * @param method 保留参数（前端这一版不参与签名，与 Python 版一致）
 */
export function abogus(params: Record<string, string>, method = "GET", opts: AbogusOptions = {}): string {
  return abogusFromQuery(urlencode(params), opts)
}

/** 供离线自检：随机数与时间全部外部指定，结果可复现（旧签名保持兼容） */
export function abogusDeterministic(
  params: Record<string, string>, r1: number, r2: number, r3: number,
  startTime: number, endTime: number, method = "GET", ua?: string,
): string {
  return abogusFromQuery(urlencode(params), {
    ua, timestamp: startTime, endTimestamp: endTime, randoms: [r1, r2, r3],
  })
}
