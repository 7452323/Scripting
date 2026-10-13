// 本地解密代理：把 CDN 上的 CENC 加密 MP4 变成一个「明文 MP4 的本地 http 地址」。
//
// AVPlayer 用 HTTP Range 拉流 → 这里按请求范围只取对应密文、只解对应样本，
// 所以是流式的：秒开、可拖动、不占内存（不需要整片下载）。

import { fetch } from "scripting"
import { buildMedia, contentKey, dataOf, decryptBuffer, alignedRange, siblings, type CencMedia } from "./cenc"

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
/** 单次响应上限（仅作为 OOM 保护）。AVPlayer 会一次请求整片，
 *  返回不足它不会续传而是原样重试，所以这里必须几乎不设限。 */
const MAX_CHUNK = 64 * 1024 * 1024
/** 首包（ftyp + moov）一次拉多少：足够包住绝大多数剧集的 moov。 */
const HEAD_BYTES = 64 * 1024
/** 超过这个大小就不参与自动缓存（短剧一集不会这么大，防止意外吃内存）。 */
const CACHE_MAX_EPISODE = 160 * 1024 * 1024

/** 自动缓存接收槽：边播边把明文按顺序攒起来，攒满整集再落盘。 */
type CacheSink = {
  path: string
  buf: Uint8Array
  /** 已经从 0 开始连续攒到的位置 */
  end: number
  saving: boolean
  onSaved: (bytes: number) => void
}

export type PrepareOptions = {
  /** 开启自动缓存时传入；路径用 cache.pendingCachePath(vid) 拿。 */
  cache?: { path: string; onSaved: (bytes: number) => void }
}

type Session = { url: string; media: CencMedia; total: number; sink?: CacheSink }

async function fetchRange(url: string, from: number, to: number): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "user-agent": UA, range: `bytes=${from}-${to}` } })
  if (!response.ok && response.status !== 206) throw new Error(`内容源返回 ${response.status}`)
  const bytes = new Uint8Array((await response.data()).toArrayBuffer())
  if (bytes.length !== to - from + 1) throw new Error("内容源返回的字节数不符")
  return bytes
}

/**
 * 一次请求同时拿到「文件总长」和「开头一段」—— 起播/切集省一个网络往返（实测 200~400ms）。
 * 总长从 Range 响应头 `content-range: bytes 0-N/TOTAL` 里读。
 * ⚠️ 两种必须兑住的情况：
 *   1. 内容源不支持 Range（回 200 全量）→ 截到 HEAD_BYTES，总长用实际字节数（moov 只在开头）；
 *   2. 文件比 HEAD_BYTES 还小 → 按实收长度认。
 */
async function fetchHead(url: string, want: number): Promise<{ head: Uint8Array; total: number }> {
  const response = await fetch(url, { headers: { "user-agent": UA, range: `bytes=0-${want - 1}` } })
  if (!response.ok && response.status !== 206) throw new Error(`内容源返回 ${response.status}`)
  const bytes = new Uint8Array((await response.data()).toArrayBuffer())
  const range = response.headers.get("content-range") ?? response.headers.get("Content-Range") ?? ""
  const slash = range.lastIndexOf("/")
  const total = slash >= 0 ? Number(range.slice(slash + 1)) : (bytes.length > want ? bytes.length : Number(response.headers.get("content-length") ?? 0) || bytes.length)
  if (!total || Number.isNaN(total)) throw new Error("无法确定视频长度")
  return { head: bytes.length > want ? bytes.subarray(0, want) : bytes, total }
}

/** 大范围分片并发拉取：单连接 CDN 带宽有限，实测 8 路可提速约 1.5 倍。 */
async function fetchRangeParallel(url: string, from: number, to: number): Promise<Uint8Array> {
  const size = to - from + 1
  if (size <= 4 * 1024 * 1024) return fetchRange(url, from, to)
  const parts = Math.min(8, Math.max(2, Math.ceil(size / (3 * 1024 * 1024))))
  const chunk = Math.ceil(size / parts)
  const pieces = await Promise.all(Array.from({ length: parts }, (_, index) => {
    const start = from + index * chunk
    if (start > to) return Promise.resolve(new Uint8Array())
    return fetchRange(url, start, Math.min(to, start + chunk - 1))
  }))
  const out = new Uint8Array(size)
  let offset = 0
  for (const piece of pieces) { out.set(piece, offset); offset += piece.length }
  return out
}

