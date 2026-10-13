// 红果（番茄系）CENC-AES-CTR 加密 MP4 的解密支持。
//
// 关键设计：**不做 box 增删**，只把「加密相关 box 的类型字段」就地改成 free
// （encv→hvc1 / enca→mp4a、sinf→free、senc/saiz/saio/sgpd/sbgp→free）。
// 所有 box 的长度完全不变，于是虚拟文件的字节偏移与 CDN 上的密文完全一致，
// 可以直接做 HTTP Range 代理：请求哪一段就只解哪一段的 sample。
//
// 密钥派生与样本表解析移植自 hongguo-downloader / 果子鉴 的公开实现，
// 已用真机数据（360p 明文首帧 0000001d40010c02 = HEVC VPS）逐字节验证。

import { Aes128, aesCtrXor } from "./aes"

export type Box = { typ: string; off: number; size: number; hdr: number }

const CONTAINER = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta", "meta", "sinf", "schi", "mvex"])
const ENCRYPTION_BOXES = new Set(["senc", "saiz", "saio", "sgpd", "sbgp"])

export function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

export function readType(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
}

function writeType(b: Uint8Array, o: number, t: string): void {
  for (let i = 0; i < 4; i++) b[o + i] = t.charCodeAt(i)
}

/** 解析 [start, end) 内的同级 box。allowTruncated=true 时，若某 box 头部完整但体积
 *  超出 end（例如探针只取了 64KB 而 moov 有 489KB），仍然返回该 box。 */
export function siblings(b: Uint8Array, start: number, end: number, allowTruncated = false): Box[] {
  const out: Box[] = []
  let off = start
  while (off + 8 <= end) {
    let size = u32(b, off)
    const typ = readType(b, off + 4)
    let hdr = 8
    if (size === 1) {
      if (off + 16 > end) break
      const hi = u32(b, off + 8), lo = u32(b, off + 12)
      size = hi * 4294967296 + lo
      hdr = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < hdr) break
    if (off + size > end) {
      // 头部完整但体积超出当前窗口（如探针只取 64KB 而 moov 有 489KB）
      if (allowTruncated) out.push({ typ, off, size, hdr })
      break
    }
    out.push({ typ, off, size, hdr })
    off += size
  }
  return out
}

export function children(b: Uint8Array, box: Box): Box[] {
  return siblings(b, box.off + box.hdr, box.off + box.size)
}

export function findChild(b: Uint8Array, box: Box, typ: string): Box | null {
  for (const c of children(b, box)) if (c.typ === typ) return c
  return null
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >>> 1)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.substr(i * 2, 2), 16)
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0")
  return s
}

/** Uint8Array → 原生 Data（用于 HTTP 响应体 / 写盘 / 加密）。
 *  ⚠️ `Data.fromArrayBuffer` **只认整个 ArrayBuffer**，会忽略 Uint8Array 的 byteOffset/byteLength ——
 *  传一个 subarray 进去会把**整个底层缓冲**都算上。自动缓存分 4MB 落盘时每轮都传 subarray，
 *  于是每一轮都追加整片：文件变成 `实际大小 × 轮数`（实测 6.2MB 的集写出 12.3MB），
 *  而注册表只记实际大小 → LRU 的上限会被整体绕过。 */
export function dataOf(bytes: Uint8Array): Data {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  const buffer = whole ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const data = Data.fromArrayBuffer(buffer as ArrayBuffer)
  if (!data) throw new Error("二进制数据转换失败")
  return data
}

function base64ToBytes(value: string): Uint8Array {
  const data = Data.fromBase64String(value)
  if (!data) throw new Error("密钥数据无法解码")
  return new Uint8Array(data.toArrayBuffer())
}

