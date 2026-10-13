// AES-128 加密（ECB 原语），用于生成 CENC-AES-CTR 的密钥流。
// 纯 TS 实现：T 表 + DataView，比 crypto-js 快一个数量级。

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
])

const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36])

let Te0: Uint32Array | null = null
let Te1: Uint32Array | null = null
let Te2: Uint32Array | null = null
let Te3: Uint32Array | null = null

function xtime(a: number): number { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff }

function ensureTables(): void {
  if (Te0) return
  const t0 = new Uint32Array(256), t1 = new Uint32Array(256), t2 = new Uint32Array(256), t3 = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i]
    const s2 = xtime(s)
    const s3 = (s2 ^ s) & 0xff
    const w = (((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0)
    t0[i] = w
    t1[i] = ((w >>> 8) | (w << 24)) >>> 0
    t2[i] = ((w >>> 16) | (w << 16)) >>> 0
    t3[i] = ((w >>> 24) | (w << 8)) >>> 0
  }
  Te0 = t0; Te1 = t1; Te2 = t2; Te3 = t3
}

export class Aes128 {
  readonly rk: Uint32Array
  constructor(key: Uint8Array) {
    ensureTables()
    if (key.length !== 16) throw new Error("AES-128 需要 16 字节密钥")
    this.rk = expandKey(key)
  }

  /** 原地加密，长度必须是 16 的倍数。 */
  encryptInPlace(buffer: Uint8Array): void {
    const a = Te0!, b = Te1!, c = Te2!, d = Te3!
    const rk = this.rk
    const blocks = buffer.length >>> 4
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    for (let n = 0; n < blocks; n++) {
      const o = n << 4
      let s0 = (dv.getUint32(o, false) ^ rk[0]) >>> 0
      let s1 = (dv.getUint32(o + 4, false) ^ rk[1]) >>> 0
      let s2 = (dv.getUint32(o + 8, false) ^ rk[2]) >>> 0
      let s3 = (dv.getUint32(o + 12, false) ^ rk[3]) >>> 0
      let t0 = 0, t1 = 0, t2 = 0, t3 = 0
      for (let r = 1; r < 10; r++) {
        const k = r << 2
        t0 = (a[s0 >>> 24] ^ b[(s1 >>> 16) & 0xff] ^ c[(s2 >>> 8) & 0xff] ^ d[s3 & 0xff] ^ rk[k]) >>> 0
        t1 = (a[s1 >>> 24] ^ b[(s2 >>> 16) & 0xff] ^ c[(s3 >>> 8) & 0xff] ^ d[s0 & 0xff] ^ rk[k + 1]) >>> 0
        t2 = (a[s2 >>> 24] ^ b[(s3 >>> 16) & 0xff] ^ c[(s0 >>> 8) & 0xff] ^ d[s1 & 0xff] ^ rk[k + 2]) >>> 0
        t3 = (a[s3 >>> 24] ^ b[(s0 >>> 16) & 0xff] ^ c[(s1 >>> 8) & 0xff] ^ d[s2 & 0xff] ^ rk[k + 3]) >>> 0
        s0 = t0; s1 = t1; s2 = t2; s3 = t3
      }
      dv.setUint32(o, ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff]) ^ rk[40], false)
      dv.setUint32(o + 4, ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff]) ^ rk[41], false)
      dv.setUint32(o + 8, ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff]) ^ rk[42], false)
      dv.setUint32(o + 12, ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff]) ^ rk[43], false)
    }
  }
}

function expandKey(key: Uint8Array): Uint32Array {
  const w = new Uint8Array(176)
  w.set(key.subarray(0, 16))
  for (let i = 16; i < 176; i += 4) {
    let a = w[i - 4], b = w[i - 3], c = w[i - 2], d = w[i - 1]
    if (i % 16 === 0) {
      const t = a
      a = SBOX[b] ^ RCON[i / 16 - 1]
      b = SBOX[c]; c = SBOX[d]; d = SBOX[t]
    }
    w[i] = w[i - 16] ^ a
    w[i + 1] = w[i - 15] ^ b
    w[i + 2] = w[i - 14] ^ c
    w[i + 3] = w[i - 13] ^ d
  }
  const dv = new DataView(w.buffer)
  const rk = new Uint32Array(44)
  for (let i = 0; i < 44; i++) rk[i] = dv.getUint32(i * 4, false)
  return rk
}

/**
 * CENC-AES-CTR：counter block = 8 字节 IV || 64 位大端块序号（从 startBlock 起）。
 * 把 `data`（密文）原地异或成明文；`skip` 表示从该 sample 内第 skip 字节开始。
 */
export function aesCtrXor(aes: Aes128, iv: Uint8Array, data: Uint8Array, skip: number, startBlock: number): void {
  const len = data.length
  if (len === 0) return
  if (iv.length !== 8 && iv.length !== 16) throw new Error(`不支持的 IV 长度：${iv.length}`)
  const firstBlock = startBlock + (skip >>> 4)
  const blocks = ((skip & 15) + len + 15) >>> 4
  const ks = new Uint8Array(blocks << 4)
  const dv = new DataView(ks.buffer)
  for (let i = 0; i < blocks; i++) {
    const o = i << 4
    const block = firstBlock + i
    ks.set(iv, o)
    if (iv.length === 8) {
      // 8 字节 IV：计数器是块内低 64 位（ISO 23001-7 'cenc' 默认）
      dv.setUint32(o + 8, Math.floor(block / 4294967296), false)
      dv.setUint32(o + 12, block >>> 0, false)
    } else {
      // 16 字节 IV：计数器是整个 128 位块，按大端递增
      addCounter128(ks, o, block)
    }
  }
  aes.encryptInPlace(ks)
  const pad = skip & 15
  for (let i = 0; i < len; i++) data[i] ^= ks[pad + i]
}

/** 把块号加到 16 字节大端计数器上（从最低位向高位传播进位）。 */
function addCounter128(ks: Uint8Array, offset: number, block: number): void {
  let value = block
  for (let i = offset + 15; i >= offset; i--) {
    const add = value % 256
    value = Math.floor(value / 256)
    const sum = ks[i] + add
    ks[i] = sum & 0xff
    value += sum >> 8
    if (value === 0) break
  }
}