class MediaProxy {
  private server: HttpServer | null = null
  private port = 0
  private sessions = new Map<string, Session>()
  /** 调试用：记录所有进来的请求（method / range / 响应状态）。 */
  readonly debugLog: string[] = []

  private ensureStarted(): string {
    if (!this.server) {
      const server = new HttpServer()
      server.registerAsyncHandler("/v/:id", request => this.handle(request))
      const error = server.start({ port: 0, forceIPv4: true })
      if (error) throw new Error(`本地代理启动失败：${error}`)
      this.port = server.port ?? 0
      if (!this.port) throw new Error("本地代理没有拿到端口")
      this.server = server
    }
    return `http://127.0.0.1:${this.port}`
  }

  /** 取回文件头（ftyp + moov）并构建解密上下文，返回可直接播放的本地地址。 */
  async prepare(sourceUrl: string, spadeA: string, totalHint = 0, options: PrepareOptions = {}): Promise<{ url: string; sessionId: string; codec: string; samples: number; total: number; encrypted: boolean; ivSize: number; release: () => void }> {
    const base = this.ensureStarted()
    // ① 一次请求拿齐「总长 + 开头一段」（老写法是「先探长度、再取头部」两次往返）
    const probed = await fetchHead(sourceUrl, HEAD_BYTES)
    const total = probed.total || totalHint
    if (!total) throw new Error("无法确定视频长度")
    // 自动缓存：知道总长、且没超上限才攒；攒的就是下面要解密的那份明文，不额外耗流量
    let sink: CacheSink | undefined
    if (options.cache && total > 0 && total <= CACHE_MAX_EPISODE) {
      sink = { path: options.cache.path, buf: new Uint8Array(total), end: 0, saving: false, onSaved: options.cache.onSaved }
    }
    // 1) 开头这段已经拿到了（需要的话把 moov 之后剩下的头补上）
    let head = probed.head
    const top = siblings(head, 0, head.length, true)
    const moov = top.find(b => b.typ === "moov")
    if (!moov) throw new Error("视频头部没有 moov（非渐进式 MP4）")
    const headerEnd = moov.off + moov.size
    if (headerEnd > head.length) head = await fetchRange(sourceUrl, 0, headerEnd - 1)
    const key = contentKey(spadeA)
    const media = buildMedia(head, key, total)
    const id = UUID.string().replace(/-/g, "").slice(0, 16)
    this.sessions.set(id, { url: sourceUrl, media, total, sink })
    return {
      url: `${base}/v/${id}`,
      sessionId: id,
      codec: media.codec,
      samples: media.sampleCount,
      total,
      encrypted: media.encrypted,
      ivSize: media.ivSize,
      release: () => { this.sessions.delete(id) },
    }
  }

  /**
   * 离线下载：整片解密后写入 targetPath（明文 MP4）。
   * 按 4MB 分块走同一套 readRange（内部自动 8 路并发拉密文），边解边 append，不整片占内存。
   */
  async downloadToFile(sourceUrl: string, spadeA: string, targetPath: string, onProgress?: (ratio: number, bytes: number) => void, cancelled?: () => boolean): Promise<{ bytes: number; total: number; encrypted: boolean }> {
    const prepared = await this.prepare(sourceUrl, spadeA)
    try {
      const session = this.sessions.get(prepared.sessionId)
      if (!session) throw new Error("解密会话已失效")
      const total = prepared.total
      const CHUNK = 2 * 1024 * 1024
      let written = 0
      while (written < total) {
        if (cancelled?.()) break
        const to = Math.min(written + CHUNK, total) - 1
        const bytes = await this.readRange(session, written, to)
        const piece = dataOf(bytes)
        if (written === 0) FileManager.writeAsDataSync(targetPath, piece)
        else FileManager.appendDataSync(targetPath, piece)
        written += bytes.length
        onProgress?.(total ? written / total : 1, written)
      }
      return { bytes: written, total, encrypted: prepared.encrypted }
    } finally {
      prepared.release()
    }
  }

  private async readRange(session: Session, from: number, to: number): Promise<Uint8Array> {
    const { media } = session
    const out = new Uint8Array(to - from + 1)
    if (from < media.headerEnd) {
      const n = Math.min(to + 1, media.headerEnd) - from
      out.set(media.header.subarray(from, from + n), 0)
    }
    if (to >= media.headerEnd) {
      const start = Math.max(from, media.headerEnd)
      const aligned = alignedRange(media, start, to + 1)
      const cipher = await fetchRangeParallel(session.url, aligned.start, aligned.end - 1)
      decryptBuffer(media, cipher, aligned.start)
      out.set(cipher.subarray(start - aligned.start, to + 1 - aligned.start), start - from)
    }
    this.accumulate(session, out, from, to)
    return out
  }