/** spade_a（自定义 base64 编码串） → 16 字节 AES-128 内容密钥。 */
export function contentKey(spadeA: string): Uint8Array {
  let raw: Uint8Array
  try {
    raw = base64ToBytes(spadeA.trim())
  } catch {
    raw = base64ToBytes(spadeA.trim() + "=".repeat((-spadeA.trim().length % 4 + 4) % 4))
  }
  if (raw.length < 3) throw new Error("密钥数据过短")
  const tagLength = (raw[0] ^ raw[1] ^ raw[2]) - 48
  const contentLength = raw.length - tagLength - 1
  if (tagLength < 1 || contentLength < 33 || contentLength >= raw.length) throw new Error("密钥结构无效")
  const seed = raw[raw.length - tagLength - 2] ^ raw[raw.length - tagLength - 1]
  const tag = new Uint8Array(tagLength)
  for (let i = 0; i < tagLength; i++) tag[i] = raw[raw.length - tagLength + i] ^ seed
  const tagText = String.fromCharCode(...Array.from(tag))
  if (tagText === "app_v2" || tagText === "web_v2") throw new Error("暂不支持的密钥版本")

  const decoded = new Uint8Array(contentLength)
  let prevEven = 250, prevOdd = 85
  for (let i = 0; i < contentLength; i++) {
    const cur = raw[1 + i]
    const prev = i % 2 === 0 ? prevEven : prevOdd
    if (i % 2 === 0) prevEven = cur; else prevOdd = cur
    let bits = 0
    for (let v = i; v > 0; v >>>= 1) bits += v & 1
    decoded[i] = ((prev ^ cur) - 21 - bits) & 0xff
  }
  const padding = Number.parseInt(String.fromCharCode(decoded[0]), 36)
  if (contentLength - padding - 1 !== 32) throw new Error("密钥内容无效")
  let ascii = ""
  for (let i = 1; i <= 32; i++) ascii += String.fromCharCode(decoded[i])
  const key = hexToBytes(ascii)
  if (key.length !== 16) throw new Error("不是有效的 AES-128 密钥")
  return key
}

export type SampleSpan = { start: number; end: number; iv: Uint8Array }

export type CencMedia = {
  key: Uint8Array
  keyData: Data
  aes: Aes128
  /** 文件 [0, headerEnd) 的字节（moov 已被就地改成明文形态），可直接作为响应前缀。 */
  header: Uint8Array
  headerEnd: number
  fileSize: number
  spans: SampleSpan[]
  sampleCount: number
  codec: string
  /** 这条流到底加没加密；没加密就不能拿零 IV 去异或。 */
  encrypted: boolean
  /** senc 里的 IV 长度（8 或 16）。 */
  ivSize: number
}

