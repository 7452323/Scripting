/**
 * 115 的 m115 加密（对齐官方 Web/App 客户端 & SheltonZhu/115driver 的 pkg/crypto/m115）
 *
 * 用途：`proapi.115.com/app/chrome/downurl` 只接受 POST + 加密 data，
 * 这是取「大文件」直链的唯一可行通道（webapi/files/download 会对大文件回
 * 「文件大小超出限制，请使用 115 电脑端下载」）。
 *
 * 算法（原文照搬，别“优化”）：
 *   encode = base64( rsaEncrypt( key(16B) ‖ xor(reverse(xor(payload))) ) )
 *   decode = xor(reverse(xor( data[16:] ))) with key
 * 其中 rsaEncrypt/rsaDecrypt 其实只是 m^65537 mod N（两边同一把公钥，不是真 RSA）。
 */

const N_HEX =
  "8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b86021" +
  "36477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad633" +
  "8c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f1" +
  "0a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683"

const N = BigInt("0x" + N_HEX)
const E = 65537n
const KEY_LEN = 128 // N 是 1024 bit

const XOR_KEY_SEED = new Uint8Array([
  0xf0, 0xe5, 0x69, 0xae, 0xbf, 0xdc, 0xbf, 0x8a, 0x1a, 0x45, 0xe8, 0xbe, 0x7d, 0xa6, 0x73, 0xb8,
  0xde, 0x8f, 0xe7, 0xc4, 0x45, 0xda, 0x86, 0xc4, 0x9b, 0x64, 0x8b, 0x14, 0x6a, 0xb4, 0xf1, 0xaa,
  0x38, 0x01, 0x35, 0x9e, 0x26, 0x69, 0x2c, 0x86, 0x00, 0x6b, 0x4f, 0xa5, 0x36, 0x34, 0x62, 0xa6,
  0x2a, 0x96, 0x68, 0x18, 0xf2, 0x4a, 0xfd, 0xbd, 0x6b, 0x97, 0x8f, 0x4d, 0x8f, 0x89, 0x13, 0xb7,
  0x6c, 0x8e, 0x93, 0xed, 0x0e, 0x0d, 0x48, 0x3e, 0xd7, 0x2f, 0x88, 0xd8, 0xfe, 0xfe, 0x7e, 0x86,
  0x50, 0x95, 0x4f, 0xd1, 0xeb, 0x83, 0x26, 0x34, 0xdb, 0x66, 0x7b, 0x9c, 0x7e, 0x9d, 0x7a, 0x81,
  0x32, 0xea, 0xb6, 0x33, 0xde, 0x3a, 0xa9, 0x59, 0x34, 0x66, 0x3b, 0xaa, 0xba, 0x81, 0x60, 0x48,
  0xb9, 0xd5, 0x81, 0x9c, 0xf8, 0x6c, 0x84, 0x77, 0xff, 0x54, 0x78, 0x26, 0x5f, 0xbe, 0xe8, 0x1e,
  0x36, 0x9f, 0x34, 0x80, 0x5c, 0x45, 0x2c, 0x9b, 0x76, 0xd5, 0x1b, 0x8f, 0xcc, 0xc3, 0xb8, 0xf5,
])

const XOR_CLIENT_KEY = new Uint8Array([
  0x78, 0x06, 0xad, 0x4c, 0x33, 0x86, 0x5d, 0x18, 0x4c, 0x01, 0x3f, 0x46,
])

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function toBase64(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "="
    out += i + 2 < bytes.length ? B64[b2 & 63] : "="
  }
  return out
}

function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "")
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    if (ch === "=") break
    const v = B64.indexOf(ch)
    if (v < 0) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let v = value
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function reverseBytes(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[data.length - 1 - i]
  return out
}

function xorDeriveKey(seed: Uint8Array, size: number): Uint8Array {
  const key = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    key[i] = (seed[i] + XOR_KEY_SEED[size * i]) & 0xff
    key[i] ^= XOR_KEY_SEED[size * (size - i - 1)]
  }
  return key
}

function xorTransform(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data)
  const dataSize = out.length
  const keySize = key.length
  const mod = dataSize % 4
  if (mod > 0) {
    for (let i = 0; i < mod; i++) out[i] ^= key[i % keySize]
  }
  for (let i = mod; i < dataSize; i++) {
    out[i] ^= key[(i - mod) % keySize]
  }
  return out
}

function rsaEncrypt(input: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let rest = input
  while (rest.length > 0) {
    const sliceSize = Math.min(KEY_LEN - 11, rest.length)
    const slice = rest.subarray(0, sliceSize)
    rest = rest.subarray(sliceSize)

    const padSize = KEY_LEN - slice.length - 3
    const buf = new Uint8Array(KEY_LEN)
    buf[0] = 0
    buf[1] = 2
    for (let i = 0; i < padSize; i++) {
      buf[2 + i] = (Math.floor(Math.random() * 255) % 0xff) + 0x01
    }
    buf[padSize + 2] = 0
    buf.set(slice, padSize + 3)

    chunks.push(bigIntToBytes(modPow(bytesToBigInt(buf), E, N), KEY_LEN))
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function rsaDecrypt(input: Uint8Array): Uint8Array {
  const parts: number[] = []
  let rest = input
  while (rest.length > 0) {
    const sliceSize = Math.min(KEY_LEN, rest.length)
    const slice = rest.subarray(0, sliceSize)
    rest = rest.subarray(sliceSize)

    const ret = bigIntToBytes(modPow(bytesToBigInt(slice), E, N), KEY_LEN)
    // 去掉 PKCS#1 填充：找第一个 0（非首字节）
    for (let i = 0; i < ret.length; i++) {
      if (ret[i] === 0 && i !== 0) {
        for (let j = i + 1; j < ret.length; j++) parts.push(ret[j])
        break
      }
    }
  }
  return new Uint8Array(parts)
}

export function m115RandomKey(): Uint8Array {
  const key = new Uint8Array(16)
  for (let i = 0; i < 16; i++) key[i] = Math.floor(Math.random() * 256) & 0xff
  return key
}

/** 加密请求体：返回 base64 字符串 */
export function m115Encode(plain: string, key: Uint8Array): string {
  const payload = new Uint8Array(plain.length)
  for (let i = 0; i < plain.length; i++) payload[i] = plain.charCodeAt(i) & 0xff

  // xorTransform(payload, xorDeriveKey(key, 4)) → reverse → xorClientKey
  const step1 = xorTransform(payload, xorDeriveKey(key, 4))
  const step2 = reverseBytes(step1)
  const step3 = xorTransform(step2, XOR_CLIENT_KEY)
  return toBase64(rsaEncrypt(concat(key, step3)))
}

/** 解密响应体（base64） */
export function m115Decode(encoded: string, key: Uint8Array): string {
  const raw = rsaDecrypt(fromBase64(encoded))
  const body = raw.subarray(16)
  const step1 = xorTransform(body, xorDeriveKey(raw.subarray(0, 16), 12))
  const step2 = reverseBytes(step1)
  const step3 = xorTransform(step2, xorDeriveKey(key, 4))

  let out = ""
  for (const b of step3) out += String.fromCharCode(b)
  return out
}