  /**
   * 把本次响应里的明文接着攒进缓存槽（只认从 0 开始**连续**的部分）。
   * 攒满整集（说明这一集真的从头被播完）才开始写盘，然后交给 cache 登记。
   */
  private accumulate(session: Session, bytes: Uint8Array, from: number, to: number): void {
    const sink = session.sink
    if (!sink || sink.buf.length === 0 || sink.saving) return
    if (from > sink.end) return
    const limit = Math.min(to + 1, sink.buf.length)
    const count = limit - from
    if (count <= 0) return
    sink.buf.set(bytes.subarray(0, count), from)
    if (from + count > sink.end) sink.end = from + count
    if (sink.end < session.total) return
    sink.saving = true
    const buf = sink.buf
    sink.buf = new Uint8Array(0) // 落盘期间不再占着这份内存
    void this.flushCache(sink, buf, session.total)
  }

  /** 整集攒满 → 分片写盘（每片之间让出主线程，避免长同步 IO 卡住画面）。 */
  private async flushCache(sink: CacheSink, buf: Uint8Array, total: number): Promise<void> {
    const CHUNK = 4 * 1024 * 1024
    try {
      // 第一片用 write（顺手覆盖旧文件），其余 append。
      // ⚠️ 不依赖「空 Data」：API 对空 ArrayBuffer 可能返回 null，而 dataOf 会因此抛错，
      // 会把「清空目标文件」这一步变成异常。
      for (let offset = 0; offset < total; offset += CHUNK) {
        const piece = dataOf(buf.subarray(offset, Math.min(offset + CHUNK, total)))
        if (offset === 0) FileManager.writeAsDataSync(sink.path, piece)
        else FileManager.appendDataSync(sink.path, piece)
        await new Promise<void>(resolve => { setTimeout(() => resolve(), 0) })
      }
      sink.onSaved(total)
    } catch (error) {
      console.error("红果自动缓存写入失败", String(error))
      try { FileManager.removeSync(sink.path) } catch { /* ignore */ }
    }
  }

  private async handle(request: HttpRequest): Promise<HttpResponse> {
    const session = this.sessions.get(request.params.id ?? "")
    if (!session) { this.debugLog.push(`${request.method} ${request.target} -> 404`); return HttpResponse.notFound() }
    const { total } = session
    const header = request.headers["range"] ?? request.headers["Range"] ?? ""
    let from = 0, to = total - 1, partial = false
    const match = /bytes=(\d*)-(\d*)/.exec(header)
    if (match) {
      partial = true
      if (match[1]) {
        from = Number(match[1])
        to = match[2] ? Number(match[2]) : total - 1
      } else if (match[2]) {
        from = Math.max(0, total - Number(match[2]))
        to = total - 1
      }
    }
    if (Number.isNaN(from) || Number.isNaN(to) || from >= total || to < from) {
      this.debugLog.push(`${request.method} range=${header} -> 416`)
      return HttpResponse.raw(416, "Range Not Satisfiable", { headers: { "content-range": `bytes */${total}` } })
    }
    if (request.method.toUpperCase() === "HEAD") {
      this.debugLog.push(`HEAD range=${header} -> 200 head-only`)
      return HttpResponse.raw(200, "OK", {
        headers: {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-length": String(total),
        },
      })
    }
    to = partial ? Math.min(to, total - 1, from + MAX_CHUNK - 1) : total - 1
    let bytes: Uint8Array
    try {
      bytes = await this.readRange(session, from, to)
    } catch (error) {
      this.debugLog.push(`GET range=${header} -> 500 ${String(error)}`)
      console.error("红果代理读取失败", String(error))
      return HttpResponse.internalServerError()
    }
    this.debugLog.push(`${request.method} range=${header || "(none)"} -> ${partial ? 206 : 200} ${from}-${from + bytes.length - 1}/${total}`)
    if (partial) {
      return HttpResponse.raw(206, "Partial Content", {
        headers: {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-length": String(bytes.length),
          "content-range": `bytes ${from}-${from + bytes.length - 1}/${total}`,
          "cache-control": "no-store",
        },
        body: dataOf(bytes),
      })
    }
    return HttpResponse.raw(200, "OK", {
      headers: {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-length": String(bytes.length),
        "cache-control": "no-store",
      },
      body: dataOf(bytes),
    })
  }
}

export const mediaProxy = new MediaProxy()