function sampleSpans(b: Uint8Array, trak: Box): { spans: SampleSpan[]; codec: string; ivSize: number; hasSubsamples: boolean; encrypted: boolean } | null {
  const mdia = findChild(b, trak, "mdia")
  if (!mdia) return null
  const minf = findChild(b, mdia, "minf")
  if (!minf) return null
  const stbl = findChild(b, minf, "stbl")
  if (!stbl) return null
  const stsz = findChild(b, stbl, "stsz")
  const stco = findChild(b, stbl, "stco")
  const co64 = findChild(b, stbl, "co64")
  const stsc = findChild(b, stbl, "stsc")
  const senc = findChild(b, stbl, "senc")
  const stsd = findChild(b, stbl, "stsd")
  if (!stsz || (!stco && !co64) || !stsc) return null

  // stsd 样本条目：识别真实编码 + 把 encv/enca + sinf 改成明文形态
  let codec = ""
  let encryptedEntry = false
  if (stsd) {
    const base = stsd.off + stsd.hdr
    const count = u32(b, base + 4)
    let p = base + 8
    for (let i = 0; i < count; i++) {
      if (p + 8 > stsd.off + stsd.size) break
      const entrySize = u32(b, p)
      const entryType = readType(b, p + 4)
      if (entrySize < 8) break
      if (entryType === "encv" || entryType === "enca") {
        encryptedEntry = true
        const fixed = entryType === "encv" ? 78 : 28
        let q = p + 8 + fixed
        let visual = "hvc1"
        while (q + 8 <= p + entrySize) {
          const sub = u32(b, q)
          const subType = readType(b, q + 4)
          for (const s of siblings(b, q, q + Math.max(8, sub))) {
            if (s.typ === "hvcC") visual = "hvc1"
            else if (s.typ === "avcC") visual = "avc1"
            else if (s.typ === "vvcC") visual = "vvc1"
          }
          if (subType === "sinf") writeType(b, q + 4, "free")
          if (sub < 8) break
          q += sub
        }
        writeType(b, p + 4, entryType === "encv" ? visual : "mp4a")
        codec = entryType === "encv" ? visual : "mp4a"
      } else {
        codec = entryType
      }
      p += entrySize
    }
  } else {
    codec = "unknown"
  }
  for (const c of children(b, stbl)) {
    if (ENCRYPTION_BOXES.has(c.typ)) writeType(b, c.off + 4, "free")
  }

  const fixedSize = u32(b, stsz.off + 12)
  const count = u32(b, stsz.off + 16)
  const sizes = new Uint32Array(count)
  if (fixedSize === 0) {
    for (let i = 0; i < count; i++) sizes[i] = u32(b, stsz.off + 20 + i * 4)
  } else {
    sizes.fill(fixedSize)
  }

  const chunkCount = u32(b, stco ? stco.off + 12 : co64!.off + 12)
  const chunkOffsets = new Float64Array(chunkCount)
  if (stco) {
    for (let i = 0; i < chunkCount; i++) chunkOffsets[i] = u32(b, stco.off + 16 + i * 4)
  } else {
    for (let i = 0; i < chunkCount; i++) {
      const hi = u32(b, co64!.off + 16 + i * 8), lo = u32(b, co64!.off + 20 + i * 8)
      chunkOffsets[i] = hi * 4294967296 + lo
    }
  }

  const stscCount = u32(b, stsc.off + 12)
  const firsts = new Uint32Array(stscCount), perChunk = new Uint32Array(stscCount)
  for (let i = 0; i < stscCount; i++) {
    firsts[i] = u32(b, stsc.off + 16 + i * 12)
    perChunk[i] = u32(b, stsc.off + 20 + i * 12)
  }

  const offsets = new Float64Array(count)
  let si = 0
  for (let ci = 0; ci < chunkCount && si < count; ci++) {
    let idx = 0
    for (let i = stscCount - 1; i >= 0; i--) { if (firsts[i] <= ci + 1) { idx = i; break } }
    let off = chunkOffsets[ci]
    const n = perChunk[idx]
    for (let k = 0; k < n && si < count; k++) { offsets[si] = off; off += sizes[si]; si++ }
  }

  const spans: SampleSpan[] = []
  let ivSize = 0
  let hasSubsamples = false
  if (senc) {
    const sbase = senc.off + senc.hdr
    const flags = u32(b, sbase) & 0xffffff
    const n = u32(b, sbase + 4)
    hasSubsamples = (flags & 2) !== 0
    ivSize = n > 0 && !hasSubsamples ? ((senc.size - senc.hdr - 8) / n) | 0 : 16
    let p = sbase + 8
    for (let i = 0; i < n; i++) {
      if (p + ivSize > senc.off + senc.size) break
      const iv = b.slice(p, p + ivSize)
      p += ivSize
      if (hasSubsamples) {
        const subCount = (b[p] << 8) | b[p + 1]
        p += 2 + subCount * 6
      }
      if (i >= count) break
      spans.push({ start: offsets[i], end: offsets[i] + sizes[i], iv })
    }
  } else {
    for (let i = 0; i < count; i++) spans.push({ start: offsets[i], end: offsets[i] + sizes[i], iv: new Uint8Array(8) })
  }
  // senc 与 sinf 都不存在时说明这条轨根本没加密，不能拿零 IV 去异或
  return { spans, codec, ivSize, hasSubsamples, encrypted: !!senc || encryptedEntry }
}

/**
 * 从「已下载的头部字节（含完整 moov）」构建解密上下文。
 * @param header 文件开头若干字节，必须覆盖整个 moov
 * @param key contentKey() 派生的 AES 密钥
 * @param fileSize CDN 返回的总长度
 */
export function buildMedia(header: Uint8Array, key: Uint8Array, fileSize: number): CencMedia {
  const top = siblings(header, 0, header.length)
  const moov = top.find(b => b.typ === "moov")
  if (!moov) throw new Error("MP4 头部缺少 moov")
  const headerEnd = moov.off + moov.size
  const out = header.slice(0, headerEnd)
  const spans: SampleSpan[] = []
  let codec = ""
  let encrypted = false
  let ivSize = 0
  for (const trak of children(out, moov)) {
    if (trak.typ !== "trak") continue
    const r = sampleSpans(out, trak)
    if (!r) continue
    // 分片加密（subsample）= 样本里只有部分字节被加密；现在的「整样本异或」
    // 会把中间那段明文也翻掉 → 宁可报错也不出花屏
    if (r.hasSubsamples) throw new Error("该清晰度使用了分片加密（subsample），暂不支持，请换一个清晰度")
    if (r.codec === "vvc1") throw new Error("该清晰度是 VVC/H.266 编码，iOS 无法解码，请换一个清晰度")
    if (!codec) codec = r.codec
    if (!r.encrypted) continue // 这条轨没加密，不要拿零 IV 去异或
    if (ivSize && r.ivSize && ivSize !== r.ivSize) throw new Error("音视频轨的 IV 长度不一致，暂不支持")
    ivSize = r.ivSize || ivSize
    encrypted = true
    // ⚠️ 不要用 spread push（`push(...r.spans)`）：一集长片可能上万条样本，
    //     参数个数会撞引擎上限（Maximum call stack / too many arguments）。
    for (const span of r.spans) spans.push(span)
  }
  // 全片都没加密时 spans 会是空的，这是合法的（readRange 会原样透传）；
  // 只有「声明加密却解不出样本表」才是真的坏。
  if (encrypted && !spans.length) throw new Error("没有解析到加密样本表")
  spans.sort((a, b) => a.start - b.start)
  return { key, keyData: dataOf(key), aes: new Aes128(key), header: out, headerEnd, fileSize, spans, sampleCount: spans.length, codec, encrypted, ivSize }
}

/**
 * 原生 AES-GCM 当作 AES-CTR 密钥流用。
 * GCM 12 字节 IV = iv8 ‖ 00000000 时：返回值的 [12, 12+n) 正是明文，
 * 而其密钥流从 CENC 的第 2 个计数器块开始，因此可以直接处理样本内 offset ≥ 32 的部分。
 * 代价是 12 字节 IV 回显 + 16 字节 tag，需要丢弃。
 */
function gcmDecryptRest(keyData: Data, iv: Uint8Array, data: Uint8Array): boolean {
  if (iv.length !== 8 || data.length === 0) return false
  const iv12 = new Uint8Array(12)
  iv12.set(iv, 0)
  const input = new Uint8Array(data) // 拷出独立 buffer，避免 Data 看到超长底层数组
  const result = Crypto.encryptAESGCM(dataOf(input), keyData, { iv: dataOf(iv12) })
  if (!result) return false
  const bytes = new Uint8Array(result.toArrayBuffer())
  if (bytes.length < 12 + data.length) return false
  data.set(bytes.subarray(12, 12 + data.length))
  return true
}

/**
 * 解密缓冲区 `buf` 中落在 [bufStart, bufStart+buf.length) 的加密样本部分。
 * 每个样本的头 32 字节（CENC 块 0/1）用 JS AES，其余全部交给硬件加速的原生 GCM。
 */
export function decryptBuffer(media: CencMedia, buf: Uint8Array, bufStart: number): void {
  if (!media.encrypted) return
  const bufEnd = bufStart + buf.length
  const { spans, aes } = media
  let lo = 0, hi = spans.length - 1, first = spans.length
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (spans[mid].end > bufStart) { first = mid; hi = mid - 1 } else lo = mid + 1
  }
  for (let i = first; i < spans.length; i++) {
    const s = spans[i]
    if (s.start >= bufEnd) break
    if (s.end <= bufStart) continue
    const from = Math.max(s.start, bufStart)
    const to = Math.min(s.end, bufEnd)
    const within = from - s.start
    const slice = buf.subarray(from - bufStart, to - bufStart)
    // 块 0/1（样本前 32 字节）只能用 JS 实现
    const head = Math.min(Math.max(0, 32 - within), slice.length)
    if (head > 0) aesCtrXor(aes, s.iv, slice.subarray(0, head), within, 0)
    // 其余走原生 GCM；仅当恰好从样本第 32 字节开始（整样本覆盖）才走快路
    const rest = slice.subarray(head)
    if (rest.length > 0 && !(within + head === 32 && gcmDecryptRest(media.keyData, s.iv, rest))) {
      aesCtrXor(aes, s.iv, rest, within + head, 0)
    }
  }
}

/** 二分找出需要从 CDN 拉取的最小字节范围（对齐到样本边界），返回 [start, end)。 */
export function alignedRange(media: CencMedia, from: number, to: number): { start: number; end: number } {
  const { spans } = media
  if (from < media.headerEnd) return { start: from, end: Math.max(to, Math.min(media.headerEnd, media.fileSize)) }
  let lo = 0, hi = spans.length - 1, first = spans.length
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (spans[mid].end > from) { first = mid; hi = mid - 1 } else lo = mid + 1
  }
  if (first >= spans.length) return { start: from, end: to }
  // 末尾也二分：原来是从 first 往后线性扫，大范围请求（如 AVPlayer 一次拉整片）
  // 会退化成 O(样本数)。两个边界都是单调的，能直接二分。
  let last = first
  lo = first; hi = spans.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (spans[mid].start < to) { last = mid; lo = mid + 1 } else hi = mid - 1
  }
  return { start: Math.min(from, spans[first].start), end: Math.max(to, spans[last].end) }
}
