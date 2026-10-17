import {
  Navigation, Script, TabView, Tab,
  VStack, HStack, Text, Button, TextField,
  Spacer, ScrollView, Image, LazyVGrid, ProgressView,
  useState, useEffect, useMemo, useCallback, fetch, VideoPlayer,
  NavigationStack, List, Section, GeometryReader, WebView,
} from "scripting"
import { abogus } from "./abogus"

// (download 函数运行时不存在，已改用 fetch + Data + FileManager)
// Data.fromArrayBuffer 由运行时 Data 类提供，无需 custom declare

const KEY_SEC_UID = "douyin_sec_uid"
const KEY_HISTORY = "douyin_history"
const KEY_SAVED_USERS = "douyin_saved_users"
const KEY_COOKIE = "douyin_cookie"
const KEY_UIFID = "douyin_uifid"
const KEY_DEVICE_ID = "douyin_device_id"
const KEY_INSTALL_ID = "douyin_install_id"
const KEY_SEEN_VERSION = "seen_version"
const SCRIPT_VERSION = "1.0.37"

// 运行时全局对象
declare const screen: { width: number; height: number; scale: number } | undefined

interface VideoInfo {
  aweme_id: string; desc: string; create_time: number; cover: string
  play_url: string; duration: number; digg_count: number
  comment_count: number; author_nickname: string; author_avatar: string; unique_id: string; author_ip_location: string
  images: ImageInfo[]
  /** 1 = 作者置顶（服务端不一定给；给了就必须排在最前） */
  is_top?: number
}
interface ImageInfo {
  url: string        // 静态图片 URL
  videoUrl?: string  // 动图视频 URL（API 中部分图片带此字段）
}
interface HistoryItem extends VideoInfo { viewed_at: number }
interface SavedUser { id: string; nickname: string; avatar: string; savedAt: number; shortId?: string; totalFavorited?: number; followingCount?: number; followerCount?: number; signature?: string; ipLocation?: string; gender?: number }

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const ANDROID_UA = "Mozilla/5.0 (Android; Mobile; rv:54.0) Gecko/54.0 Firefox/54.0"
// 网页端签名（x-secsdk-web-signature）配合使用的桌面 UA
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
// secsdk VM 字符串表常量（project douyin_web id 34），与账号无关
const SECSDK_SALT = "A96D855A08C0A9707F8BEF0D9A527E4E"
const POST_PAGE_SIZE = 30

// ─── 移动端免签通道（2026-10-12 真机实测结论） ───
// 与 web 通道不同：只要 iid 用真的 install_id，
//   /aweme/v1/feed/ 与 /aweme/v1/aweme/detail/ 完全免签名 / 免 Cookie / 免 uifid 就能拿到数据；
//   /aweme/v1/aweme/post/ 也能出数据，但很快会被服务端按 IP 限流（之后同 IP 一律返空）→ 只当加速通道。
// ⚠️ 千万不要带 x-gorgon / x-argus 等签名头：实测带上反而会返空。
const APP_UA = "Aweme/404017 CFNetwork/3896.100.1.2.1 Darwin/27.0.0"
const MOBILE_HOSTS = ["api5-normal-c-lq.amemv.com", "api.amemv.com"]
const MOBILE_VERSION_CODE = "40.4.0"
const MOBILE_UPDATE_VERSION_CODE = "40409917"
const DEFAULT_DEVICE_ID = "1923489864614387"
const DEFAULT_INSTALL_ID = "7683339722235938341"

// ─── 工具函数 ───
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
function pickFirstUrl(urls?: string[]): string { if (!urls || urls.length === 0) return ""; const h = urls.find((u) => u.startsWith("https://")); return h || urls[0] || "" }

/** 检测是否是 GIF 动图 URL（通过路径扩展名） */
function isGifUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    const path = u.pathname.toLowerCase()
    return path.endsWith(".gif")
  } catch {
    const path = url.split("?")[0].split("#")[0].toLowerCase()
    return path.endsWith(".gif")
  }
}


/**
 * 检测 Data 是否为 GIF 动图（通过 magic bytes）。
 * GIF89a / GIF87a 开头即为 GIF。
 */
function isGifData(data: Data): boolean {
  try {
    const bytes = data.toUint8Array()
    if (!bytes || bytes.length < 6) return false
    // GIF89a = 0x47 0x49 0x46 0x38 0x39 0x61
    // GIF87a = 0x47 0x49 0x46 0x38 0x37 0x61
    return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
           bytes[3] === 0x38 && (bytes[4] === 0x39 || bytes[4] === 0x37) && bytes[5] === 0x61
  } catch { return false }
}

/** 取 url_list 中最高画质的 URL（通常最后一个是最高画质 CDN） */
function pickBestUrl(urls?: string[]): string {
  if (!urls || urls.length === 0) return ""
  const https = urls.filter((u) => u.startsWith("https://"))
  return https.length > 0 ? https[https.length - 1] : (urls[0] || "")
}
function formatDuration(ms: number): string { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}` }
function formatCount(n: number): string { if (n >= 10000) return (n / 10000).toFixed(1) + "w"; if (n >= 1000) return (n / 1000).toFixed(1) + "k"; return String(n) }
function getGridCardWidth(): number {
  const screenWidth = (typeof screen !== 'undefined' && typeof screen?.width === 'number') ? screen.width : 390
  // List/Section 会吃掉一部分可用宽度；这里用保守值，避免 hit area 压到相邻 cell。
  const horizontalPadding = 64
  const columnSpacing = 14 * 2
  return Math.floor((screenWidth - horizontalPadding - columnSpacing) / 3)
}

async function writeDataFile(path: string, data: Data): Promise<void> {
  if (await FileManager.exists(path)) {
    await FileManager.remove(path)
  }
  try {
    // @ts-ignore
    await FileManager.writeAsData(path, data)
  } catch (writeErr: any) {
    throw new Error(`写入文件失败: ${writeErr?.message || String(writeErr)}`)
  }
}

async function createLivePhotoPairFromVideoPath(videoPath: string, baseName: string) {
  const basePath = FileManager.documentsDirectory + baseName
  const imagePath = `${basePath}.jpg`
  const liveVideoPath = `${basePath}.mov`
  if (await FileManager.exists(imagePath)) await FileManager.remove(imagePath)
  if (await FileManager.exists(liveVideoPath)) await FileManager.remove(liveVideoPath)
  return await LivePhoto.createFromVideo({
    videoPath,
    imageOutputPath: imagePath,
    videoOutputPath: liveVideoPath,
    stillTime: 0,
    maxDuration: 10,
    imageFormat: "jpeg",
    quality: 0.9,
    includeAudio: false,
  })
}

/** 从 aweme_id 构造抖音分享链接 */
function getShareUrl(video: VideoInfo): string {
  return `https://www.douyin.com/video/${video.aweme_id}`
}

/**
 * 安全解析 JSON（容错多种格式）
 */
function safeJSONParse(text: string | null | undefined): unknown | null {
  if (!text) return null
  const candidates = [
    text,
    text.trim(),
    text.replace(/\u2028|\u2029/g, ""),
    text.replace(/\\u002F/g, "/"),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === "string") {
        try { return JSON.parse(parsed) } catch { return parsed }
      }
      return parsed
    } catch {}
  }
  return null
}

/** 优先选 CDN 直链（douyinvod / tos），避开需要重定向的 play 接口 */
function pickBestPlayUrl(urlList: string[]): string {
  if (!urlList || urlList.length === 0) return ""
  const direct = urlList.find((u) => u.includes("douyinvod.com") || u.includes("/video/tos/"))
  return direct || urlList[urlList.length - 1] || urlList[0] || ""
}

/**
 * 画质上限（按视频短边 = min(宽,高)，竖屏横屏通用）。
 * 校准值 = 1440（2K）：抖音暂不追 4K/8K（那是服务端硬门禁，见 README 1.0.12 记录）。
 * 写 0 = 不限（若只有比上限更高的档，会自动回退到取最高）。
 */
const MAX_VIDEO_SHORT_SIDE = 1440

/**
 * 画质下限（按短边）。0 = 不设下限。
 * 用户 2026-10-12 定调：不拦截 —— 作品本身只有 720p 就下 720p（这种情况少，因为现在最低都是 1080）。
 * 改成 1080 即启用「低于 1080 就不下、并告知原因」的拦截模式。
 */
const MIN_VIDEO_SHORT_SIDE = 0

type VideoAddrCand = { urlList: string[]; q: number; gear: string; std: boolean }

/** 短边 = 长宽里小的那个；“1080p / 1440p”指的就是它，竖屏横屏都成立 */
function addrShortSide(addr: any): number {
  const w = addr?.width || 0
  const h = addr?.height || 0
  return w > 0 && h > 0 ? Math.min(w, h) : 0
}

/** 收集 video 对象里所有可用的播放地址档位（含 bit_rate[]）
 *  std=true = 标准编码档（play_addr 系列）：iOS 一定能解码/存相册。
 *  ⚠️ bit_rate[] 里可能是抖音自研编码（fourcc=bvc2），iOS 既不能播也不能存，只能靠读文件头区分。 */
function collectVideoAddrs(video: any): VideoAddrCand[] {
  const out: VideoAddrCand[] = []
  const push = (addr: any, gear: string, std: boolean) => {
    if (!addr?.url_list?.length) return
    let q = addrShortSide(addr)
    if (!q) {
      // 档位没带尺寸时，用 gear_name（如 1080_1_2 / 1440_1_1）的首段兜底 —— 它就是短边
      const m = gear.match(/(\d{3,4})_/)
      if (m) q = parseInt(m[1], 10)
    }
    out.push({ urlList: addr.url_list, q, gear, std })
  }
  // ⚠️ bit_rate[] 一律不参与选档：里面大量是抖音自研编码（fourcc=bvc2），iOS 既不能解码也不能存相册。
  // 需要它那个分辨率时，走 play 接口的 ratio 参数拿标准编码版本（见 tryRatioPlayUrl）。
  push(video?.play_addr, "play_addr", true)
  push(video?.play_addr_h264, "play_addr_h264", true)
  push(video?.play_addr_265, "play_addr_265", true)
  return out
}

/**
 * 视频的最高分辨率（短边），**包含 bit_rate[] 里那些 iOS 用不了的档**。
 * 用途：当作 play 接口 ratio 的目标值 —— 自研编码档的分辨率本身是真的，
 * 只是要换一个 iOS 能用的编码去拿同分辨率。
 */
function videoMaxShortSide(video: any): number {
  let maxQ = 0
  const consider = (a: any, gear: string) => {
    if (!a?.url_list?.length) return
    let q = addrShortSide(a)
    if (!q) { const m = gear.match(/(\d{3,4})_/); if (m) q = parseInt(m[1], 10) }
    if (q > maxQ) maxQ = q
  }
  consider(video?.play_addr, "play_addr")
  consider(video?.play_addr_h264, "play_addr_h264")
  consider(video?.play_addr_265, "play_addr_265")
  const brs = video?.bit_rate
  if (Array.isArray(brs)) for (const br of brs) consider(br?.play_addr, String(br?.gear_name || ""))
  return maxQ
}

// iOS 系统相册/播放器能处理的视频编码：avc 系=H.264，hvc 与 hev 系=HEVC，dvh 系=杜比
const IOS_OK_VIDEO_CODECS = ["avc1", "avc2", "avc3", "avc4", "hvc1", "hvc2", "hev1", "hev2", "dvh1", "dvhe", "mp4v"]

/** 音轨编码（用来从 stsd 里区分音/视频轨） */
const AUDIO_SAMPLE_FORMATS = ["mp4a", "alac", "ac-3", "ec-3", "opus", "sowt", "lpcm", "twos", "ulaw", "alaw", "samr", "sawb"]

/**
 * 从文件头解析视频轨：编码 fourcc + 真实宽高。
 * 扫描所有 stsd box；visual sample entry 的宽/高在 entry 起始 +32 / +34（大端 2 字节，
 * 已用 1080x1920 的实文件定位验证过）。
 * 读不到返回 { codec: "" }（调用方据此放过，不做无依据的拒绝）。
 */
function sniffVideoTrack(bytes: Uint8Array): { codec: string; w: number; h: number } {
  const EMPTY = { codec: "", w: 0, h: 0 }
  const dec = (i: number) => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1]
  for (let i = 0; i + 16 <= bytes.length; i++) {
    if (!(bytes[i] === 0x73 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x73 && bytes[i + 3] === 0x64)) continue // "stsd"
    const count = u32(i + 8)
    let off = i + 12
    for (let k = 0; k < Math.min(count, 4); k++) {
      if (off + 8 > bytes.length) return EMPTY
      const size = u32(off)
      const fmt = dec(off + 4)
      const isAudio = AUDIO_SAMPLE_FORMATS.includes(fmt)
      if (fmt.length === 4 && !isAudio) {
        const w = off + 36 <= bytes.length ? u16(off + 32) : 0
        const h = off + 36 <= bytes.length ? u16(off + 34) : 0
        return { codec: fmt, w, h }
      }
      if (size < 8) return EMPTY
      off += size
    }
  }
  return EMPTY
}

/**
 * 按画质选档：取**短边最大**的一档（同档位时按采集顺序，优先 play_addr）。
 * ⚠️ 两个坑：
 *  ① 不能按字段名硬选 —— 移动端 play_addr_h264 常常是低清兼容档
 *     （实测竖屏作品：play_addr_h264=576x1024，而 1080p 在 bit_rate:1080_1_2=1080x1920）；
 *  ② 不能拿 height 跟固定值比 —— 竖屏视频的 height 是长边（1024/1920/2560），
 *     拿 “height ≤ 1080” 去筛会把 540p（576x1024）当上限。**一律用短边**。
 */
function pickVideoAddrByQuality(video: any): VideoAddrCand | null {
  return pickVideoAddrCandidates(video)[0] || null
}

/** 标准编码档（play_addr 系列）里画质最高的一档：iOS 一定能解码与存相册 */
function pickStandardVideoAddr(video: any): VideoAddrCand | null {
  const all = collectVideoAddrs(video)
  if (!all.length) return null
  const std = all.filter((c) => c.std)
  const pool = std.length > 0 ? std : all
  return pool.slice().sort((a, b) => b.q - a.q)[0]
}

/** 播放/兜底用：标准编码档的最高画质 URL */
function pickStandardVideoUrl(video: any): string {
  const c = pickStandardVideoAddr(video)
  return c ? pickBestPlayUrl(c.urlList) : ""
}

/** 所有档位按画质从高到低（同档位保持采集顺序，即 play_addr 优先） */
function pickVideoAddrCandidates(video: any): VideoAddrCand[] {
  const cands = collectVideoAddrs(video)
  if (!cands.length) return []
  const withQ = cands.filter((c) => c.q > 0)
  const use = withQ.length > 0 ? withQ : cands
  const cap = MAX_VIDEO_SHORT_SIDE
  const pool = cap > 0 ? use.filter((c) => c.q <= cap) : use
  return (pool.length > 0 ? pool : use).sort((a, b) => b.q - a.q)
}

/** 最近一次选档时的跳档说明（哪些档位地址失效），供导出的诊断信息展示 */
let lastPickNotes: string[] = []
/** 非空表示：因「低于画质下限」而主动取消下载（此时不能回退到更低清地址） */
let lastPickBlockedReason = ""
/**
 * 最近一次选中地址的探测结果（速度优化）。
 * 下载时复用：`total` 免掉 HEAD 探大小，`head`（前 128KB）直接当第一块。
 */
let lastProbe: { url: string; total: number; head: Data | null } = { url: "", total: 0, head: null }

/** 作品详情缓存（60 秒）：同一作品反复导出时，免掉一次详情请求往返 */
const DETAIL_TTL_MS = 60000
let detailCache: { id: string; at: number; detail: any } | null = null
function cacheDetail(id: string, detail: any): any {
  detailCache = { id, at: Date.now(), detail }
  return detail
}

/**
 * 探测一个档位地址能不能用，并读出视频轨编码。
 * 取文件头 128KB：① 体积校验（挡住 4xx 与几百字节的错误页）；② 解析 stsd 得到视频编码。
 * ⚠️ 抖音 bit_rate[] 里会出现自研编码（fourcc=bvc2）—— iOS 既不能播放也不能存相册，
 *    而 API 的 is_h265 / format 字段区分不出来，**只能靠读文件头**。
 */
type ProbeResult = { ok: boolean; codec: string; w: number; h: number; total: number; head: Data | null }

/**
 * 探测一个档位地址能不能用，并读出视频轨编码。
 * 取文件头 128KB：① 体积校验（挡住 4xx 与几百字节的错误页）；② 解析 stsd 得到视频编码。
 * ⚠️ 抖音 bit_rate[] 里会出现自研编码（fourcc=bvc2）—— iOS 既不能播放也不能存相册，
 *    而 API 的 is_h265 / format 字段区分不出来，**只能靠读文件头**。
 *
 * ⭐ 速度优化：同时带回 `total`（文件总大小）与 `head`（这 128KB 本身）。
 *    下载时可直接复用：省掉一次 HEAD 探大小、而且这 128KB 就是首块（见 downloadWithProgress）。
 */
async function probePlayableUrl(url: string, headers: Record<string, string>): Promise<ProbeResult> {
  const FAIL: ProbeResult = { ok: false, codec: "", w: 0, h: 0, total: 0, head: null }
  try {
    const resp = await timeoutFetch(fetch(url, { headers: { ...headers, Range: "bytes=0-131071" } }), 9000)
    if (resp.status >= 400) return FAIL
    const cr = resp.headers.get("Content-Range") || resp.headers.get("content-range") || ""
    const cl = resp.headers.get("Content-Length") || resp.headers.get("content-length")
    const m = cr.match(/\/(\d+)\s*$/)
    const total = m ? parseInt(m[1], 10) : cl ? parseInt(cl, 10) : 0
    if (total > 0 && total < 65536) return FAIL                                      // 几百字节的错误页
    const buf = await resp.arrayBuffer()
    const head = Data.fromArrayBuffer(buf)
    const t = sniffVideoTrack(new Uint8Array(buf))
    if (!t.codec) return { ok: true, codec: "", w: t.w, h: t.h, total, head }        // 头里读不到（moov 在文件尾）→ 放过
    return { ok: IOS_OK_VIDEO_CODECS.includes(t.codec), codec: t.codec, w: t.w, h: t.h, total, head }
  } catch {
    return { ok: true, codec: "", w: 0, h: 0, total: 0, head: null }                 // 探测本身失败 → 放过，不做无依据的拒绝
  }
}

/* 播放接口主机（App 自己也是用这个域名做播放跳转的） */
const PLAY_HOSTS = ["api-play.amemv.com", "api5-normal-c-lq.amemv.com"]

/** 同步构造 play 接口的 ratio 地址（播放/回退用，不做探测）。实测该接口最高只给 1080p，超出的会被服务端裁到 1080p。 */
function ratioPlayUrlSync(video: any, targetShort: number): string {
  const uri = video?.play_addr?.uri || ""
  if (!uri || targetShort <= 0) return ""
  return `https://${PLAY_HOSTS[0]}/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=${targetShort}p&line=0`
}

/**
 * 当最高分辨率那一档是 iOS 不支持的编码（如 bvc2）时，用 play 接口的 ratio 参数
 * 取同一分辨率的**标准编码**版本。
 * 实测：/aweme/v1/play/?video_id=<uri>&ratio=1080p → 302 → H.264 1080x1920（ffprobe 确认），可播可存；
 *       请求的 ratio 超出现有时会被服务端自动向下裁到可用值。
 */
async function tryRatioPlayUrl(video: any, targetShort: number, headers: Record<string, string>): Promise<{ url: string; codec: string; w: number; h: number; total: number; head: Data | null } | null> {
  const uri = video?.play_addr?.uri || video?.play_addr_265?.uri || video?.play_addr_h264?.uri || ""
  if (!uri) return null
  // 服务端会把超出的 ratio 自动裁到可用最大值，所以只需目标值 + 一个保底值（实测 1440p 请求 → 得到该视频最好的 H.264）
  const targets: number[] = []
  for (const t of [targetShort, 1080]) {
    if (t > 0 && !targets.includes(t)) targets.push(t)
  }
  for (const t of targets) {
    for (const host of PLAY_HOSTS) {
      const u = `https://${host}/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=${t}p&line=0`
      const r = await probePlayableUrl(u, headers)
      if (r.ok && r.codec) return { url: u, codec: r.codec, w: r.w, h: r.h, total: r.total, head: r.head }
    }
  }
  return null
}

/**
 * 从高到低挑第一个「真能下、且 iOS 能存/能播」的档位 URL（下载专用）。
 * 跳过：体积异常/4xx 的失效地址，以及 bvc2 等系统不支持的编码档位。
 * 全部不通过时退回标准编码档（avc1/hvc1）——至少能被相册接受。
 */
async function pickPlayableVideoUrl(video: any): Promise<string> {
  lastPickNotes = []
  lastPickBlockedReason = ""
  const cands = pickVideoAddrCandidates(video)
  if (!cands.length) return ""
  const headers = { "User-Agent": MOBILE_UA, "Referer": "https://www.douyin.com/" }
  const clip = (u: string) => (u.includes("/playwm/") ? u.replace("/playwm/", "/play/") : u)
  let tried = 0
  for (const c of cands) {
    const urls = c.urlList.filter((u) => u.startsWith("http"))
    if (!urls.length) continue
    // 先试 CDN 直链，再试需要重定向的 play 接口
    const ordered = [...urls].sort((a, b) => (pickBestPlayUrl([b]) === b ? 1 : 0) - (pickBestPlayUrl([a]) === a ? 1 : 0))
    for (const raw of ordered) {
      tried++
      const u = clip(raw)
      const r = await probePlayableUrl(u, headers)
      if (r.ok) {
        // 标准档里的可用最高画质；若视频还有更高分辨率（那档是 iOS 用不了的自研编码），
        // 用 play 接口的 ratio 参数取同分辨率的标准编码版本
        const maxQ = videoMaxShortSide(video)
        let url = u
        let chosenQ = Math.min(r.w, r.h) || c.q
        let label = r.w ? `${r.w}×${r.h} ${r.codec}` : `${c.q}p ${r.codec}`
        let chosenTotal = r.total
        let chosenHead = r.head
        if (maxQ > c.q) {
          const rec = await tryRatioPlayUrl(video, maxQ, headers)
          if (rec && Math.min(rec.w, rec.h) > c.q) {
            url = rec.url
            chosenQ = Math.min(rec.w, rec.h)
            label = `${rec.w}×${rec.h} ${rec.codec}`
            chosenTotal = rec.total
            chosenHead = rec.head
          }
        }
        // 画质下限：低于它就没意义（比现有 1080 还差）→ 取消下载并说明原因
        if (MIN_VIDEO_SHORT_SIDE > 0 && chosenQ < MIN_VIDEO_SHORT_SIDE) {
          lastPickBlockedReason = `该作品平台只提供 ${chosenQ}p，低于 ${MIN_VIDEO_SHORT_SIDE}p 下限`
          lastPickNotes.push(`已取消下载：${lastPickBlockedReason}`)
          return ""
        }
        lastPickNotes.push(`画质 ${label}`)
        // 把探测结果交给下载环节复用（省掉 HEAD + 首块两次往返）
        lastProbe = { url, total: chosenTotal, head: chosenHead }
        return url
      }
      if (r.codec) lastPickNotes.push(`跳过不可用档位 ${c.gear}(${c.q}p)`)
    }
  }
  const stdUrl = pickStandardVideoUrl(video)
  if (stdUrl) {
    lastPickNotes.push("所有档位均未通过校验，已退回标准编码档（H.264/HEVC）保底")
    return clip(stdUrl)
  }
  const c0 = pickVideoAddrByQuality(video)
  const fallback = c0 ? pickBestPlayUrl(c0.urlList) : ""
  if (fallback) lastPickNotes.push("所有档位探测均失败，已按最高档保底尝试")
  return clip(fallback)
}

/** 取某个 video 对象的最佳播放地址（列表/播放用）
 *  ⚠️ 播放必须避开 bit_rate[] 里的自研编码（fourcc=bvc2，iOS 无解码器 → 黑屏），
 *    所以这里只用标准编码档；下载另走 pickPlayableVideoUrl（读文件头校验，能安全用高画质档）。 */
function bestPlayUrl(video: any): string {
  const std = pickStandardVideoAddr(video)
  const stdUrl = std ? pickBestPlayUrl(std.urlList) : ""
  // 标准档低于作品最高分辨率（说明最高那档是 iOS 用不了的自研编码）
  // → 观看也改用 play 接口拿同分辨率的正码版本，别在播放上降画质
  const maxQ = videoMaxShortSide(video)
  if (std && maxQ > std.q) {
    const ru = ratioPlayUrlSync(video, maxQ)
    if (ru) return ru
  }
  if (stdUrl) return stdUrl
  return pickBestUrl(video?.play_addr?.url_list) || pickBestUrl(video?.download_addr?.url_list) || ""
}

/**
 * 从 aweme_detail 中提取无水印视频 URL
 * 将 /playwm/ 替换为 /play/ 获取无水印版本
 */
function extractVideoUrlFromAweme(awemeDetail: any): string | null {
  if (!awemeDetail?.video) return null
  const video = awemeDetail.video
  
  // 按短边选**最高画质**档（竖屏/横屏都正确）——不能按字段名硬选，
  // 也不能拿 height 比固定值（竖屏 height 是长边）
  const bestAddr = pickStandardVideoAddr(video)
  const urlList = bestAddr ? bestAddr.urlList : []
  
  if (urlList.length > 0) {
    // 优先 CDN 直链（douyinvod / tos），其次才用需要重定向的 play 接口
    let url = pickBestPlayUrl(urlList)
    // playwm → play 转换获取无水印版本
    if (url.includes("/playwm/")) {
      url = url.replace("/playwm/", "/play/")
    }
    return url
  }
  
  // 尝试 bit_rate
  if (video.bit_rate?.length > 0) {
    for (const br of video.bit_rate) {
      if (br.play_addr?.url_list?.length > 0) {
        let url = pickBestPlayUrl(br.play_addr.url_list)
        if (url.includes("/playwm/")) {
          url = url.replace("/playwm/", "/play/")
        }
        return url
      }
    }
  }
  
  return null
}

/**
 * 从 aweme_detail 中提取图片 URL 列表（图文作品）
 */
function extractImagesFromAweme(awemeDetail: any): string[] {
  if (!awemeDetail?.images || !Array.isArray(awemeDetail.images)) return []
  
  const urls: string[] = []
  for (const img of awemeDetail.images) {
    if (img?.url_list?.length > 0) {
      // 取最高画质（最后一个 HTTPS URL）
      const httpsUrls = img.url_list.filter((u: string) => u.startsWith("https://"))
      urls.push(httpsUrls.length > 0 ? httpsUrls[httpsUrls.length - 1] : img.url_list[0])
    }
  }
  return urls
}

/**
 * 从 _ROUTER_DATA 中提取 aweme_detail
 * 支持多种嵌套结构：
 * - loaderData.*.videoInfoRes.data.aweme_detail
 * - loaderData.*.aweme_detail
 * - 直接 aweme_detail
 */
function extractAwemeFromRouterData(routerData: any): any {
  if (!routerData) return null
  
  // 直接包含 aweme_detail
  if (routerData.aweme_detail) return routerData.aweme_detail
  
  // 从 loaderData 中提取
  const loaderData = routerData.loaderData || {}
  for (const key of Object.keys(loaderData)) {
    const loader = loaderData[key]
    if (!loader || typeof loader !== "object") continue
    
    // videoInfoRes 路径
    if (loader.videoInfoRes?.data?.aweme_detail) {
      return loader.videoInfoRes.data.aweme_detail
    }
    // 直接 aweme_detail
    if (loader.aweme_detail) {
      return loader.aweme_detail
    }
  }
  
  return null
}

/**
 * 通过 WebView 加载抖音分享页面，解析 _ROUTER_DATA 获取无水印资源 URL
 * 替代不稳定的第三方去水印 API
 * 
 * @param video 视频信息（需要 aweme_id）
 * @param isImage 是否提取图片（可选，自动检测）
 * @returns { url: 无水印URL, imageUrls: 图文作品的图片列表 }
 */
/** 用网页端签名请求作品详情，返回 aweme_detail（失败返回 null） */
// ─── 移动端免签通道 helper ───
function mobileCommonParams(): Record<string, string> {
  const deviceId = (Storage.get<string>(KEY_DEVICE_ID) || "").trim() || DEFAULT_DEVICE_ID
  const installId = (Storage.get<string>(KEY_INSTALL_ID) || "").trim() || DEFAULT_INSTALL_ID
  return {
    device_platform: "iphone", aid: "1128", channel: "App Store", app_name: "aweme",
    version_code: MOBILE_VERSION_CODE, version_name: MOBILE_VERSION_CODE,
    device_type: "iPhone17,3", os_version: "27.0.1",
    update_version_code: MOBILE_UPDATE_VERSION_CODE,
    iid: installId, device_id: deviceId,
  }
}

/** 依次尝试移动端主机；成功则返回响应文本（空响应/HTTP 错误会换下一个主机） */
async function mobileGet(path: string, extra: Record<string, string>, timeoutMs: number = 12000): Promise<string> {
  const params: Record<string, string> = { ...mobileCommonParams(), ...extra }
  const qs = Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&")
  let lastErr = "未知错误"
  for (const host of MOBILE_HOSTS) {
    try {
      const resp = await timeoutFetch(fetch(`https://${host}${path}?${qs}`, {
        headers: { "User-Agent": APP_UA, "Accept": "*/*" },
      }), timeoutMs)
      if (!resp.ok) { lastErr = `HTTP ${resp.status}`; continue }
      const text = await resp.text()
      if (text && text.length > 0) return text
      lastErr = "空响应"
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e) }
  }
  throw new Error(lastErr)
}

/** 最近一次详情请求被服务端过滤的原因（如 core_dep），用于把失败原因讲清楚 */
let lastDetailFilterReason = ""

async function fetchAwemeDetail(awemeId: string): Promise<any | null> {
  lastDetailFilterReason = ""
  // 60 秒内同一作品直接复用（反复导出同一作品时免掉一次往返）
  if (detailCache && detailCache.id === awemeId && Date.now() - detailCache.at < DETAIL_TTL_MS) {
    return detailCache.detail
  }
  // ① 移动端免签接口：不依赖 Cookie / uifid / 签名，最快最稳
  try {
    const text = await mobileGet("/aweme/v1/aweme/detail/", {
      aweme_id: awemeId, _rticket: String(Date.now()),
    })
    const data = JSON.parse(text)
    if (data?.aweme_detail) return cacheDetail(awemeId, data.aweme_detail)
    // 200 但没有 aweme_detail = 被服务端过滤（core_dep：已下架/受限/广告素材），记下原因继续试网页端
    if (data?.filter_detail?.filter_reason) lastDetailFilterReason = String(data.filter_detail.filter_reason)
  } catch {}
  // ② 网页端签名接口（依赖 uifid）
  try {
    const uifid = await ensureUifid()
    if (!uifid) return null
    const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
    const rawQuery = `device_platform=webapp&aid=6383&aweme_id=${awemeId}&cookie_enabled=true&platform=PC`
    const signed = websignQuery(rawQuery, uifid)
    const resp = await fetch(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${signed}`, {
      headers: {
        "User-Agent": DESKTOP_UA,
        "Referer": "https://www.douyin.com/",
        "Accept": "application/json, text/plain, */*",
        "uifid": uifid,
        "Cookie": cookie,
      },
    })
    if (!resp.ok) return null
    const text = await resp.text()
    if (!text) return null
    const data = JSON.parse(text)
    if (data?.aweme_detail) return cacheDetail(awemeId, data.aweme_detail)
    if (data?.filter_detail?.filter_reason) lastDetailFilterReason = String(data.filter_detail.filter_reason)
    return null
  } catch { return null }
}

async function extractNoWatermarkUrl(
  video: VideoInfo,
  isImage?: boolean,
  imageIndex: number = 0
): Promise<{ url: string; imageUrls: string[] }> {
  // 每次解析都重置跳档说明，避免上一次导出残留
  lastPickNotes = []
  // ① 优先走签名接口：不依赖 WebView 渲染，直接拿到 CDN 无水印直链
  try {
    const detail = await fetchAwemeDetail(video.aweme_id)
    if (detail) {
      const imageUrls = extractImagesFromAweme(detail)
      const hasImages = !!(detail.images && detail.images.length > 0)
      const hasVideo = !!(detail.video && (detail.video.play_addr || detail.video.play_addr_h264))
      if ((isImage || (hasImages && !hasVideo)) && imageUrls.length > 0) {
        return { url: imageUrls[imageIndex] || imageUrls[0], imageUrls }
      }
      const detailVideoUrl = detail.video ? await pickPlayableVideoUrl(detail.video) : null
      if (detailVideoUrl) return { url: detailVideoUrl, imageUrls }
    }
  } catch {}
  // ② 回退：WebView 页面解析
  const shareUrl = getShareUrl(video)
  const webView = new WebViewController({ ephemeral: true })
  
  try {
    webView.setCustomUserAgent(MOBILE_UA)
    await webView.loadURL(shareUrl)
    await webView.waitForLoad()
    // 等待 JS 渲染和数据加载
    await sleep(3000)
    
    // 提取页面中的 _ROUTER_DATA 和 video 元素
    const extracted = await webView.evaluateJavaScript<{
      routerDataJSON: string | null
      videoSrc: string | null
      pageTitle: string
    }>(`
      (function() {
        let routerDataJSON = null
        try {
          if (typeof window._ROUTER_DATA !== 'undefined') {
            routerDataJSON = JSON.stringify(window._ROUTER_DATA)
          }
        } catch (e) {}
        
        let videoSrc = null
        try {
          var videoEl = document.querySelector('video')
          if (videoEl) {
            videoSrc = videoEl.currentSrc || videoEl.src || null
          }
        } catch (e) {}
        
        return {
          routerDataJSON,
          videoSrc,
          pageTitle: document.title || ''
        }
      })()
    `)
    
    // 解析 _ROUTER_DATA
    if (extracted?.routerDataJSON) {
      const routerData = safeJSONParse(extracted.routerDataJSON)
      const awemeDetail = extractAwemeFromRouterData(routerData)
      
      if (awemeDetail) {
        // 检测是否是图文作品
        const hasImages = awemeDetail.images && awemeDetail.images.length > 0
        const hasVideo = awemeDetail.video && (awemeDetail.video.play_addr || awemeDetail.video.play_addr_h264)
        
        // 提取图片
        const imageUrls = extractImagesFromAweme(awemeDetail)
        
        // 如果是图文作品或明确要求图片，返回图片 URL
        if ((isImage || (hasImages && !hasVideo)) && imageUrls.length > 0) {
          return { url: imageUrls[imageIndex] || imageUrls[0], imageUrls }
        }
        
        // 提取视频 URL
        const videoUrl = extractVideoUrlFromAweme(awemeDetail)
        if (videoUrl) {
          return { url: videoUrl, imageUrls }
        }
      }
    }
    
    // 回退：使用页面 video 元素的 src
    if (extracted?.videoSrc) {
      let url = extracted.videoSrc
      if (url.includes("/playwm/")) {
        url = url.replace("/playwm/", "/play/")
      }
      return { url, imageUrls: [] }
    }
    
    return { url: "", imageUrls: [] }
  } finally {
    webView.dispose()
  }
}

/**
 * 格式化字节数为人类可读格式
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + "G"
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "M"
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + "K"
  return bytes + "B"
}

/**
 * 带实时进度的分块下载函数
 * 使用 Range header 分块下载，每下载一块更新进度
 * 如果服务器不支持 Range，回退到普通下载
 */
async function downloadWithProgress(
  url: string,
  headers: Record<string, string>,
  onProgress: (downloaded: number, total: number) => void,
  prefetched?: { total: number; head: Data | null }
): Promise<Data> {
  const CHUNK_SIZE = 1024 * 1024 * 4 // 4MB 每块（块数少→更快、更不容易撞到单点抖动）
  
  const downloadDirect = async (): Promise<Data> => {
    onProgress(0, 0)
    const resp = await fetch(url, { headers })
    if (!resp.ok) throw new Error(`下载 HTTP ${resp.status}`)
    const arrayBuf = await resp.arrayBuffer()
    const data = Data.fromArrayBuffer(arrayBuf)
    if (!data) throw new Error("下载数据转换失败")
    onProgress(data.size, data.size)
    return data
  }

  // 1. 文件大小：优先复用「探测时已经拿到的总大小」—— 这样连 HEAD 都不用发（省一次往返）
  let totalSize = prefetched && prefetched.total > 0 ? prefetched.total : 0
  if (!totalSize) try {
    const headResp = await fetch(url, { method: "HEAD", headers })
    if (headResp.ok) {
      const contentLengthStr = headResp.headers?.get?.("Content-Length") || headResp.headers?.get?.("content-length")
      totalSize = contentLengthStr ? parseInt(contentLengthStr) : 0
    }
  } catch {}
  
  // 如果无法获取文件大小，回退普通下载
  if (!totalSize) {
    return await downloadDirect()
  }
  
  // 2. 分块下载：每块失败重试 3 次（150MB 有几十块，单次抖动不该让整次导出失败）
  //    块直接 append 进同一个 Data，不再「攒数组 → 再合并」—— 避免大文件双倍内存
  let merged: Data | null = null
  let downloaded = 0
  if (prefetched && prefetched.head && prefetched.head.size > 0) {
    // 探测取的那 128KB 就是文件开头 → 直接当第一块用（再省一次往返）
    merged = prefetched.head
    downloaded = Math.min(prefetched.head.size, totalSize)
    onProgress(downloaded, totalSize)
  }

  while (downloaded < totalSize) {
    const end = Math.min(downloaded + CHUNK_SIZE - 1, totalSize - 1)
    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const chunkResp = await fetch(url, { headers: { ...headers, Range: `bytes=${downloaded}-${end}` } })
        if (chunkResp.status !== 206) {
          // 重试仍拿不到 206（服务器不支持 Range）→ 回退整包下载
          if (attempt === 3) return await downloadDirect()
          await sleep(400 * attempt)
          continue
        }
        const chunkArrayBuf = await chunkResp.arrayBuffer()
        const chunkData = Data.fromArrayBuffer(chunkArrayBuf)
        if (!chunkData || chunkData.size === 0) {
          if (attempt === 3) throw new Error("分块下载返回空数据")
          await sleep(400 * attempt)
          continue
        }
        if (!merged) merged = chunkData
        else merged.append(chunkData)
        downloaded += chunkData.size
        ok = true
      } catch (e) {
        if (attempt === 3) throw e
        await sleep(400 * attempt)
      }
    }

    // 更新进度
    onProgress(downloaded, totalSize)

    // 防止 UI 更新过快，小延时
    if (totalSize > 4 * 1024 * 1024) {
      await sleep(10)
    }
  }

  if (!merged) throw new Error("下载数据为空")
  return merged
}

/**
 * 展示保存/分享选择界面
 */
async function shareVideo(video: VideoInfo, isImage: boolean, animIdx?: number) {
  const shareUrl = getShareUrl(video)
  // 如果传入了图片索引，使用该索引的图片信息
  const imgInfo = animIdx !== undefined ? video.images[animIdx] : video.images[0]
  await Navigation.present(
    <ShareProgressView
      video={video}
      shareUrl={shareUrl}
      isImage={isImage}
      originalUrl={isImage ? (imgInfo?.url || "") : video.play_url}
      imageVideoUrl={isImage ? (imgInfo?.videoUrl || "") : ""}
      imageIndex={animIdx ?? 0}
    />
  )
}

const EXPORT_STEPS = ["解析", "下载", "保存"]

function ExportStepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <HStack frame={{ maxWidth: "infinity" }} spacing={8} padding={{ horizontal: 4 }}>
      {EXPORT_STEPS.map((label, idx) => {
        const order = idx + 1
        const done = currentStep > order
        const active = currentStep === order
        return (
          <HStack key={label} spacing={6} frame={{ maxWidth: "infinity" }}>
            <VStack frame={{ width: 22, height: 22 }} alignment="center" background={done ? "systemGreen" : (active ? "systemBlue" : "systemGray5")} clipShape={{ type: "rect", cornerRadius: 11 }}>
              <Text font="caption2" foregroundStyle={done || active ? "white" : "secondaryLabel"}>{done ? "✓" : String(order)}</Text>
            </VStack>
            <Text font="caption" foregroundStyle={active ? "label" : "secondaryLabel"}>{label}</Text>
          </HStack>
        )
      })}
    </HStack>
  )
}

// ─── 分享进度视图 ───
function ShareProgressView({ video, shareUrl, isImage, originalUrl, imageVideoUrl, imageIndex }: {
  video: VideoInfo
  shareUrl: string
  isImage: boolean
  originalUrl: string
  imageVideoUrl: string
  imageIndex: number
}) {
  const dismiss = Navigation.useDismiss()
  const [step, setStep] = useState(0)         // 0=准备, 1=去水印, 2=下载, 3=保存, 4=完成, -1=失败
  const [progressText, setProgressText] = useState("准备导出...")
  const [statusTitle, setStatusTitle] = useState("准备导出")
  const [errorMsg, setErrorMsg] = useState("")
  const [detailLines, setDetailLines] = useState<string[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [progressRatio, setProgressRatio] = useState(0)
  const addDetail = (line: string) => setDetailLines(prev => [...prev.slice(-7), line])

  useEffect(() => {
    ;(async () => {
      try {
        // 步骤1：通过 WebView 解析抖音页面获取无水印资源
        setStep(1)
        setProgressRatio(0.08)
        setStatusTitle("正在解析资源")
        setProgressText("正在获取无水印地址")
        addDetail(`分享页: ${shareUrl}`)
        
        // 使用 WebView 解析抖音页面内嵌数据（不依赖第三方 API）
        const result = await extractNoWatermarkUrl(video, isImage, imageIndex)
        
        addDetail(`页面解析完成，资源地址长度 ${result.url.length}`)
        for (const n of lastPickNotes) addDetail(n)
        
        let targetUrl = result.url || ""

        // 因为「低于画质下限」被拒绝时，绝不回退到更低清的地址
        if (!targetUrl && lastPickBlockedReason) {
          throw new Error(`${lastPickBlockedReason}；已按画质下限取消下载（要强下请把 MIN_VIDEO_SHORT_SIDE 设为 0）`)
        }
        // 如果解析失败，回退到原始地址
        if (!targetUrl) {
          addDetail("未解析到无水印地址，使用原始地址")
          targetUrl = originalUrl
        } else {
          addDetail(`已获取无水印地址${result.imageUrls.length > 0 ? "，图文共 " + result.imageUrls.length + " 张" : ""}`)
        }
        
        if (!targetUrl) {
          throw new Error(lastDetailFilterReason
            ? `无法获取下载地址：该作品已被平台限制（${lastDetailFilterReason}），非本客户端问题`
            : "无法获取下载地址（原始地址也为空）")
        }
        // 锁定 targetUrl 为不可变常量，方便后续窄化
        const finalTargetUrl = targetUrl
        addDetail(`下载地址已确认，长度 ${finalTargetUrl.length}`)
        
        // 动图处理：如果图片有伴随的视频 URL，下载视频后转换为 Live Photo
        const isAnimatedImage = isImage && imageVideoUrl.length > 0
        const downloadUrl = isAnimatedImage ? imageVideoUrl : finalTargetUrl
        if (isAnimatedImage) {
          addDetail("检测到动态图视频源，将保存为 Live Photo")
        }
        
        // 步骤2：下载文件（带百分比进度）
        setStep(2)
        setProgressRatio(0.18)
        setStatusTitle("正在下载")
        setProgressText("正在下载媒体文件")
        
        // 检测是否是 GIF 动图
        const isGif = !isAnimatedImage && isGifUrl(downloadUrl)
        const ext = isAnimatedImage ? "mp4" : (isImage ? (isGif ? "gif" : "jpg") : "mp4")
        const fileName = `${video.aweme_id}${isAnimatedImage ? "_video" : (isGif ? "_" + (originalUrl || "").split("/").pop()?.split("?")[0].replace(/[^a-zA-Z0-9]/g, "").substring(0, 10) : "")}.${ext}`
        
        addDetail(`文件名: ${fileName}${isGif ? "，GIF" : ""}`)
        
        // 使用分块下载获取实时进度（4MB/块，失败自动重试）
        const data = await downloadWithProgress(
          downloadUrl,
          { "User-Agent": MOBILE_UA, "Referer": "https://www.douyin.com/" },
          (downloaded, total) => {
            if (total > 0) {
              // 有总大小时显示 "36.5/50.0 M" 格式
              const ratio = downloaded / total
              setProgressRatio(0.18 + ratio * 0.62)
              setProgressText(`${formatBytes(downloaded)} / ${formatBytes(total)} (${(ratio * 100).toFixed(0)}%)`)
            } else {
              // 无总大小时显示已下载量
              setProgressText(`已下载 ${formatBytes(downloaded)}`)
            }
          },
          // 复用探测结果：白拿总大小 + 首块（省两次往返）
          lastProbe.url === downloadUrl ? { total: lastProbe.total, head: lastProbe.head } : undefined
        )
        
        if (!data) {
          throw new Error("下载数据为空")
        }
        
        setProgressRatio(0.82)
        addDetail(`下载完成，共 ${formatBytes(data.size)}`)
        
        // 如果下载后发现是 GIF（magic bytes 检测），修正扩展名
        const actuallyGif = isGif || isGifData(data)
        const finalExt = isAnimatedImage ? "mp4" : (isImage ? (actuallyGif ? "gif" : "jpg") : "mp4")
        // 重新生成正确的文件名
        const baseFileName = `${video.aweme_id}${isAnimatedImage ? "_video" : (actuallyGif ? "_gif" : "")}`
        const finalFileName = `${baseFileName}.${finalExt}`
        
        if (actuallyGif && ext !== finalExt) {
          addDetail("下载后检测到 GIF，已修正文件格式")
        }
        
        // 步骤3：写入 Documents + 保存到相册
        setStep(3)
        setProgressRatio(0.88)
        setStatusTitle("正在保存")
        setProgressText("正在写入相册")
        
        const docPath = FileManager.documentsDirectory + finalFileName
        await writeDataFile(docPath, data)
        addDetail(`已写入临时文件，${data.size} 字节`)
        
        // 保存到相册：
        // 1. 动图（带视频URL的）→ 转换并保存为 Live Photo，失败时回退 MP4
        // 2. GIF 动图 → Data 模式保存保留动画
        // 3. 普通图片 → 路径模式保存
        // 4. 视频 → 路径模式保存
        let savedOk = false
        if (isAnimatedImage) {
          try {
            setProgressText("正在生成 Live Photo")
            addDetail("正在生成 Live Photo 资源")
            const pair = await createLivePhotoPairFromVideoPath(docPath, `${video.aweme_id}_livephoto_${Date.now()}`)
            await Photos.saveLivePhoto({ imagePath: pair.imagePath, videoPath: pair.videoPath, shouldMoveFile: true })
            savedOk = true
            addDetail(`Live Photo 已保存，${pair.duration.toFixed(1)}s${pair.reencoded ? "，已重编码" : ""}`)
            try { await FileManager.remove(docPath) } catch {}
          } catch (liveErr: any) {
            addDetail(`Live Photo 保存失败，回退 MP4: ${liveErr?.message || String(liveErr)}`)
            savedOk = await Photos.saveVideo(docPath, { fileName: finalFileName, shouldMoveFile: true })
            addDetail(`动态图已回退保存为 MP4${savedOk ? "" : "，失败"}`)
          }
        } else if (actuallyGif) {
          // GIF 动图：用 Data 直接保存，保留动画
          savedOk = await Photos.savePhoto(data, { fileName: finalFileName })
          if (savedOk) {
            try { await FileManager.remove(docPath) } catch {}
          }
          addDetail(`GIF 动图已保存${savedOk ? "" : "，失败"}`)
        } else if (isImage) {
          savedOk = await Photos.savePhoto(docPath, { fileName: finalFileName, shouldMoveFile: true })
          addDetail(`图片已保存${savedOk ? "" : "，失败"}`)
        } else {
          savedOk = await Photos.saveVideo(docPath, { fileName: finalFileName, shouldMoveFile: true })
          addDetail(`视频已保存${savedOk ? "" : "，失败"}`)
        }
        addDetail(`保存${savedOk ? "成功" : "失败"}`)
        
        let sharedOk = false
        if (!savedOk) {
          addDetail("Photos 保存失败，打开系统分享")
          sharedOk = await ShareSheet.present([docPath])
          if (!sharedOk) throw new Error("相册保存失败，且未完成系统分享")
        }
        
        setStep(4)
        setProgressRatio(1)
        setStatusTitle(savedOk ? "已保存到相册" : "已通过系统分享")
        setProgressText(isAnimatedImage && savedOk ? "动态照片已保存" : (savedOk ? "导出完成" : "分享已完成"))
        
      } catch (e: any) {
        setStep(-1)
        const msg = (e?.message || String(e) || JSON.stringify(e) || "未知错误").substring(0, 200)
        setProgressRatio(0)
        setStatusTitle("导出失败")
        setErrorMsg(msg)
        addDetail(`失败: ${msg}`)
      }
    })()
  }, [])

  const isBusy = step > 0 && step < 4
  const iconName = step === 4 ? "checkmark.circle.fill" : (step === -1 ? "xmark.circle.fill" : "arrow.down.circle")
  const iconColor = step === 4 ? "systemGreen" : (step === -1 ? "systemRed" : "systemBlue")
  const progressWidth = Math.max(8, Math.min(260, 260 * progressRatio))

  return (
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground" padding={24} spacing={18} alignment="center">
      <Spacer />
      <VStack frame={{ width: 72, height: 72 }} alignment="center" background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 36 }}>
        {isBusy ? <ProgressView foregroundStyle="systemBlue" /> : <Image systemName={iconName} font="largeTitle" foregroundStyle={iconColor} />}
      </VStack>
      <Text font="title3" bold>{statusTitle}</Text>
      <Text font="subheadline" foregroundStyle={step === -1 ? "systemRed" : "secondaryLabel"} multilineTextAlignment="center" lineLimit={3}>
        {step === -1 ? errorMsg : progressText}
      </Text>
      {step > 0 && step !== -1 ? <ExportStepIndicator currentStep={step} /> : null}
      {isBusy ? (
        <VStack frame={{ width: 260, height: 6, alignment: "leading" }} background="systemGray5" clipShape={{ type: "rect", cornerRadius: 3 }}>
          <VStack frame={{ width: progressWidth, height: 6 }} background="systemBlue" clipShape={{ type: "rect", cornerRadius: 3 }} />
        </VStack>
      ) : null}
      {detailLines.length > 0 ? (
        <VStack frame={{ maxWidth: "infinity" }} spacing={8} padding={{ top: 6 }}>
          <Button action={() => setShowDetails(!showDetails)}>
            <HStack spacing={6}>
              <Image systemName={showDetails ? "chevron.up" : "chevron.down"} font="caption" foregroundStyle="secondaryLabel" />
              <Text font="caption" foregroundStyle="secondaryLabel">诊断信息</Text>
            </HStack>
          </Button>
          {showDetails ? (
            <ScrollView frame={{ maxWidth: "infinity", maxHeight: 140 }}>
              <VStack spacing={4} frame={{ maxWidth: "infinity" }} alignment="leading">
                {detailLines.map((s, i) => <Text key={i} font="caption2" foregroundStyle="tertiaryLabel" lineLimit={3}>{s}</Text>)}
              </VStack>
            </ScrollView>
          ) : null}
        </VStack>
      ) : null}
      <Spacer />
      {step >= 4 || step === -1 ? <Button title="关闭" action={() => dismiss()} /> : null}
    </VStack>
  )}

// ─── 动图/图片单页组件 ──—
/**
 * 播放页「下载」按钮的位置偏移。
 * 位置：右下角、AVKit 进度条的上方（底部那一行被 AVKit 自己的全屏 / PiP 占着）。
 * 实机若看着不理想，只调这两个数字即可。
 */
const PLAYER_DOWNLOAD_TRAILING_INSET = 18
const PLAYER_DOWNLOAD_BOTTOM_INSET = 56

function FloatingIconButton({ systemName, onTap }: { systemName: string; onTap: () => void }) {
  // 图片页专用：压在照片上需要底板，所以用系统毛玻璃 + 语义色 label（跟随系统深浅色）
  return (
    <Button action={onTap}>
      <VStack frame={{ width: 44, height: 44 }} alignment="center" background="ultraThinMaterial" clipShape={{ type: "rect", cornerRadius: 22 }}>
        <Image systemName={systemName} font="title3" foregroundStyle="label" />
      </VStack>
    </Button>
  )
}

/**
 * 播放器上的按钮：与 AVKit 自带按钮同款 —— **裸白色字形**，不加底板。
 * （之前用毛玻璃圆底，与 AVKit 的裸字形按钮放一起就“格格不入”—— 用户 2026-10-12 指出）
 * padding 是留给触控的（字形 ≈20pt + 10pt 内边距 ≈ iOS 的 44pt 触控区）。
 */
function PlayerGlyphButton({ systemName, onTap }: { systemName: string; onTap: () => void }) {
  return (
    <Button action={onTap}>
      <Image systemName={systemName} font="title3" foregroundStyle="white" padding={10} />
    </Button>
  )
}

function ImagePageOverlay({ badgeText, pageWidth, pageHeight, onExport, loading }: {
  badgeText: string
  pageWidth: number
  pageHeight: number
  onExport: () => void
  loading: boolean
}) {
  return (
    <VStack frame={{ width: pageWidth, height: pageHeight }} alignment="center" padding={{ horizontal: 16, bottom: 14 }}>
      {loading ? (
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center">
          <ProgressView foregroundStyle="white" />
        </VStack>
      ) : <Spacer />}
      <HStack frame={{ maxWidth: "infinity" }} spacing={12}>
        <HStack padding={{ horizontal: 10, vertical: 5 }} background="ultraThinMaterial" clipShape={{ type: "rect", cornerRadius: 8 }}>
          <Text font="caption2" foregroundStyle="label">{badgeText}</Text>
        </HStack>
        <Spacer />
        <FloatingIconButton systemName="square.and.arrow.down" onTap={onExport} />
      </HStack>
    </VStack>
  )
}

function AnimatedImagePage({ imgInfo, pageWidth, pageHeight, index, total, onExport }: {
  imgInfo: ImageInfo
  pageWidth: number
  pageHeight: number
  index: number
  total: number
  onExport: () => void
}) {
  const [player, setPlayer] = useState<AVPlayer | null>(null)
  const [videoError, setVideoError] = useState(false)
  const isAnimatedVideo = !!imgInfo.videoUrl

  useEffect(() => {
    if (!imgInfo.videoUrl) return
    const p = new AVPlayer()
    p.volume = 0
    p.numberOfLoops = -1
    p.onReadyToPlay = () => {
      setPlayer(p)
      p.play()
    }
    p.onError = () => setVideoError(true)
    const sourceSet = p.setSource(imgInfo.videoUrl, {
      headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/" }
    })
    if (!sourceSet) setVideoError(true)
    SharedAudioSession.setCategory('playback', [])
    SharedAudioSession.setActive(true)
    return () => {
      try { p.stop(); p.dispose() } catch {}
    }
  }, [])

  const badgeText = isAnimatedVideo ? "动图" : `${index + 1}/${total}`
  const overlay = <ImagePageOverlay badgeText={badgeText} pageWidth={pageWidth} pageHeight={pageHeight} onExport={onExport} loading={isAnimatedVideo && !player && !videoError} />

  if (isAnimatedVideo && player && !videoError) {
    return (
      <VStack frame={{ width: pageWidth, height: pageHeight }} background="black" alignment="center" clipped>
        <VideoPlayer player={player} frame={{ width: pageWidth, height: pageHeight }} overlay={overlay} />
      </VStack>
    )
  }

  return (
    <VStack frame={{ width: pageWidth, height: pageHeight }} background="black" alignment="center" clipped>
      <Image
        imageUrl={imgInfo.url}
        resizable
        aspectRatio={{ value: null, contentMode: 'fit' }}
        frame={{ width: pageWidth, height: pageHeight }}
        clipped
        opacity={isAnimatedVideo && !videoError ? 0.45 : 1}
        overlay={{ alignment: "center", content: overlay }}
      />
    </VStack>
  )
}

// ─── 视频播放 ───
function VideoPreviewView({ video }: { video: VideoInfo }) {
  // 不放关闭按钮：播放页是 sheet，下滑即可关闭（用户 2026-10-12 定）
  const [player, setPlayer] = useState<AVPlayer | null>(null)
  const [error, setError] = useState("")
  const isImagePost = video.images.length > 0

  useEffect(() => {
    if (isImagePost) return
    if (!video.play_url) { setError("无可播放地址"); return }
    const p = new AVPlayer()
    p.onReadyToPlay = () => {
      setPlayer(p)
      p.play()
    }
    p.onError = () => { setError("播放失败") }
    const sourceSet = p.setSource(video.play_url, {
      headers: { "User-Agent": MOBILE_UA, Referer: "https://www.douyin.com/" }
    })
    if (!sourceSet) setError("播放地址加载失败")
    SharedAudioSession.setCategory('playback', [])
    SharedAudioSession.setActive(true)
    // 收起（最小化）先暂停：原生播放器不挂 React 树，不处理的话后台会一直出声
    let unregister: (() => void) | undefined
    try {
      const reg = (Script as any).onMinimize
      if (typeof reg === "function") unregister = reg(() => { try { p.pause() } catch {} })
    } catch {}
    return () => {
      try { p.pause(); p.stop(); p.dispose() } catch {}
      try { if (unregister) unregister() } catch {}
    }
  }, [])

  return (
    <GeometryReader>{({ size: { width, height } }) => (
      <VStack frame={{ width, height }} background="black">
        {/**
         * 控件层只留一个「下载」：
         *   · 位置：右下角、AVKit 进度条上方（底部那一行被 AVKit 的全屏/PiP 占着）
         *   · 样式：裸白色字形，与 AVKit 自带按钮一致
         *   · 浮层只占一个小角，屏幕主体完全归 AVKit，原生控件能正常吃到触摸
         */}
        <VStack
          frame={{ width, height }}
          background="black"
          overlay={{
            alignment: "bottomTrailing",
            content: (
              <VStack padding={{ trailing: PLAYER_DOWNLOAD_TRAILING_INSET, bottom: PLAYER_DOWNLOAD_BOTTOM_INSET }}>
                {/* 图文作品的下载在每页底部（带页码，导出才不错图），这里只给视频作品 */}
                {!isImagePost && player ? (
                  <PlayerGlyphButton systemName="arrow.down.circle" onTap={() => shareVideo(video, false)} />
                ) : null}
              </VStack>
            ),
          }}
        >
          {isImagePost ? (
            <ScrollView axes="horizontal" scrollTargetBehavior="paging" frame={{ width, height }}>
              <HStack spacing={0} frame={{ height }}>
                {video.images.map((imgInfo, i) => (
                  <AnimatedImagePage
                    key={i}
                    imgInfo={imgInfo}
                    pageWidth={width}
                    pageHeight={height}
                    index={i}
                    total={video.images.length}
                    onExport={() => shareVideo(video, true, i)}
                  />
                ))}
              </HStack>
            </ScrollView>
          ) : player ? (
            <VideoPlayer player={player} frame={{ width, height }} />
          ) : error ? (
            <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center" spacing={12}>
              <Image systemName="exclamationmark.triangle.fill" font="largeTitle" foregroundStyle="white" opacity={0.6} />
              <Text foregroundStyle="white" opacity={0.6}>{error}</Text>
            </VStack>
          ) : (
            <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center">
              {video.cover ? (
                <Image imageUrl={video.cover} resizable aspectRatio={{ value: null, contentMode: 'fit' }} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} opacity={0.3} allowsHitTesting={false} />
              ) : null}
              <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="center" allowsHitTesting={false}>
                <ProgressView foregroundStyle="white" />
              </VStack>
            </VStack>
          )}
        </VStack>
      </VStack>
    )}</GeometryReader>
  )
}

// ─── 打开视频（防双击） ───
let _openingVideo = false
async function openVideo(video: VideoInfo, _idx?: number) {
  if (_openingVideo) return
  _openingVideo = true
  try {
    // 分享页通道拿到的条目没有播放地址（图文也没图集 URL）→ 用移动端 detail 接口补一次
    let v = video
    if (v.aweme_id && (!v.play_url || (v.images.length > 0 && !v.images[0]?.url))) {
      try {
        const detail = await fetchAwemeDetail(v.aweme_id)
        if (detail) {
          const f = awemeToVideoInfo(detail)
          if (f.play_url || f.images.some((i) => i.url)) {
            v = {
              ...v,
              play_url: f.play_url || v.play_url,
              images: f.images.length > 0 ? f.images : v.images,
              cover: v.cover || f.cover, desc: v.desc || f.desc,
              duration: v.duration || f.duration, digg_count: v.digg_count || f.digg_count,
              author_nickname: v.author_nickname || f.author_nickname,
              author_avatar: v.author_avatar || f.author_avatar,
            }
          }
        }
      } catch { /* 补不到就照原样打开，至少封面/标题能看 */ }
    }
    addToHistory(v)
    await Navigation.present(<VideoPreviewView video={v} />)
  } finally {
    _openingVideo = false
  }
}

// ─── Storage ───
function loadSecUid(): string { return Storage.get<string>(KEY_SEC_UID) || "" }
function saveSecUid(uid: string) { Storage.set(KEY_SEC_UID, uid) }

function loadHistory(): HistoryItem[] {
  try { const raw = Storage.get<string>(KEY_HISTORY); if (!raw) return []; return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [] }
  catch { return [] }
}
function saveHistory(items: HistoryItem[]) { Storage.set(KEY_HISTORY, JSON.stringify(items.slice(0, 500))) }
function addToHistory(video: VideoInfo) {
  const history = loadHistory(); const idx = history.findIndex((h) => h.aweme_id === video.aweme_id)
  if (idx >= 0) history.splice(idx, 1)
  history.unshift({ ...video, viewed_at: Date.now() }); saveHistory(history)
}
function loadSavedUsers(): SavedUser[] {
  try { const raw = Storage.get<string>(KEY_SAVED_USERS); if (!raw) return []; return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [] }
  catch { return [] }
}
function loadCurrentSavedUser(): SavedUser | null {
  const uid = loadSecUid()
  if (!uid) return null
  return loadSavedUsers().find((u) => u.id === uid) || null
}
function saveUser(user: SavedUser) {
  const users = loadSavedUsers(); const idx = users.findIndex((u) => u.id === user.id)
  if (idx >= 0) users.splice(idx, 1); users.unshift(user)
  Storage.set(KEY_SAVED_USERS, JSON.stringify(users))
}

// ─── 抖音号解析 ───
function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0].replace(/[),.;!?，。；！？）】]+$/, "") : text.trim()
}

// ─── iesdouyin API + Cookie 直调 ───
// 有 Cookie 时带上，可能 API 需要认证才能正确返回 JSON
async function resolveViaIesdouyin(uniqueId: string): Promise<{ secUid: string; nickname: string; avatar: string; shortId: string; totalFavorited: number; followingCount: number; followerCount: number; signature: string; ipLocation: string; gender: number } | null> {
  try {
    const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
    const headers: Record<string, string> = { "User-Agent": ANDROID_UA, Referer: "https://www.iesdouyin.com/" }
    if (cookie) headers["Cookie"] = cookie
    const url = `https://www.iesdouyin.com/web/api/v2/user/info/?unique_id=${encodeURIComponent(uniqueId)}`
    const resp = await timeoutFetch(fetch(url, { method: "GET", headers }), 5000)
    if (!resp.ok) return null
    const text = await resp.text()
    let data: any
    try { data = JSON.parse(text) } catch { return null }
    const info = data?.user_info
    if (!info || !info.sec_uid) return null
    return {
      secUid: info.sec_uid,
      nickname: info.nickname || "",
      avatar: pickFirstUrl(info.avatar_thumb?.url_list) || pickFirstUrl(info.avatar_larger?.url_list) || "",
      shortId: info.unique_id || "",
      totalFavorited: parseInt(info.total_favorited) || 0,
      followingCount: info.following_count || 0,
      followerCount: info.follower_count || 0,
      signature: info.signature || info.desc || "",
      ipLocation: info.ip_location || info.ip_loc || info.region || "",
      gender: info.gender ?? 0,
    }
  } catch {
    return null
  }
}

async function resolveViaWebView(url: string): Promise<string> {
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(MOBILE_UA)
    // 包超时：分享链重定向到验证码页/死链时 waitForLoad 会一直挂着
    await timeoutFetch(webView.loadURL(url), 12000)
    await timeoutFetch(webView.waitForLoad(), 12000)
    // 等待页面重定向和 JS 渲染完成
    let prevUrl = url
    for (let i = 0; i < 6; i++) {
      await sleep(1500)
      const currentUrl = await webView.evaluateJavaScript<string>("location.href")
      if (currentUrl && currentUrl !== prevUrl) {
        prevUrl = currentUrl
        // URL 变了（重定向了），额外等一会儿让新页面渲染
        await sleep(2000)
        break
      }
    }
    const extracted = await webView.evaluateJavaScript<string>(`
      (function(){
        var h=location.href;
        // 1. 优先从 URL 提取：/user/xxx 或 /share/user/xxx
        var m=h.match(/\/user\/([A-Za-z0-9_\-\.@]+)/);
        if(m&&m[1].length>15)return m[1];
        m=h.match(/sec_user_id=([^&#]+)/);
        if(m)return decodeURIComponent(m[1]);
        // 2. 从 _ROUTER_DATA 提取
        try{var v=Object.values(window._ROUTER_DATA?.loaderData||{});for(var i=0;i<v.length;i++){if(v[i]?.userPage?.sec_uid)return v[i].userPage.sec_uid;if(v[i]?.sec_uid)return v[i].sec_uid}}catch(e){}
        // 3. 从 __INITIAL_STATE__ 提取
        try{var s=window.__INITIAL_STATE__;if(s?.user?.sec_uid)return s.user.sec_uid}catch(e){}
        // 4. 从 __NEXT_DATA__ 提取
        try{var nd=JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent||'{}');if(nd?.props?.pageProps?.user?.sec_uid)return nd.props.pageProps.user.sec_uid;if(nd?.props?.pageProps?.sec_uid)return nd.props.pageProps.sec_uid}catch(e){}
        // 5. 从所有 script 标签搜索 sec_uid
        try{var sc=document.scripts;for(var j=0;j<sc.length;j++){m=(sc[j].textContent||'').match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]+)"/);if(m&&m[1].length>15)return m[1]}}catch(e){}
        // 6. 从 SSR state 提取
        try{var ssr=window.__SSR_RENDER_DATA__||window.__STORE__||window.__PREFETCH_DATA__;if(ssr&&typeof ssr==='object'){var json=JSON.stringify(ssr);m=json.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]+)"/);if(m&&m[1].length>15)return m[1]}}catch(e){}
        return''})()
    `)
    return typeof extracted === "string" ? extracted : ""
  } finally { webView.dispose() }
}

async function resolveSecUid(input: string): Promise<{ secUid: string; nickname?: string; avatar?: string; shortId?: string; totalFavorited?: number; followingCount?: number; followerCount?: number; signature?: string; ipLocation?: string; gender?: number; error?: string }> {
  let val = extractUrl(input)
  if (!val) return { secUid: "", error: "输入为空" }
  if (/v\.douyin\.com/.test(val)) {
    try {
      const uid = await resolveViaWebView(val)
      if (uid) return { secUid: uid }
      return { secUid: "", error: "无法解析该短链接" }
    }
    catch (e) { return { secUid: "", error: `解析失败: ${(e as Error).message}` } }
  }
  const mShare = val.match(/douyin\.com\/share\/user\/([A-Za-z0-9_\-\.]+)/)
  if (mShare) {
    const shareName = mShare[1]
    // 先用 Cookie 解析，不行再用 WebView
    try {
      const info = await resolveViaIesdouyin(shareName)
      if (info) return { secUid: info.secUid, nickname: info.nickname, avatar: info.avatar, shortId: shareName, totalFavorited: info.totalFavorited, followingCount: info.followingCount, followerCount: info.followerCount, signature: info.signature, ipLocation: info.ipLocation, gender: info.gender }
    } catch {}
    try {
      const uid = await resolveViaSharePage(shareName)
      if (uid) return { secUid: uid }
    } catch {}
    try {
      const uid = await resolveViaWebView(val)
      if (uid) return { secUid: uid }
    } catch {}
    return { secUid: "", error: "无法解析该分享链接" }
  }
  const m1 = val.match(/sec_user_id=([^&#]+)/)
  if (m1) return { secUid: decodeURIComponent(m1[1]) }
  const m2 = val.match(/douyin\.com\/user\/([A-Za-z0-9_\-\.]+)/)
  if (m2) return { secUid: m2[1] }
  if (val.length > 20 && /^[A-Za-z0-9_\-\.]{20,}$/.test(val)) return { secUid: val }
  if (/^[A-Za-z0-9_.]{3,30}$/.test(val) && !/^https?:\/\//.test(val)) {
    try {
      // 1. 原始 iesdouyin API + Cookie（最快，返回完整资料）
      const info = await resolveViaIesdouyin(val)
      if (info) return { secUid: info.secUid, nickname: info.nickname, avatar: info.avatar, shortId: val, totalFavorited: info.totalFavorited, followingCount: info.followingCount, followerCount: info.followerCount, signature: info.signature, ipLocation: info.ipLocation, gender: info.gender }
      // 2. SSR 分享页面 + Cookie
      const uid2 = await resolveViaSharePage(val)
      if (uid2) return { secUid: uid2, shortId: val }
      // 3. 最终兜底：WebView
      const uid3 = await resolveViaWebView(`https://www.douyin.com/share/user/${encodeURIComponent(val)}`)
      if (uid3) return { secUid: uid3, shortId: val }
      return { secUid: "", error: "无法解析该抖音号" }
    }
    catch (e) { return { secUid: "", error: `解析失败: ${(e as Error).message}` } }
  }
  if (/^https?:\/\//.test(val)) {
    try { const uid = await resolveViaWebView(val); if (uid) return { secUid: uid }; return { secUid: "", error: "无法从该链接解析" } }
    catch (e) { return { secUid: "", error: `解析失败: ${(e as Error).message}` } }
  }
  return { secUid: val }
}

// ─── 通过 Cookie 请求 SSR 分享页面解析抖音号 ───
// 原理：douyin.com/share/user/{抖音号} 是服务端渲染页面，HTML 中包含用户数据的 JSON
// 比 WebView 快（单次 HTTP 请求），比搜索 API 可靠
async function resolveViaSharePage(keyword: string): Promise<string> {
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (!cookie) return ""
  try {
    const url = `https://www.douyin.com/share/user/${encodeURIComponent(keyword)}`
    const resp = await timeoutFetch(fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": MOBILE_UA,
        "Cookie": cookie,
        "Referer": "https://www.douyin.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      }
    }), 5000)
    if (!resp.ok) return ""
    const html = await resp.text()

    // 1. 尝试从 __INITIAL_STATE__ 提取
    const m1 = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.*?});?\s*<\/script>/)
    if (m1) {
      try {
        const state = JSON.parse(m1[1])
        // 不同页面结构：{ user: { sec_uid } } 或 { userPage: { sec_uid } }
        if (state?.user?.sec_uid) return state.user.sec_uid
        if (state?.userPage?.sec_uid) return state.userPage.sec_uid
      } catch {}
    }

    // 2. 直接用正则搜索所有 script 中的 "sec_uid":"xxxx"
    const m2 = html.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]{10,})"/)
    if (m2) return m2[1]

    // 3. 从任意 script 内容里提取
    const scriptRe = /<script[^>]*>([^<]{0,50000}?"sec_uid"[^<]*?)<\/script>/g
    let sm
    while ((sm = scriptRe.exec(html)) !== null) {
      const m = sm[1].match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-\.@]{10,})"/)
      if (m) return m[1]
    }
  } catch {}
  return ""
}

// ─── API ───
function awemeToVideoInfo(item: any): VideoInfo {
  return {
    aweme_id: item.aweme_id || "", desc: item.desc || "", create_time: item.create_time || 0,
    cover: pickBestUrl(item.video?.origin_cover?.url_list) || pickBestUrl(item.video?.cover?.url_list),
    play_url: bestPlayUrl(item.video),
    duration: item.video?.duration || 0, digg_count: item.statistics?.digg_count || 0,
    comment_count: item.statistics?.comment_count || 0,
    author_nickname: item.author?.nickname || "",
    author_avatar: pickBestUrl(item.author?.avatar_larger?.url_list) || pickBestUrl(item.author?.avatar_medium?.url_list) || pickBestUrl(item.author?.avatar_thumb?.url_list),
    unique_id: item.author?.unique_id || "",
    author_ip_location: item.author?.ip_location || item.author?.ip_loc || item.author?.region || "",
    is_top: Number(item.is_top) || 0,
    images: (item.images || []).map((img: any) => ({
      url: pickBestUrl(img.url_list),
      videoUrl: pickBestUrl(img.video?.play_addr?.url_list) || undefined,
    })).filter((img: ImageInfo) => img.url),
  }
}

/**
 * 列表顺序**以服务端为准**。
 * 为什么不能自己按时间重排：作者的置顶作品往往是老作品，抖音把置顶放在列表最前，
 * 而接口**不返回 is_top**（实测 8 条全是 0）—— 客户端一重排就把置顶的两条打到列表最底，
 * 看起来就像“置顶的作品没了”。
 *
 * 唯一兵底：整页**严格递增**（服务端反向，历史上 max_cursor=0 会出现）才整体反转。
 */
function fixOrder(list: VideoInfo[]): VideoInfo[] {
  if (list.length < 2) return list
  // 只有「每一项都比前一项新」才算客户端需要反转；降序（正常）或含置顶的混合顺序一律原样保留
  let strictlyAscending = true
  for (let i = 1; i < list.length; i++) {
    if (!((list[i].create_time || 0) > (list[i - 1].create_time || 0))) { strictlyAscending = false; break }
  }
  return strictlyAscending ? list.slice().reverse() : list
}

function parseAwemeResponse(rawJson: string): { videos: VideoInfo[]; maxCursor: number; hasMore: boolean } {
  let data: any
  try { data = JSON.parse(rawJson) } catch { throw new Error("JSON 解析失败") }
  if (data.status_code !== 0) throw new Error(`API 错误: ${data.status_msg || data.status_code}`)
  let awemeList: any[] = Array.isArray(data.aweme_list) ? data.aweme_list : []
  if (awemeList.length === 0) {
    function findAwemeList(obj: any): any[] | null {
      if (!obj || typeof obj !== 'object') return null
      if (Array.isArray(obj.aweme_list)) return obj.aweme_list
      for (const k of Object.keys(obj)) { const v = obj[k]; if (v && typeof v === 'object') { if (Array.isArray(v.aweme_list)) return v.aweme_list; const r = findAwemeList(v); if (r) return r } }
      return null
    }
    const found = findAwemeList(data)
    if (found) awemeList = found
  }
  const videos: VideoInfo[] = awemeList
    .filter((item: any) => {
      // aweme_type 101 = 直播间卡片（无 video / 无图，详情必被服务端 core_dep 过滤）
      // 点了既放不了也下不了，直接从列表剔除，避免用户点到必然失败的作品
      if (Number(item.aweme_type) === 101) return false
      const v = item.video || {}
      const hasVideo = !!(v.play_addr?.url_list?.length || v.play_addr_h264?.url_list?.length)
      const hasImages = !!(item.images && item.images.length > 0)
      return hasVideo || hasImages
    })
    .map(awemeToVideoInfo)
  return { videos: fixOrder(videos), maxCursor: data.max_cursor || 0, hasMore: data.has_more === 1 }
}

async function fetchViaWebView(secUid: string, cursor: number = 0): Promise<string> {
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=web&aid=6383&sec_user_id=${encodeURIComponent(secUid)}&count=${POST_PAGE_SIZE}&max_cursor=${cursor}&cookie_enabled=true&platform=web&downlink=10`
  const webView = new WebViewController({ ephemeral: false })
  try {
    webView.setCustomUserAgent(MOBILE_UA)
    await webView.loadURL("https://www.douyin.com/")
    await webView.waitForLoad()
    let sig = ""
    for (let i = 0; i < 15; i++) {
      await sleep(2000)
      try {
        sig = await webView.evaluateJavaScript<string>("(document.cookie.match(/__ac_signature=([^;]+)/)||[])[1]||''")
        if (sig && sig.length > 5) break
      } catch {}
    }
    if (!sig || sig.length <= 5) {
      try {
        await webView.loadURL(`https://www.douyin.com/user/${encodeURIComponent(secUid)}`)
        await webView.waitForLoad()
        await sleep(3000)
        for (let i = 0; i < 10; i++) {
          await sleep(2000)
          try {
            sig = await webView.evaluateJavaScript<string>("(document.cookie.match(/__ac_signature=([^;]+)/)||[])[1]||''")
            if (sig && sig.length > 5) break
          } catch {}
        }
      } catch {}
    }
    if (!sig || sig.length <= 5) {
      throw new Error("WebView 未获取到 __ac_signature。请在设置页填写 douyin.com Cookie 即可跳过此步骤。")
    }
    await webView.evaluateJavaScript(`
      (function(){window.__API_DONE=0;window.__API_DATA='';try{
        var x=new XMLHttpRequest();
        x.open('GET','${apiUrl.replace(/'/g, "\\'")}',true);
        x.setRequestHeader('Accept','application/json, text/plain, */*');
        x.onload=function(){window.__API_DATA=x.responseText;window.__API_DONE=2};
        x.onerror=function(){window.__API_DONE=1;window.__API_ERR='onerror'};
        x.ontimeout=function(){window.__API_DONE=1;window.__API_ERR='timeout'};
        x.timeout=20000;x.send()
      }catch(e){window.__API_DONE=1;window.__API_ERR=String(e)}})()
    `)
    for (let i = 0; i < 15; i++) {
      await sleep(1500)
      try {
        const done = await webView.evaluateJavaScript<string>("String(window.__API_DONE)")
        if (done === "2") return await webView.evaluateJavaScript<string>("window.__API_DATA") || ""
        if (done === "1") break
      } catch {}
    }
    try {
      const err = await webView.evaluateJavaScript<string>("window.__API_ERR || ''")
      throw new Error(`WebView XHR 失败: ${err || '请求超时或无响应'}`)
    } catch { throw new Error("WebView XHR 请求失败") }
  } finally { webView.dispose() }
}

async function fetchViaCookie(secUid: string, cursor: number = 0): Promise<string> {
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (!cookie || cookie.length < 50) throw new Error("未配置 Cookie 或长度不足")
  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=web&aid=6383&sec_user_id=${encodeURIComponent(secUid)}&count=${POST_PAGE_SIZE}&max_cursor=${cursor}&cookie_enabled=true&platform=web&downlink=10`
  const resp = await fetch(apiUrl, {
    headers: { "User-Agent": MOBILE_UA, "Referer": `https://www.douyin.com/user/${encodeURIComponent(secUid)}`, "Cookie": cookie, "Accept": "application/json" },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return await resp.text()
}

// ─── 网页端签名（x-secsdk-web-signature / ArgusSecurityPlugin） ───
// 抖音对 /aweme/v1/web/aweme/post/ 等接口校验签名：
//   缺 uifid → 403 Blocked by ArgusSecurityPlugin Uifid Not Found
//   有 uifid 无签名 → 403 Signature Not Found
// 算法：md5(`${uifid}_${timestamp}_${SALT}_${canonicalQuery}`)，纯本地计算。
// 三条硬性规则：uifid 只在 query 中缺失时才追加；timestamp 追加在 uifid 之后；
// 被哈希的 query 必须与线上发送的字节完全一致（故这里直接返回编码后的串）。
function pyQuote(s: string): string {
  // 等价于 Python urllib.parse.quote(s, safe="*-._")
  return encodeURIComponent(s).replace(/[!'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
}
function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}
function extractUifid(cookie: string): string {
  const m = cookie.match(/(?:^|;\s*)UIFID=([0-9a-fA-F]{16,})/)
  return m ? m[1] : ""
}
function websignQuery(rawQuery: string, uifid: string): string {
  const stamp = String(Math.floor(Date.now() / 1000))
  const pairs: Array<[string, string]> = []
  for (const part of rawQuery.split("&")) {
    if (!part) continue
    const i = part.indexOf("=")
    pairs.push([safeDecode(i >= 0 ? part.slice(0, i) : part), safeDecode(i >= 0 ? part.slice(i + 1) : "")])
  }
  if (!pairs.some((p) => p[0] === "uifid")) pairs.push(["uifid", uifid])
  pairs.push(["timestamp", stamp])
  const hashed = pairs.map((p) => pyQuote(p[0]) + "=" + pyQuote(p[1])).join("&")
  const payload = Data.fromString(`${uifid}_${stamp}_${SECSDK_SALT}_${hashed}`)
  const digest = payload ? Crypto.md5(payload) : null
  const sig = (digest ? digest.toHexString() : "").toLowerCase()
  return `${hashed}&x-secsdk-web-signature=${sig}`
}

// uifid 缓存：它是服务端签发的访客身份串（320 位 hex），需一次真实网页会话才能取得，
// 且有效期较长 —— 取到就持久化，避免每次翻页/解析都开 WebView
// （不可见 WebView 还会被风控打到验证码页，导致取不到）。
let _uifidMemory = ""

/** 保存 uifid：内存 + Storage，并回写 Cookie 让两者自洽 */
function saveUifid(uifid: string) {
  if (!uifid) return
  _uifidMemory = uifid
  Storage.set(KEY_UIFID, uifid)
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (cookie && !extractUifid(cookie)) {
    Storage.set(KEY_COOKIE, cookie + (cookie.endsWith(";") ? "" : "; ") + "UIFID=" + uifid)
  }
}

/** 丢弃缓存的 uifid（过期或 403 时调用） */
function clearUifid() {
  _uifidMemory = ""
  Storage.remove(KEY_UIFID)
}

/**
 * 取 uifid：内存 → 独立缓存 → 已存 Cookie → WebView 补取。
 * force=true 时跳过全部缓存（用于 403 后换新）。
 */
async function ensureUifid(force: boolean = false): Promise<string> {
  if (!force) {
    if (_uifidMemory) return _uifidMemory
    const cached = String(Storage.get<string>(KEY_UIFID) || "").trim()
    if (cached) { _uifidMemory = cached; return cached }
    const fromCookie = extractUifid(Storage.get<string>(KEY_COOKIE) || "")
    if (fromCookie) { _uifidMemory = fromCookie; Storage.set(KEY_UIFID, fromCookie); return fromCookie }
  }
  const webView = new WebViewController({ ephemeral: false })
  try {
    // 包超时：风控/验证码页会让 waitForLoad 永不 resolve，卡死整条加载链
    await timeoutFetch(webView.loadURL("https://www.douyin.com/"), 10000)
    await timeoutFetch(webView.waitForLoad(), 10000)
    const cookies = await timeoutFetch(webView.getAllCookies(), 5000)
    const hit = cookies.find((c) => c.name === "UIFID")
    const value = hit ? String(hit.value) : ""
    if (value) saveUifid(value)
    return value
  } catch { return "" }
  finally { try { webView.dispose() } catch {} }
}

let websignDeadUntil = 0
function markWebsignDead() { websignDeadUntil = Date.now() + 10 * 60 * 1000 }
function websignUsable() { return Date.now() >= websignDeadUntil }

async function fetchViaWebsign(secUid: string, cursor: number = 0, allowRetry: boolean = true): Promise<string> {
  if (!websignUsable()) throw new Error("websign 通道已被标记不可用（稍后自动恢复）")
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  const uifid = await ensureUifid()
  if (!uifid) throw new Error("缺少 uifid，请在设置页重新粘贴含 UIFID 的 Cookie")
  const sv = (cookie.match(/(?:^|;\s*)s_v_web_id=([^;]*)/) || ["", ""])[1]

  const params: Record<string, string> = {
    device_platform: "webapp", aid: "6383", channel: "channel_pc_web",
    sec_user_id: secUid, max_cursor: String(cursor), count: String(POST_PAGE_SIZE),
    pc_client_type: "1", version_code: "170400", version_name: "17.4.0",
    cookie_enabled: "true", screen_width: "1536", screen_height: "864",
    browser_language: "zh-CN", browser_platform: "MacIntel", browser_name: "Safari",
    browser_version: "605.1.15", browser_online: "true", engine_name: "WebKit",
    engine_version: "605.1.15", os_name: "Mac OS", os_version: "10.15.7",
    cpu_core_num: "8", device_memory: "8", platform: "PC", downlink: "10",
  }
  const pairs: Array<[string, string]> = Object.keys(params).map((k) => [k, params[k]])
  pairs.push(["a_bogus", abogus(params)])
  if (sv) pairs.push(["verifyFp", sv], ["fp", sv])
  const stamp = String(Math.floor(Date.now() / 1000))
  pairs.push(["uifid", uifid], ["timestamp", stamp])
  const query = pairs.map(([k, v]) => `${pyQuote(k)}=${pyQuote(v)}`).join("&")
  const payload = Data.fromString(`${uifid}_${stamp}_${SECSDK_SALT}_${query}`)
  const digest = payload ? Crypto.md5(payload) : null
  const sig = (digest ? digest.toHexString() : "").toLowerCase()

  const resp = await timeoutFetch(fetch(`https://www.douyin.com/aweme/v1/web/aweme/post/?${query}&x-secsdk-web-signature=${sig}`, {
    headers: {
      "User-Agent": DESKTOP_UA,
      "Referer": `https://www.douyin.com/user/${secUid}`,
      "Accept": "application/json, text/plain, */*",
      "Cookie": cookie,
      "uifid": uifid,
      "x-secsdk-web-signature": sig,
      "x-secsdk-web-expire": stamp,
    },
  }), 7000)
  // uifid 可能过期：清缓存重新取一次再试
  if (resp.status === 403 && allowRetry) {
    clearUifid()
    const fresh = await ensureUifid(true)
    if (fresh && fresh !== uifid) return await fetchViaWebsign(secUid, cursor, false)
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const text = await timeoutFetch(resp.text(), 7000)
  // 空体 / blocked = 抖音风控拦下（不是网络问题）→ 标记一段时间内不再尝试，避免每次白等
  const t = text.trim()
  if (!t || t === "blocked" || t.length < 20) {
    markWebsignDead()
    throw new Error(`websign 被拦（${t ? t.slice(0, 20) : "空响应"}）`)
  }
  return text
}

/**
 * 作品列表（免签名通道，2026-10-14 新增）——WebView 渲染移动分享页，从页面运行时里挖出作品对象。
 *
 * 为什么必须这么拓（真机实测）：
 *   · 移动端 /aweme/v1/aweme/post/ 现在一律返空列表（IP 级风控，换身份/换主机/换 UA 都一样）
 *   · 网页端 /aweme/v1/web/aweme/post/ 的 Argus 签名算法已变：uifid 仍有效，
 *     但我们本地算的签名会 403 / 被服务端拖住（旧版能过，两天后就失效了）
 *   · 而 m.douyin.com/share/user/<sec_uid> 这页自己能签名、能把作品渲染出来
 *     → 我们只从渲染结果里取 aweme_id / 标题 / 封面 / 时长 / 点赞 / 图片数
 *   · 播放地址不在分享页数据里 → 播放/下载时由移动端 detail 接口补（该通道免签且已验证可用）
 */
const SHARE_USER_EXTRACT_JS = `return (()=>{
  const out = new Map(); const seen = new WeakSet();
  const norm = (o) => {
    const id = String(o.aweme_id ?? '');
    if (!/^\\d{15,}$/.test(id)) return null;
    const v = o.video || {};
    const cl = (v.cover && v.cover.url_list) || (v.origin_cover && v.origin_cover.url_list) || [];
    return { id, desc: String(o.desc ?? '').slice(0, 120), cover: String(cl[0] ?? ''),
      dur: Number(v.duration ?? 0) || 0,
      digg: Number((o.statistics && o.statistics.digg_count) ?? 0) || 0,
      imgs: Array.isArray(o.images) ? o.images.length : 0 };
  };
  const walk = (o, d) => {
    if (d > 7 || !o || typeof o !== 'object') return;
    if (seen.has(o)) return; seen.add(o);
    if (o.aweme_id) { const n = norm(o); if (n && !out.has(n.id)) out.set(n.id, n); }
    let ks = []; try { ks = Object.keys(o) } catch (e) { return }
    for (const k of ks) { let v = null; try { v = o[k] } catch (e) { continue } if (v && typeof v === 'object') walk(v, d + 1) }
  };
  document.querySelectorAll('div,span,li,img,a').forEach((el, i) => {
    if (i > 400) return;
    let ks = []; try { ks = Object.keys(el) } catch (e) { return }
    for (const k of ks) if (k.startsWith('__react') || k.startsWith('__vue')) { walk(el[k], 0); break }
  });
  return JSON.stringify({ items: [...out.values()] });
})()`

async function fetchUserPostsViaSharePage(secUid: string): Promise<{ videos: VideoInfo[]; maxCursor: number; hasMore: boolean }> {
  // 取数开始 = 这个 WebView 正忙：先把「45 秒后释放」的定时器撤掉，
  // 否则上一轮延后的 dispose 可能正好在本次 evaluateJavaScript 途中把页面干掉。
  if (_shareWvTimer) { clearTimeout(_shareWvTimer); _shareWvTimer = null }
  const wv = getShareWebView()
  try {
    await timeoutFetch(wv.loadURL(`https://m.douyin.com/share/user/${encodeURIComponent(secUid)}`), 20000)
    await timeoutFetch(wv.waitForLoad(), 20000)
    // 轮询等待：作品网格是页面 JS 异步渲染的，等它出现再取（首抽 1.8s，之后每 1.1s，最多 ~10s）
    let items: any[] = []
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((r) => setTimeout(r, i === 0 ? 900 : 700))
      try {
        const raw = await timeoutFetch(wv.evaluateJavaScript(SHARE_USER_EXTRACT_JS), 12000)
        const parsed = safeJSONParse(String(raw || "")) as any
        items = Array.isArray(parsed?.items) ? parsed.items : []
      } catch { items = [] }
      if (items.length > 0) break
    }
    // 只有在「条目偏少」时才下滑尝试：分享页实测就一页（15 条），下滑白花 2-3 秒
    if (items.length > 0 && items.length < 10) {
      const seen = new Set(items.map((it) => String(it?.id || "")))
      for (let round = 0; round < 2; round++) {
        try {
          await wv.evaluateJavaScript("return (()=>{const e=document.scrollingElement||document.documentElement;const els=[e,document.body];document.querySelectorAll('div,main,section').forEach((x)=>{if(x.scrollHeight>x.clientHeight+200)els.push(x)});els.forEach((x)=>{if(!x)return;try{x.scrollTop=x.scrollHeight}catch(err){}});return 'ok'})()")
        } catch {}
        await new Promise<void>((r) => setTimeout(r, 1600))
        try {
          const raw2 = await timeoutFetch(wv.evaluateJavaScript(SHARE_USER_EXTRACT_JS), 12000)
          const p2 = safeJSONParse(String(raw2 || "")) as any
          const more: any[] = Array.isArray(p2?.items) ? p2.items : []
          let added = 0
          for (const it of more) {
            const id = String(it?.id || "")
            if (id && !seen.has(id)) { seen.add(id); items.push(it); added++ }
          }
          if (added === 0) break
        } catch { break }
      }
    }
    const videos: VideoInfo[] = items.map((it) => ({
      aweme_id: String(it?.id || ""), desc: String(it?.desc || ""), create_time: 0,
      cover: String(it?.cover || ""), play_url: "",
      duration: Number(it?.dur) || 0, digg_count: Number(it?.digg) || 0, comment_count: 0,
      author_nickname: "", author_avatar: "", unique_id: "", author_ip_location: "",
      images: new Array(Number(it?.imgs) || 0).fill(0).map(() => ({ url: "" } as ImageInfo)),
    })).filter((v) => !!v.aweme_id)
    return { videos, maxCursor: 0, hasMore: false }
  } finally {
    // 标记来源：分享页只能拿到首页，底部文案要说实话
    lastListSource = "share"
    // ⚠️ 不 dispose：这个 WebView 要跨页复用（每次新建 ≈ 白等 2-3 秒，也是之前「不流畅」的主因）；
    //    但也不能永久占内存 → 闲置 45 秒自动释放
    scheduleShareWvRelease()
  }
}

/** 跨页复用的分享页 WebView（长期存活；只在需要时创建） */
let _shareWV: WebViewController | null = null
let _shareWvTimer: ReturnType<typeof setTimeout> | null = null
function getShareWebView(): WebViewController {
  if (!_shareWV) _shareWV = new WebViewController({ ephemeral: false })
  return _shareWV
}
/** 释放（切用户/闲置时调用，避免留一个常驻 WebView 占内存） */
function disposeShareWebView() {
  try { _shareWV?.dispose() } catch {}
  _shareWV = null
  if (_shareWvTimer) { clearTimeout(_shareWvTimer); _shareWvTimer = null }
}
/** 用完之后把释放推到 45 秒后（期间翻页仍复用同一个 WebView） */
function scheduleShareWvRelease() {
  if (_shareWvTimer) clearTimeout(_shareWvTimer)
  _shareWvTimer = setTimeout(() => disposeShareWebView(), 45000)
}

/** pysign 目录：存放用户自己的 Python 签名包（7452323/douyin-sign 的 sign/ 子集） */
const PYSIGN_DIRS = [
  "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/镜花水月/pysign",
]
function resolvePysignDir(): string {
  for (const d of PYSIGN_DIRS) {
    try { if (FileManager.existsSync(d + "/sign/__init__.py")) return d } catch {}
  }
  return PYSIGN_DIRS[0]
}

/** 最近一次列表的来源（signer = 带登录态的完整分页；share = 分享页只剩首页） */
let lastListSource: "signer" | "share" | "" = ""

/** 签名器失败后的冷却（避免未登录/出错时每次加载都白等 1 秒） */
let signerDeadUntil = 0
function markSignerDead() { signerDeadUntil = Date.now() + 5 * 60 * 1000 }
function signerUsable() {
  if (Date.now() < signerDeadUntil) return false
  return !!(Storage.get<string>(KEY_COOKIE) || "").trim()
}

/**
 * ⭐ 主通道（2026-10-14 实测打通）：在 App 内用**用户自己的 Python 签名包**签移动端请求。
 * 为什么必须这样：作品接口对「非 App 登录会话」一律返空 —— 匿名、带网页 Cookie、全签名都不行；
 * 只有把**登录 Cookie + X-Gorgon/X-Argus/X-Ladon/X-Khronos/X-SS-STUB** 一起发出去才会给数据。
 * 实测：30 条 / 2.3MB / has_more=1 / max_cursor 可翻页 / 自带 play_addr。
 *
 * 实现：Scripting 的 `Python.run` 直接跑 `pysign/sign` 包（cookie 只以字符串形式进内存，不落盘）。
 */
async function fetchUserPostsViaSigner(secUid: string, cursor: number = 0): Promise<{ videos: VideoInfo[]; maxCursor: number; hasMore: boolean; totalCount: number; ok: boolean }> {
  const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (!cookie) throw new Error("没有 Cookie")
  const dir = resolvePysignDir()
  // ⚠️ 首页**必须传 0**（2026-10-17 实测推翻 1.0.30 的结论）：
  //    只有 max_cursor=0 才会把「作者置顶」的作品一起返回（is_top=1）。
  //    实测账号 81170919561：cursor=0 的前两条就是置顶的 2025-01 / 2026-05 老作品；
  //    传 Date.now() 时它俩完全不在结果里（时间窗口直接跳过了）。
  //    置顶在前、其余时间降序；若服务端反过来给（历史上出现过），fixOrder() 会整体纠正。
  const effCursor = cursor > 0 ? String(cursor) : "0"
  const needTotal = cursor <= 0
  const L: string[] = []
  L.push("import sys, json, ssl, time, urllib.request")
  L.push("sys.path.insert(0, " + JSON.stringify(dir) + ")")
  L.push("from sign import sign_all")
  L.push("from sign.device import make_seed_device")
  L.push("dev = make_seed_device()")
  L.push("cookie = " + JSON.stringify(cookie))
  L.push("base = {'device_platform':'iphone','aid':'1128','channel':'App%20Store','app_name':'aweme',")
  L.push(" 'version_code':'40.4.0','version_name':'40.4.0','device_type':'iPhone17,3','os_version':'27.0.1',")
  L.push(" 'iid':'7683339722235938341','device_id':'1923489864614387'}")
  L.push("def call(path, extra, tmo=12):")
  L.push("    p = dict(base); p.update(extra)")
  L.push("    qs = '&'.join('%s=%s' % (k, v) for k, v in p.items())")
  L.push("    url = 'https://api5-normal-c-lq.amemv.com' + path + '?' + qs")
  L.push("    h = sign_all(method='GET', url=url, body=b'', cookies=cookie, device=dev)")
  L.push("    req = urllib.request.Request(url)")
  L.push("    for k, v in h.items():")
  L.push("        try: req.add_header(k, v)")
  L.push("        except Exception: pass")
  L.push("    try: req.add_header('Cookie', cookie)")
  L.push("    except Exception: pass")
  L.push("    req.add_header('User-Agent', 'Aweme/404017 CFNetwork/3896.100.1.2.1 Darwin/27.0.0')")
  L.push("    r = urllib.request.urlopen(req, timeout=tmo, context=ssl._create_unverified_context())")
  L.push("    return r.read().decode('utf-8', 'ignore')")
  L.push("out = {}")
  L.push("try:")
  L.push("    out['post'] = call('/aweme/v1/aweme/post/', {'sec_user_id': " + JSON.stringify(secUid) + ", 'max_cursor': " + JSON.stringify(effCursor) + ", 'count': '30', 'publish_video_strategy_type': '2', 'source': '0'})")
  L.push("except Exception as e:")
  L.push("    out['err'] = str(e)[:200]")
  if (needTotal) {
    // 作品总数（aweme_count）：用于判断「是不是真的全了」——
    // 未登录/仅好友可见的作品不会进 post 列表，旧版本却照样写「已加载全部作品」。
    L.push("try:")
    L.push("    out['user'] = call('/aweme/v1/user/', {'sec_user_id': " + JSON.stringify(secUid) + "}, 2)")
    L.push("except Exception:")
    L.push("    pass")
  }
  L.push("sys.stdout.write(json.dumps(out))")
  const res: any = await timeoutFetch(Python.run(L.join("\n")), 30000)
  const raw = String(res?.output || "")
  if (!raw) throw new Error("签名器没有输出")
  // Python 的 stdout 偶尔会被 App 自身的日志混入 → 只取 JSON 主体
  let parsed: any = null
  const bi = raw.indexOf("@@B@@"), ei = raw.lastIndexOf("@@E@@")
  try { parsed = safeJSONParse(raw) } catch {
    try { parsed = safeJSONParse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) } catch { parsed = null }
  }
  if (bi >= 0 && ei > bi) { try { parsed = safeJSONParse(raw.slice(bi + 5, ei)) } catch { /* keep */ } }
  if (!parsed) throw new Error("签名器返回无法解析")
  if (parsed?.err) throw new Error("签名请求失败：" + String(parsed.err))
  const post = typeof parsed.post === "string" ? safeJSONParse(parsed.post) : parsed.post
  const list: any[] = Array.isArray(post?.aweme_list) ? post.aweme_list : []
  const videos: VideoInfo[] = list
    .filter((it: any) => Number(it?.aweme_type) !== 101)
    .map(awemeToVideoInfo)
    .filter((v: VideoInfo) => !!v.aweme_id && (!!v.play_url || v.images.length > 0))
  // 顺序以服务端为准（置顶在最前）；只在整页反向时才反转，别再按时间重排
  const ordered = fixOrder(videos)
  // aweme_count：账号自己主页上「作品 N」的那个 N（含仅自己可见的作品）
  let totalCount = 0
  try {
    const u = (typeof parsed.user === "string" ? safeJSONParse(parsed.user) : parsed.user)?.user
    totalCount = Number(u?.aweme_count) || 0
  } catch { totalCount = 0 }
  lastListSource = "signer"
  // ok=true 表示「请求本身成功」：即使 aweme_list 为空（已翻到尾部），也不该再回退到分享页
  return { videos: ordered, maxCursor: Number(post?.max_cursor) || 0, hasMore: Number(post?.has_more) === 1, totalCount, ok: true }
}

/** 最近一次签名通道拿到的「作品总数」（aweme_count，含仅自己可见的作品） */
let lastAwemeCount = 0

/** 单次取一页（内部用） */
async function fetchUserPostsOnce(secUid: string, cursor: number = 0): Promise<{ videos: VideoInfo[]; maxCursor: number; hasMore: boolean }> {
  let lastError: unknown = null
  // ① 主通道：登录态 + 你自己的 Python 签名包（完整分页、最快最全）
  if (signerUsable()) {
    try {
      const parsed = await fetchUserPostsViaSigner(secUid, cursor)
      if (parsed.totalCount > 0) lastAwemeCount = parsed.totalCount
      if (parsed.videos.length > 0) return parsed
      // 签名请求成功但列表为空 = 已经翻到底（不是通道失败）→ 直接当成功返回，
      // 否则会去开分享页、把 cursor 重置、底部文案从「已加载全部」变成受限提示
      if (parsed.ok) return parsed
    } catch (e) {
      lastError = e
      // 超时属于排队/网络问题，不代表签名器坏了 —— 不要因此让它冷却 5 分钟
      const msg = String((e as any)?.message || e)
      if (msg.indexOf("timeout") < 0) markSignerDead()
    }
  }
  // ② 移动端免签通道（现在基本返空，留着以防平台又放开）
  try {
    const raw = await mobileGet("/aweme/v1/aweme/post/", {
      sec_user_id: secUid, max_cursor: String(cursor), count: String(POST_PAGE_SIZE),
      publish_video_strategy_type: "2", source: "0", _rticket: String(Date.now()),
    })
    const parsed = parseAwemeResponse(raw)
    if (parsed.videos.length > 0) return parsed
  } catch (e) { lastError = e }
  // ③ 回退：WebView 渲染移动分享页（免签名 / 免 uifid，但只有首页）
  try {
    const parsed = await fetchUserPostsViaSharePage(secUid)
    if (parsed.videos.length > 0) return parsed
  } catch (e) { lastError = e }
  // ④ 回退：网页端签名（Argus 算法已变，现在基本被拦；内部带超时）
  try {
    return parseAwemeResponse(await fetchViaWebsign(secUid, cursor))
  } catch (e) { lastError = e }
  // ⑤ 最后回退：Cookie 裸直连
  try {
    return parseAwemeResponse(await fetchViaCookie(secUid, cursor))
  } catch (e) { lastError = e }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 上一次续拉（第 2/3 页）失败的原因；footer 用它区分「网络失败」与「未公开作品」 */
let lastPartialError = ""

/**
 * 对外入口。
 * ⭐ 首页额外做一件事：某些账号（小号）第一页只回几条但 has_more 仍是 true，
 *   光拉一页会让人以为“作品就这么点” → 条目 < 20 时自动续拉（最多 2 页）、去重、重排。
 */
export async function fetchUserPosts(secUid: string, cursor: number = 0): Promise<{ videos: VideoInfo[]; maxCursor: number; hasMore: boolean; totalCount: number }> {
  // 首屏重置总数：切用户后若新用户的签名通道失败，不能把上一个账号的 aweme_count 当成它的
  if (cursor === 0) { lastAwemeCount = 0; lastPartialError = "" }
  const first = await fetchUserPostsOnce(secUid, cursor)
  // 只有首屏、且条目偏少、且还有更多时才续拉（用户翻页时不走这里）
  if (cursor !== 0 || first.videos.length >= 20 || first.hasMore !== true) return { ...first, totalCount: lastAwemeCount }

  const merged: VideoInfo[] = first.videos.slice()
  const seen = new Set<string>(merged.map((v) => v.aweme_id))
  let cur: number = first.maxCursor
  let more: boolean = first.hasMore

  const absorb = (list: VideoInfo[]) => {
    for (const v of list) {
      if (v.aweme_id && !seen.has(v.aweme_id)) { seen.add(v.aweme_id); merged.push(v) }
    }
  }

  // 第 2 页
  try {
    const p2 = await fetchUserPostsOnce(secUid, cur)
    absorb(p2.videos)
    cur = p2.maxCursor
    more = p2.hasMore === true
  } catch (e) {
    more = false
    lastPartialError = String((e as any)?.message || e).slice(0, 60)
  }

  // 第 3 页（仍不足 20 条时）
  if (more === true && merged.length < 20) {
    try {
      const p3 = await fetchUserPostsOnce(secUid, cur)
      absorb(p3.videos)
      cur = p3.maxCursor
      more = p3.hasMore === true
    } catch (e) {
      more = false
      lastPartialError = String((e as any)?.message || e).slice(0, 60)
    }
  }

  return { videos: fixOrder(merged), maxCursor: cur, hasMore: more, totalCount: lastAwemeCount }
}

// ─── 获取用户完整资料 ───
function timeoutFetch<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ])
}

/** 移动端免签通道取作者信息（用于补 shortId / 获赞 / IP 地区，无需 Cookie） */
async function fetchAuthorViaMobile(secUid: string): Promise<any | null> {
  try {
    const raw = await mobileGet("/aweme/v1/aweme/post/", {
      sec_user_id: secUid, max_cursor: "0", count: "6",
      publish_video_strategy_type: "2", source: "0", _rticket: String(Date.now()),
    }, 10000)
    const data = JSON.parse(raw)
    return data?.aweme_list?.[0]?.author || null
  } catch { return null }
}

async function fetchUserProfile(secUid: string): Promise<Partial<SavedUser> | null> {
  let result: Partial<SavedUser> = {}
  let shortId = ""

  // 1. 用 sec_uid 调 iesdouyin（基础数据）—— 先不带 Cookie（实测免签可用），失败再带 Cookie
  try {
    const url = `https://www.iesdouyin.com/web/api/v2/user/info/?sec_uid=${encodeURIComponent(secUid)}`
    const cookie = (Storage.get<string>(KEY_COOKIE) || "").trim()
    const attempts: Record<string, string>[] = [
      { "User-Agent": ANDROID_UA, Referer: "https://www.iesdouyin.com/" },
    ]
    if (cookie) attempts.push({ "User-Agent": ANDROID_UA, Referer: "https://www.iesdouyin.com/", Cookie: cookie })
    for (const headers of attempts) {
      try {
        const resp = await timeoutFetch(fetch(url, { method: "GET", headers }), 10000)
        if (!resp.ok) continue
        const data = await resp.json()
        const info = data?.user_info
        if (info && info.sec_uid) {
          result = {
            nickname: info.nickname || "",
            avatar: pickFirstUrl(info.avatar_thumb?.url_list) || pickFirstUrl(info.avatar_larger?.url_list) || "",
            shortId: info.unique_id || "",
            totalFavorited: parseInt(info.total_favorited) || 0,
            followingCount: info.following_count || 0,
            followerCount: info.follower_count || 0,
            signature: info.signature || info.desc || "",
            ipLocation: info.ip_location || info.ip_loc || info.region || "",
            gender: info.gender ?? 0,
          }
          break
        }
      } catch {}
    }
  } catch {}
  // 2. 从已保存数据拿 shortId
  if (!shortId) {
    const existing = loadSavedUsers().find((u) => u.id === secUid)
    if (existing?.shortId) shortId = existing.shortId
  }

  // 3. 从作品作者信息提取 unique_id —— 优先移动端免签通道
  if (!shortId) {
    const author = await fetchAuthorViaMobile(secUid)
    if (author?.unique_id) shortId = author.unique_id
  }
  if (!shortId) {
    try {
      const rawJson = await timeoutFetch(fetchViaCookie(secUid, 0), 15000)
      const data = JSON.parse(rawJson)
      const author = data?.aweme_list?.[0]?.author
      if (author?.unique_id) shortId = author.unique_id
    } catch {}
  }



  // 4. 尝试抖音官方用户资料 API（需要 Cookie）— 补充任何缺失字段
  if (!result.totalFavorited || !result.signature || !result.ipLocation || !result.gender) {
    try {
      const cookie = Storage.get<string>(KEY_COOKIE) || ""
      if (cookie && cookie.length >= 50) {
        const url = `https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${encodeURIComponent(secUid)}&device_platform=web&aid=6383&cookie_enabled=true&platform=web`
        const resp = await timeoutFetch(fetch(url, {
          method: "GET",
          headers: { "User-Agent": ANDROID_UA, "Cookie": cookie, "Referer": "https://www.douyin.com/" }
        }), 15000)
        if (resp.ok) {
          const data = await resp.json()
          const user = data?.user
          if (user) {
            const avatar = pickFirstUrl(user.avatar_thumb?.url_list) || pickFirstUrl(user.avatar_larger?.url_list) || ""
            result = {
              nickname: user.nickname || result.nickname || "",
              avatar: avatar || result.avatar || "",
              shortId: user.unique_id || result.shortId || "",
              totalFavorited: parseInt(user.total_favorited) || result.totalFavorited || 0,
              followingCount: user.following_count || result.followingCount || 0,
              followerCount: user.follower_count || result.followerCount || 0,
              signature: user.signature || user.desc || result.signature || "",
              ipLocation: user.ip_location || user.ip_loc || user.region || result.ipLocation || "",
              gender: user.gender ?? result.gender ?? 0,
            }
            // 不要 return — 后面还有从 author 数据补 IP 的步骤
          }
        }
      }
    } catch {}
  }

  // 5.5 如果 IP 地区仍为空，尝试从保存的用户数据中提取（不额外请求 API）
  if (!result.ipLocation) {
    // 从已保存的用户列表里找同一个人
    const existing = loadSavedUsers().find((u) => u.id === secUid)
    if (existing?.ipLocation) result.ipLocation = existing.ipLocation
  }

  // 6. 最终回退：直接从 author 数据（优先移动端免签通道）
  if (!result.totalFavorited) {
    const mAuthor = await fetchAuthorViaMobile(secUid)
    if (mAuthor) {
      result = {
        nickname: mAuthor.nickname || result.nickname || "",
        avatar: pickFirstUrl(mAuthor.avatar_thumb?.url_list) || pickFirstUrl(mAuthor.avatar_larger?.url_list) || result.avatar || "",
        shortId: mAuthor.unique_id || result.shortId || "",
        totalFavorited: parseInt(mAuthor.total_favorited) || result.totalFavorited || 0,
        followingCount: mAuthor.following_count || result.followingCount || 0,
        followerCount: mAuthor.follower_count || result.followerCount || 0,
        signature: mAuthor.signature || result.signature || "",
        ipLocation: mAuthor.ip_location || mAuthor.ip_loc || mAuthor.region || result.ipLocation || "",
        gender: mAuthor.gender ?? result.gender ?? 0,
      }
    }
  }
  if (!result.totalFavorited) {
    try {
      const rawJson = await timeoutFetch(fetchViaCookie(secUid, 0), 15000)
      const data = JSON.parse(rawJson)
      const author = data?.aweme_list?.[0]?.author
      if (author) {
        result = {
          nickname: author.nickname || result.nickname || "",
          avatar: pickFirstUrl(author.avatar_thumb?.url_list) || pickFirstUrl(author.avatar_larger?.url_list) || result.avatar || "",
          shortId: author.unique_id || result.shortId || "",
          totalFavorited: parseInt(author.total_favorited) || result.totalFavorited || 0,
          followingCount: author.following_count || result.followingCount || 0,
          followerCount: author.follower_count || result.followerCount || 0,
          signature: author.signature || result.signature || "",
          ipLocation: author.ip_location || author.ip_loc || author.region || result.ipLocation || "",
          gender: author.gender ?? result.gender ?? 0,
        }
      }
    } catch {}
  }

  return Object.keys(result).length > 0 ? result : null
}


// ─── 抖音登录（内嵌浏览器登录 → 自动提取 Cookie） ───
// 为什么需要：作品列表缺的那些是「未公开作品」，服务端只认真实登录会话；
// 而旧的 Cookie 校验接口（im/user/info）长期假阳性，用户看不到「登录已失效」。
// 这里顺手用 profile/self 复核一次，避免存进去又是一个假登录态。
function DouyinLoginView({ onDone }: { onDone: (cookie: string) => void }) {
  const dismiss = Navigation.useDismiss()
  const controller = useMemo(() => new WebViewController({ ephemeral: false }), [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("扫码或手机号登录，完成后点右上角「保存」")

  useEffect(() => {
    try {
      controller.setCustomUserAgent(MOBILE_UA)
      controller.loadURL("https://www.douyin.com/")
    } catch { }
    // ⚠️ 每次打开登录页都会 new 一个 WebViewController，不 dispose 会一直占着内存
    return () => { try { controller.dispose() } catch { } }
  }, [])

  async function handleSave() {
    setBusy(true)
    setMsg("正在提取 Cookie...")
    try {
      const cookies = await controller.getAllCookies()
      const list = (cookies || []).filter((c: any) => String(c.domain || "").indexOf("douyin.com") >= 0 && c.value)
      // 同名 cookie 可能有多条（不同 domain/path）→ 按 name 去重，后写覆盖前写，避免拼接出重复键
      const map = new Map<string, string>()
      for (const c of list) map.set(String(c.name), String(c.value))
      const str = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ")
      if (!str || !hasDouyinAuthCookie(str)) {
        setMsg("没拿到登录态（sessionid 缺失），请确认已经登录成功再保存")
        setBusy(false)
        return
      }
      const checked = await validateCookieString(str)
      if (!checked.valid) {
        setMsg("服务端仍判定未登录：" + checked.detail)
        setBusy(false)
        return
      }
      Storage.set(KEY_COOKIE, str)
      // 新会话的 UIFID 可能还没写入；旧缓存属于上一个会话，清掉让 ensureUifid 重新取
      clearUifid()
      onDone(str)
      dismiss()
    } catch (e: any) {
      setMsg("提取失败：" + String(e?.message || e))
      setBusy(false)
    }
  }

  return (
    <NavigationStack>
      <VStack
        spacing={0}
        navigationTitle="登录抖音"
        toolbar={{
          topBarLeading: <Button title="取消" action={() => dismiss()} />,
          topBarTrailing: busy ? <ProgressView /> : <Button title="保存" action={handleSave} />,
        }}
      >
        <WebView controller={controller} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
        <HStack spacing={6} padding={10} frame={{ maxWidth: "infinity" }} background="secondarySystemBackground">
          <Image systemName={busy ? "clock" : "info.circle"} font="caption" foregroundStyle="secondaryLabel" />
          <Text font="caption2" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{msg}</Text>
        </HStack>
      </VStack>
    </NavigationStack>
  )
}

// ─── 切换用户弹窗 ───
function SwitchUserView({ onSwitch, currentUid }: { onSwitch: (uid: string) => void; currentUid: string }) {
  const dismiss = Navigation.useDismiss()
  // 惰性初始化：Storage 读取只在打开面板时跑一次（原先写在 render 里，每次重渲染都读盘 + JSON.parse）
  const [users] = useState(() => loadSavedUsers())
  const [switching, setSwitching] = useState(false)

  return (
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="systemBackground">
      <NavigationStack>
        <List navigationTitle="切换抖音号">
          {users.length === 0 ? (
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={16}>
              <Image systemName="person.2.slash" font="largeTitle" foregroundStyle="tertiaryLabel" />
              <Text font="title3" bold foregroundStyle="secondaryLabel">还没有保存的抖音号</Text>
              <Text font="callout" foregroundStyle="tertiaryLabel">去「设置」标签页添加</Text>
            </VStack>
          ) : (
            <Section>
              {/* 用网格展示 */}
              <VStack>
                <LazyVGrid columns={[
                  { size: { type: "flexible", min: 80, max: 120 }, spacing: 12 },
                  { size: { type: "flexible", min: 80, max: 120 }, spacing: 12 },
                  { size: { type: "flexible", min: 80, max: 120 }, spacing: 12 },
                ]} spacing={16} padding={16}>
                  {users.map((u) => (
                    <VStack key={u.id} spacing={6} alignment="center" frame={{ maxWidth: "infinity" }} onTapGesture={() => {
                      if (u.id === currentUid) { dismiss(); return }
                      setSwitching(true); saveSecUid(u.id); dismiss(); onSwitch(u.id)
                    }}>
                      {u.avatar ? (
                        <Image imageUrl={u.avatar} resizable scaleToFill frame={{ width: 64, height: 64 }} clipShape={{ type: "rect", cornerRadius: 32 }} />
                      ) : (
                        <VStack frame={{ width: 64, height: 64 }} background="systemGray4" clipShape={{ type: "rect", cornerRadius: 32 }} alignment="center">
                          <Image systemName="person.fill" font="title2" foregroundStyle="secondaryLabel" />
                        </VStack>
                      )}
                      <Text font="caption" lineLimit={1}>{u.nickname || u.id.slice(0, 10)}</Text>
                      {u.id === currentUid ? <Text font="caption2" foregroundStyle="systemBlue">当前</Text> : null}
                    </VStack>
                  ))}
                </LazyVGrid>
              </VStack>
            </Section>
          )}
        </List>
      </NavigationStack>
    </VStack>
  )
}

// ─── Cookie 工具函数 ───

function hasDouyinAuthCookie(cookie: string): boolean {
  return /(?:^|;\s*)(sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt)=([^;]{6,})/.test(cookie)
}

async function validateCookieString(cookie: string): Promise<{ valid: boolean; detail: string }> {
  const trimmed = cookie.trim()
  if (!trimmed || trimmed.length < 50 || !hasDouyinAuthCookie(trimmed)) {
    return { valid: false, detail: "未检测到登录 Cookie" }
  }
  try {
    // ⚠️ 2026-10-17 真机实测：im/user/info 对**任何** Cookie 都回 status_code=0 + "url does not match"，
    // 所以以前这里长期「假阳性」——设置页显示「Cookie 有效」，服务端其实早就不认这个会话了。
    // 能真正判断登录态的只有 profile/self：未登录时回 status_code=8 / "用户未登录"。
    const resp = await fetch(
      "https://www.douyin.com/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&publish_video_strategy_type=2",
      {
        method: "GET",
        headers: {
          "User-Agent": MOBILE_UA,
          "Cookie": trimmed,
          "Referer": "https://www.douyin.com/",
          "Accept": "application/json",
        },
      }
    )
    if (!resp.ok) return { valid: false, detail: `检查失败: HTTP ${resp.status}` }
    const text = await resp.text()
    let json: any
    try { json = JSON.parse(text) } catch { return { valid: false, detail: "Cookie 校验返回异常" } }
    const u = json?.user || {}
    if (json.status_code === 0 && (u.uid || u.nickname)) {
      return { valid: true, detail: `已登录：${u.nickname || u.uid}` }
    }
    if (json.status_code === 8) return { valid: false, detail: "登录已失效，请重新登录" }
    if (json.status_code === 3 || json.status_code === -99) return { valid: false, detail: "Cookie 已过期，请重新登录" }
    return { valid: false, detail: `校验失败: ${json.status_code ?? "未知状态"}` }
  } catch (e: any) {
    return { valid: false, detail: `检查失败: ${e.message || e}` }
  }
}

/**
 * 网格卡片的固定尺寸（用户 2026-10-12 要求）。
 * 原因：标题长短不一（1 行 vs 2 行）会让卡片高度不同 → 封面高低不齐。
 * 所以：封面固定高 + 标题区固定高（顶部对齐）+ 卡片整体固定高。
 */
const GRID_COVER_HEIGHT = 200
const GRID_TITLE_HEIGHT = 34                                                      // 2 行 caption2 的高度
const GRID_CARD_HEIGHT = GRID_COVER_HEIGHT + GRID_TITLE_HEIGHT + 5 + 6            // 封面 + 标题 + 间距 + 上下内边距
const HISTORY_CARD_HEIGHT = GRID_COVER_HEIGHT + GRID_TITLE_HEIGHT + 17 + 10 + 6   // 再多一行日期 + 两个间距

function VideoGridCard({ video, cardWidth, onOpen }: { video: VideoInfo; cardWidth: number; onOpen: () => void }) {
  const coverWidth = cardWidth - 8
  return (
    <VStack
      key={video.aweme_id}
      spacing={5}
      padding={{ horizontal: 4, vertical: 3 }}
      frame={{ width: cardWidth, height: GRID_CARD_HEIGHT, alignment: "top" }}
      background="systemBackground"
      overlay={{
        alignment: "topTrailing",
        content: (
          <VStack padding={7} allowsHitTesting={false}>
            {video.is_top ? (
              <HStack padding={{ horizontal: 6, vertical: 2 }} background="black" opacity={0.55} clipShape={{ type: "rect", cornerRadius: 4 }} spacing={3}>
                <Image systemName="pin.fill" font="caption2" foregroundStyle="white" />
                <Text font="caption2" foregroundStyle="white">置顶</Text>
              </HStack>
            ) : null}
          </VStack>
        ),
      }}
    >
      <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} background="systemGray5" clipShape={{ type: "rect", cornerRadius: 8 }} clipped overlay={{ alignment: "center", content: (
        <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} background="black" opacity={0.001} onTapGesture={onOpen} />
      )}}>
        {video.cover ? <Image imageUrl={video.cover} resizable scaleToFill frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} clipped allowsHitTesting={false} overlay={{ alignment: "bottom", content: (
          <VStack padding={3} spacing={3}>
            <HStack>
              {video.duration > 0 ? (
                <HStack padding={{ horizontal: 6, vertical: 2 }} background="black" opacity={0.6} clipShape={{ type: "rect", cornerRadius: 4 }} spacing={3}>
                  <Image systemName="play.fill" font="caption2" foregroundStyle="white" />
                  <Text font="caption2" foregroundStyle="white">{formatDuration(video.duration)}</Text>
                </HStack>
              ) : null}
              {video.images.length > 0 ? (
                <HStack padding={{ horizontal: 6, vertical: 2 }} background="black" opacity={0.6} clipShape={{ type: "rect", cornerRadius: 4 }} spacing={3}>
                  <Image systemName="photo.on.rectangle" font="caption2" foregroundStyle="white" />
                  <Text font="caption2" foregroundStyle="white">{video.images.length}</Text>
                </HStack>
              ) : null}
            </HStack>
            <HStack>
              <HStack spacing={2}>
                <Image systemName="heart.fill" font="caption2" foregroundStyle="systemPink" />
                <Text font="caption2" foregroundStyle="white">{formatCount(video.digg_count)}</Text>
              </HStack>
            </HStack>
          </VStack>
        )}} />
        : <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} alignment="center" allowsHitTesting={false}><Image systemName="play.rectangle" font="largeTitle" foregroundStyle="tertiaryLabel" /></VStack>}
      </VStack>
      {/* 标题区固定高度 + 左上对齐：1 行 / 2 行标题都占同一块，卡片高度就一致了 */}
      <Text
        font="caption2"
        lineLimit={2}
        frame={{ width: coverWidth, height: GRID_TITLE_HEIGHT, alignment: "topLeading" }}
        padding={{ horizontal: 2 }}
      >
        {video.desc}
      </Text>
    </VStack>
  )
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

/**
 * 作品列表缓存（模块级）。
 * 目的（用户 2026-10-12 明确要求）：切标签页 / 进作品详情后返回 / 组件重挂载时
 * **不再自动重新拉取**；只有「切换用户」（头像或设置页）或「手动点右上角刷新」才重载。
 */
const worksCache: {
  uid: string
  videos: VideoInfo[]
  cursor: number
  hasMore: boolean
  totalCount: number
  /** 这份缓存对应的 Cookie 指纹：登录/换号后变了就必须重拉，不能拿旧数据充数 */
  cookieSig: string
  userInfo: { nickname: string; avatar: string }
} = { uid: "", videos: [], cursor: 0, hasMore: false, totalCount: 0, cookieSig: "", userInfo: { nickname: "", avatar: "" } }

/** Cookie 指纹（长度 + 首尾 8 字符 + sessionid 片段）：只用来判断“登录态变了没”，不落盘完整凭据 */
function cookieSignature(): string {
  const c = (Storage.get<string>(KEY_COOKIE) || "").trim()
  if (!c) return ""
  const sid = (c.match(/(?:^|;\s*)sessionid=([^;]+)/) || ["", ""])[1] || ""
  return `${c.length}:${c.slice(0, 8)}:${c.slice(-8)}:${sid.length}:${sid.slice(0, 6)}`
}

/**
 * 首屏重拉的重入锁 + 请求序号。
 * ⚠️ 必须互斥：两次并发重拉会让 Python 签名在串行队列里排队，后一个超时 →
 * markSignerDead → 回退到分享页（条数更少）→ 把已经拿到的完整列表覆盖成残缺的。
 */
let resetInFlight: { uid: string; seq: number } | null = null
let loadSeq = 0

// ─── 主页 ───
export function HomeView({ dismissApp, isActive, homeTab }: { dismissApp?: () => void; isActive: boolean; homeTab?: boolean }) {
  // 跑在 App 首页 Tab 里时（入口传 homeTab）：没有「关闭 App」这个概念，
  // 顶栏改成放「历史 / 设置」入口（用户 2026-10-12 要求）。
  // 用显式 prop 而不是 Script.env：preview_ui 里 env 不是 home_screen，靠它判断没法验证。
  const inHomeTab = homeTab === true
  const gridCardWidth = getGridCardWidth()
  const [secUid, setSecUid] = useState(() => loadSecUid())
  // 注意：Storage 读取只能放在惰性初始化里（每个只跑一次），不能在 render 里每次读。
  const [videos, setVideos] = useState<VideoInfo[]>(() => (worksCache.uid !== "" && worksCache.uid === loadSecUid() ? worksCache.videos : []))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [cursor, setCursor] = useState(() => (worksCache.uid !== "" && worksCache.uid === loadSecUid() ? worksCache.cursor : 0))
  const [hasMore, setHasMore] = useState(() => (worksCache.uid !== "" && worksCache.uid === loadSecUid() ? worksCache.hasMore : false))
  const [totalCount, setTotalCount] = useState(() => (worksCache.uid !== "" && worksCache.uid === loadSecUid() ? worksCache.totalCount : 0))
  const [loadingMore, setLoadingMore] = useState(false)
  const [userInfo, setUserInfo] = useState<{ nickname: string; avatar: string }>(() => (worksCache.uid !== "" && worksCache.uid === loadSecUid() ? worksCache.userInfo : { nickname: "", avatar: "" }))

  async function doLoadVideos(reset: boolean, uidParam?: string) {
    const targetUid = uidParam || loadSecUid()
    if (!targetUid) { setError("请先设置抖音号"); return }
    // 首屏重拉：同号重复请求直接丢弃（避免并发排队）；换了号则作废旧请求
    if (reset) {
      if (resetInFlight) {
        if (resetInFlight.uid === targetUid) return
        loadSeq++          // 作废旧号的请求（它的结果会被 seq 检查丢弃）
        resetInFlight = null
      }
    }
    const seq = ++loadSeq
    if (reset) resetInFlight = { uid: targetUid, seq }
    // 请求开始时的 Cookie 指纹：写入缓存时用它（而不是完成时），
    // 否则刷新途中去登录，旧列表会被标成新签名 → 下次切回首页不会重拉。
    const sigAtStart = cookieSignature()
    const c = reset ? 0 : cursor
    if (reset) {
      setLoading(true); setVideos([]); setTotalCount(0); worksCache.totalCount = 0
      // 切号时先把标题/头像换成目标号的（没有就清空），避免拉取失败时顶部还挂着上一个账号
      const known = loadSavedUsers().find((u) => u.id === targetUid)
      const pre = { nickname: known?.nickname || "", avatar: known?.avatar || "" }
      setUserInfo(pre)
      worksCache.userInfo = pre
    } else { setLoadingMore(true) }
    setError("")
    try {
      const result = await fetchUserPosts(targetUid, c)
      if (seq !== loadSeq) return   // 已经有更新的请求了，这次结果作废
      if (reset) {
        setVideos(result.videos)
        worksCache.videos = result.videos
      } else {
        const base = worksCache.videos.length > 0 ? worksCache.videos : videos
        const existingIds = new Set(base.map((v) => v.aweme_id))
        const merged = [...base, ...result.videos.filter((v) => !existingIds.has(v.aweme_id))]
        worksCache.videos = merged
        setVideos(merged)
      }
      worksCache.uid = targetUid
      worksCache.cursor = result.maxCursor
      worksCache.hasMore = result.hasMore
      worksCache.cookieSig = sigAtStart
      if (result.totalCount > 0) worksCache.totalCount = result.totalCount
      setCursor(result.maxCursor)
      setHasMore(result.hasMore)
      setTotalCount(worksCache.totalCount)
      if (result.videos.length > 0) {
        const first = result.videos[0]
        const info = { nickname: first.author_nickname, avatar: first.author_avatar }
        worksCache.userInfo = info
        setUserInfo(info)
        // 保留已保存用户的已有字段，同时从作品数据提取 IP 地区
        const users = loadSavedUsers()
        const existing = users.find((u) => u.id === targetUid)
        const ipLoc = first.author_ip_location || ""
        if (existing) {
          saveUser({ ...existing, nickname: info.nickname, avatar: info.avatar, ipLocation: ipLoc || existing.ipLocation || "" })
        } else {
          saveUser({ id: targetUid, ...info, savedAt: Date.now(), ipLocation: ipLoc || "" })
        }
      }
    } catch (e) {
      if (seq === loadSeq) setError((e as Error).message)
    } finally {
      // 只由「当前这次请求」释放锁，避免被丢弃的旧请求把锁提前清掉
      if (reset && resetInFlight && resetInFlight.seq === seq) resetInFlight = null
      if (seq === loadSeq) {
        if (reset) setLoading(false)
        else setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    if (!isActive) return
    const activeUid = loadSecUid()
    if (activeUid !== secUid) {
      // 用户变了（在设置页或头像处切换）→ 自动刷新
      setSecUid(activeUid)
      doLoadVideos(true, activeUid)
      return
    }
    // 同一用户：有缓存就不动 —— 切标签页 / 进详情返回都不重拉。
    // ⚠️ 例外：Cookie 变过（刚去设置页「获取 Cookie」登录过）必须重拉 ——
    // 登录前接口只给公开作品，登录后才多出未公开的那些（实测一次 4 条 → 8 条）。
    if (worksCache.uid === activeUid && worksCache.videos.length > 0 && cookieSignature() === worksCache.cookieSig) return
    doLoadVideos(true, activeUid)
  }, [isActive])

  // Home Tab 是常驻实例（切走/切回不会重建，改代码也不会热更新 → 长按 Home 图标 Reload）。
  // 这里只做两件真实有价值的事：
  //   1) 从别的 Tab 切回来时，如果 Cookie 变了（刚去设置页登录/刷新过）→ 自动重拉，不用再手动刷新；
  //   2) 已经在首页又点一次 Home → 只在列表有缺口（videos < totalCount）时补拉，完整时不动。
  useEffect(() => {
    if (!inHomeTab) return
    let lastCookie = Storage.get<string>(KEY_COOKIE) || ""
    let off: (() => void) | null = null
    try {
      off = Script.onHomeTabEvent((event) => {
        if (event === "selected") {
          const cur = Storage.get<string>(KEY_COOKIE) || ""
          if (cur !== lastCookie) { lastCookie = cur; doLoadVideos(true) }
        } else if (event === "reselected") {
          // 再点一次 Home：只在「还有下一页」时续拉一页（便宜）；
          // 不能因为有未公开作品就整轮 reset（aweme_count 含私密作品，永远大于可拉取数）
          if (worksCache.hasMore) doLoadVideos(false)
        }
      })
    } catch { off = null }
    return () => { try { off?.() } catch { } }
  }, [])

  function handleSwitchUser(uid: string) {
    setSecUid(uid)
    doLoadVideos(true, uid)
  }

  // 网格内容 memo：loading / error / 用户信息等状态变化时，不重建几百张卡片的虚拟树。
  // 并且用 LazyVGrid（原先是 VStack + 手写分行，会把成百条卡片一次性全部构建）。
  const gridContent = useMemo(() => (
    <LazyVGrid columns={[
      { size: gridCardWidth, spacing: 14 },
      { size: gridCardWidth, spacing: 14 },
      { size: gridCardWidth, spacing: 14 },
    ]} spacing={16}>
      {videos.map((v, i) => (
        <VideoGridCard key={v.aweme_id} video={v} cardWidth={gridCardWidth} onOpen={() => openVideo(v, i)} />
      ))}
    </LazyVGrid>
  ), [videos, gridCardWidth])

  // ⚠️ 2026-10-17 真机实测：接口返回的条目数会少于 aweme_count（实测 4 vs 7）。
  // 差的那些是未公开作品（仅自己可见/朋友可见），服务端只对真实登录会话放出。
  // 所以「已加载全部作品」不能硬编码，必须拿总数对比。
  const listComplete = lastListSource === "signer" && !lastPartialError && (totalCount === 0 || videos.length >= totalCount)
  const listShort = lastListSource === "signer" && !listComplete && (totalCount > videos.length || !!lastPartialError)

  return (
    <NavigationStack>
      <List
        navigationTitle={userInfo.nickname || "抖音作品"}
        toolbar={{
          topBarLeading: dismissApp ? <Button title="关闭" action={() => dismissApp?.()} /> : undefined,
          topBarTrailing: (
            <HStack spacing={10}>
              {inHomeTab ? (
                <Button action={() => { Navigation.present(<HistoryView isActive={true} />) }}>
                  <Image systemName="clock" font="title3" />
                </Button>
              ) : null}
              {/* 刷新：图标按钮（与左右两个入口同款） */}
              <Button action={() => doLoadVideos(true)} disabled={loading}>
                <Image systemName="arrow.clockwise" font="title3" />
              </Button>
              {inHomeTab ? (
                <Button action={() => { Navigation.present(<SettingsView isActive={true} onCookieChanged={() => { doLoadVideos(true) }} />) }}>
                  <Image systemName="gear" font="title3" />
                </Button>
              ) : null}
              {userInfo.avatar ? (
                <Image
                  imageUrl={userInfo.avatar}
                  resizable scaleToFill
                  frame={{ width: 28, height: 28 }}
                  clipShape={{ type: "rect", cornerRadius: 14 }}
                  onTapGesture={() => {
                    Navigation.present(<SwitchUserView onSwitch={handleSwitchUser} currentUid={secUid} />)
                  }}
                />
              ) : (
                <Image
                  systemName="person.circle"
                  font="title2"
                  foregroundStyle="systemBlue"
                  onTapGesture={() => {
                    Navigation.present(<SwitchUserView onSwitch={handleSwitchUser} currentUid={secUid} />)
                  }}
                />
              )}
            </HStack>
          ),
        }}
      >
        {error ? (
          <Section>
            <VStack padding={{ vertical: 8, horizontal: 4 }} spacing={8} frame={{ maxWidth: "infinity" }}>
              <HStack spacing={6}>
                <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemRed" font="subheadline" />
                <Text font="subheadline" foregroundStyle="systemRed">{error}</Text>
              </HStack>
              {error.includes("Cookie") || error.includes("__ac_signature") ? (
                <VStack padding={12} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 10 }} spacing={8} alignment="leading">
                  <Text font="caption" bold>💡 建议</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">登录抖音后会自动获取 Cookie，作品列表才能完整（含仅自己可见的作品）。</Text>
                  <Button
                    title="获取 Cookie"
                    systemImage="person.crop.circle.badge.checkmark"
                    buttonStyle="borderedProminent"
                    action={() => { Navigation.present(<DouyinLoginView onDone={() => { doLoadVideos(true) }} />) }}
                  />
                </VStack>
              ) : null}
            </VStack>
          </Section>
        ) : null}

        {loading ? (
          <Section>
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={12}>
              <ProgressView />
              <Text font="callout" foregroundStyle="secondaryLabel">加载中...</Text>
            </VStack>
          </Section>
        ) : videos.length === 0 ? (
          <Section>
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={8}>
              <Image systemName="video.slash" font="title" foregroundStyle="tertiaryLabel" />
              <Text font="callout" foregroundStyle="secondaryLabel" padding={{ top: 4 }}>暂无作品</Text>
            </VStack>
          </Section>
        ) : (
          <Section>
            <VStack padding={{ horizontal: 12 }} spacing={16}>
              {gridContent}
              {hasMore ? (
                <VStack padding={{ vertical: 16 }} frame={{ maxWidth: "infinity" }} alignment="center">
                  {loadingMore ? (
                    <HStack spacing={8}><ProgressView /><Text font="caption" foregroundStyle="secondaryLabel">加载更多...</Text></HStack>
                  ) : (
                    <Button action={() => doLoadVideos(false)}>
                      <HStack padding={{ horizontal: 20, vertical: 10 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 8 }} spacing={6}>
                        <Image systemName="arrow.down.circle" font="caption" />
                        <Text font="subheadline">加载更多</Text>
                      </HStack>
                    </Button>
                  )}
                </VStack>
              ) : videos.length > 0 ? (
                listComplete ? (
                  <VStack padding={{ vertical: 16 }} frame={{ maxWidth: "infinity" }} alignment="center">
                    <Text font="caption" foregroundStyle="tertiaryLabel">已加载全部作品</Text>
                  </VStack>
                ) : listShort ? (
                  <VStack padding={14} spacing={10} frame={{ maxWidth: "infinity" }} alignment="leading">
                    <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
                      <Image systemName={lastPartialError ? "exclamationmark.triangle.fill" : "eye.slash"} font="caption" foregroundStyle={lastPartialError ? "systemRed" : "systemOrange"} />
                      <Text font="subheadline" bold frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        {lastPartialError ? `已加载 ${videos.length} 条，分页请求失败` : `已显示 ${videos.length} / 共 ${totalCount} 条`}
                      </Text>
                    </HStack>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      {lastPartialError
                        ? `其中一页没拉到（${lastPartialError}），点「重试」重新加载。`
                        : `还有 ${totalCount - videos.length} 条属于「仅自己可见 / 朋友可见」，服务端只对真实登录会话放出——当前登录已失效。`}
                    </Text>
                    <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Button
                        title="重新登录"
                        systemImage="person.crop.circle.badge.checkmark"
                        buttonStyle="borderedProminent"
                        action={() => { Navigation.present(<DouyinLoginView onDone={() => { doLoadVideos(true) }} />) }}
                      />
                      <Button
                        title="重试"
                        systemImage="arrow.clockwise"
                        buttonStyle="bordered"
                        action={() => { doLoadVideos(true) }}
                      />
                    </HStack>
                  </VStack>
                ) : (
                  <VStack padding={{ vertical: 14 }} spacing={10} frame={{ maxWidth: "infinity" }} alignment="center">
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    仅显示最近 {videos.length} 条
                  </Text>
                  <Text font="caption2" foregroundStyle="tertiaryLabel" lineLimit={2}>
                    抖音目前对匿名读取只放出第一页（接口一律返空，带签名也一样）；登录后即可拿完整列表
                  </Text>
                  <HStack spacing={10}>
                    <Button action={() => { doLoadVideos(true) }}>
                      <HStack padding={{ horizontal: 14, vertical: 8 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 8 }} spacing={6}>
                        <Image systemName="arrow.clockwise" font="caption" />
                        <Text font="subheadline">重试</Text>
                      </HStack>
                    </Button>
                    <Button action={() => { try { Safari.openURL(`https://www.douyin.com/user/${secUid}`) } catch {} }}>
                      <HStack padding={{ horizontal: 14, vertical: 8 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 8 }} spacing={6}>
                        <Image systemName="safari" font="caption" />
                        <Text font="subheadline">看全部</Text>
                      </HStack>
                    </Button>
                  </HStack>
                </VStack>
                )
              ) : null}
            </VStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

function HistoryItemCard({ item, idx, history, setHistory, cardWidth }: { item: HistoryItem; idx: number; history: HistoryItem[]; setHistory: (h: HistoryItem[]) => void; cardWidth: number }) {
  const coverWidth = cardWidth - 8
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 日期格式化只算一次（原先每次重渲染都 new Date + 国际化格式化）
  const viewedDate = useMemo(() => new Date(item.viewed_at).toLocaleDateString("zh-CN"), [item.viewed_at])
  const onPlay = () => openVideo(item, idx)
  const onDelete = () => { const u = history.filter((h) => h.aweme_id !== item.aweme_id); saveHistory(u); setHistory(u); setConfirmDelete(false) }
  return (
    <VStack spacing={5} padding={{ horizontal: 4, vertical: 3 }} frame={{ width: cardWidth, height: HISTORY_CARD_HEIGHT, alignment: "top" }} background="systemBackground" onLongPressGesture={{ minDuration: 600, perform: () => setConfirmDelete(true) }} confirmationDialog={{
      title: "删除这条历史？",
      isPresented: confirmDelete,
      onChanged: setConfirmDelete,
      message: <Text>删除后不会影响作品本身。</Text>,
      actions: <VStack>
        <Button title="删除" role="destructive" action={onDelete} />
        <Button title="取消" role="cancel" action={() => setConfirmDelete(false)} />
      </VStack>,
    }}>
      <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} background="systemGray5" clipShape={{ type: "rect", cornerRadius: 8 }} clipped overlay={{ alignment: "center", content: (
        <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }}>
          <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} background="black" opacity={0.001} onTapGesture={onPlay} />

        </VStack>
      )}}>
        {item.cover ? (
          <Image imageUrl={item.cover} resizable scaleToFill frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} clipped allowsHitTesting={false} />
        ) : (
          <VStack frame={{ width: coverWidth, height: GRID_COVER_HEIGHT }} alignment="center" allowsHitTesting={false}><Image systemName="play.rectangle" font="largeTitle" foregroundStyle="tertiaryLabel" /></VStack>
        )}
      </VStack>
      <Text font="caption2" lineLimit={2} frame={{ width: coverWidth, height: GRID_TITLE_HEIGHT, alignment: "topLeading" }} padding={{ horizontal: 2 }}>{item.desc}</Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel" padding={{ horizontal: 2 }}>{viewedDate}</Text>
    </VStack>
  )
}

// ─── 历史 ───
export function HistoryView({ dismissApp, isActive }: { dismissApp?: () => void; isActive: boolean }) {
  const gridCardWidth = getGridCardWidth()
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory())
  useEffect(() => {
    if (!isActive) return
    const h = loadHistory()
    setHistory(h)
  }, [isActive])

  // 网格内容 memo：避免无关状态变化重建整页卡片
  const gridContent = useMemo(() => (
    <LazyVGrid columns={[
      { size: gridCardWidth, spacing: 14 },
      { size: gridCardWidth, spacing: 14 },
      { size: gridCardWidth, spacing: 14 },
    ]} spacing={16}>
      {history.map((item, idx) => (
        <HistoryItemCard key={item.aweme_id} item={item} idx={idx} history={history} setHistory={setHistory} cardWidth={gridCardWidth} />
      ))}
    </LazyVGrid>
  ), [history, gridCardWidth])

  return (
    <NavigationStack>
      <List
        navigationTitle="观看历史"
        toolbar={{
          topBarLeading: dismissApp ? <Button title="关闭" action={() => dismissApp?.()} /> : undefined,
          topBarTrailing: history.length > 0 ? (
            <Button title="清空" action={() => { saveHistory([]); setHistory([]) }} />
          ) : undefined,
        }}
      >
        {history.length === 0 ? (
          <Section>
            <VStack frame={{ maxWidth: "infinity", height: 300 }} alignment="center" spacing={12}>
              <Image systemName="clock.badge.questionmark" font="largeTitle" foregroundStyle="tertiaryLabel" />
              <Text font="title3" bold foregroundStyle="secondaryLabel">暂无观看历史</Text>
              <Text font="callout" foregroundStyle="tertiaryLabel">在主页点击任意作品后自动记录</Text>
            </VStack>
          </Section>
        ) : (
          <Section>
            <VStack padding={{ horizontal: 12 }}>
              {gridContent}
            </VStack>
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ─── 设置 ───
export function SettingsView({ isActive, onCookieChanged }: { isActive: boolean; onCookieChanged?: () => void }) {
  const [inputValue, setInputValue] = useState("")
  const [cookieValue, setCookieValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: string; text: string }>({ type: "", text: "" })
  const [cookieStatus, setCookieStatus] = useState<{ checking: boolean; valid: boolean; detail: string }>({ checking: true, valid: false, detail: "检查中..." })
  const [savingCookie, setSavingCookie] = useState(false)
  // 首次渲染直接读取作品页已写入的当前用户，避免等 effect 后顶部仍是空白。
  const [savedInfo, setSavedInfo] = useState<SavedUser | null>(() => loadCurrentSavedUser())
  const [savedUsers, setSavedUsers] = useState<SavedUser[]>(() => loadSavedUsers())
  const [currentUid, setCurrentUid] = useState(() => loadSecUid())

  function refreshSavedUsers() {
    const users = loadSavedUsers()
    setSavedUsers(users)
    const uid = loadSecUid()
    setCurrentUid(uid)
    if (uid) {
      const users = loadSavedUsers(); const found = users.find((u) => u.id === uid)
      if (found) {
        setSavedInfo(found)
        // 缺资料时异步获取
        if (!found.totalFavorited || !found.shortId || !found.signature || !found.ipLocation) {
          fetchUserProfile(uid).then((profile) => {
            if (profile) {
              const all = loadSavedUsers().map((u) => u.id === uid ? {
                ...u,
                ...(profile.nickname ? { nickname: profile.nickname } : {}),
                ...(profile.avatar ? { avatar: profile.avatar } : {}),
                ...(profile.shortId ? { shortId: profile.shortId } : {}),
                ...(profile.totalFavorited ? { totalFavorited: profile.totalFavorited } : {}),
                ...(profile.followingCount ? { followingCount: profile.followingCount } : {}),
                ...(profile.followerCount ? { followerCount: profile.followerCount } : {}),
                ...(profile.signature ? { signature: profile.signature } : {}),
                ...(profile.ipLocation ? { ipLocation: profile.ipLocation } : {}),
                ...(profile.gender ? { gender: profile.gender } : {}),
                id: u.id, savedAt: u.savedAt,
              } : u)
              Storage.set(KEY_SAVED_USERS, JSON.stringify(all))
          const newUsers = loadSavedUsers()
              setSavedUsers(newUsers)
              const updated = newUsers.find((u) => u.id === uid)
              if (updated && loadSecUid() === uid) setSavedInfo(updated)
            }
          }).catch(() => {})
        }
      }
      else {
        // 兼容只有当前 uid、尚未写入用户列表的旧数据：立即显示占位并主动补齐资料。
        const placeholder: SavedUser = { id: uid, nickname: "", avatar: "", savedAt: Date.now() }
        setSavedInfo(placeholder)
        fetchUserProfile(uid).then((profile) => {
          if (!profile || loadSecUid() !== uid) return
          const user: SavedUser = {
            ...placeholder,
            ...profile,
            id: uid,
            savedAt: placeholder.savedAt,
            nickname: profile.nickname || "",
            avatar: profile.avatar || "",
          }
          saveUser(user)
          const newUsers = loadSavedUsers()
          setSavedUsers(newUsers)
          if (loadSecUid() === uid) setSavedInfo(newUsers.find((u) => u.id === uid) || user)
        }).catch(() => {})
      }
    } else { setSavedInfo(null) }
  }

  useEffect(() => {
    if (isActive) refreshSavedUsers()
  }, [isActive])

  // 检查 Cookie 状态
  useEffect(() => {
    const checkedCookie = Storage.get<string>(KEY_COOKIE) || ""
    ;(async () => {
      const result = await validateCookieString(checkedCookie)
      if ((Storage.get<string>(KEY_COOKIE) || "") === checkedCookie) {
        setCookieStatus({ checking: false, valid: result.valid, detail: result.detail })
      }
    })()
  }, [])

  async function handleCookieSave() {
    const candidate = cookieValue.trim()
    if (!candidate) {
      setCookieStatus({ checking: false, valid: false, detail: "请输入 Cookie" })
      return
    }
    setSavingCookie(true)
    setCookieStatus({ checking: true, valid: false, detail: "正在校验..." })
    const result = await validateCookieString(candidate)
    if (result.valid) {
      Storage.set(KEY_COOKIE, candidate)
      clearUifid()
      setCookieValue("")
      onCookieChanged?.()
    }
    setCookieStatus({ checking: false, valid: result.valid, detail: result.detail })
    setSavingCookie(false)
  }

  async function handleSave() {
    const t = inputValue.trim()
    if (!t) { setStatus({ type: "error", text: "请输入抖音号" }); return }
    setSaving(true); setStatus({ type: "", text: "" })
    try {
      const r = await resolveSecUid(t)
      if (r.error) { setStatus({ type: "error", text: r.error }); setSaving(false); return }
      saveSecUid(r.secUid)
      let nn = r.nickname || ""; let av = r.avatar || ""
      let fullUser: SavedUser = {
        id: r.secUid, nickname: nn, avatar: av, savedAt: Date.now(),
        shortId: r.shortId || "", totalFavorited: r.totalFavorited || 0,
        followingCount: r.followingCount || 0, followerCount: r.followerCount || 0,
        signature: r.signature || "", ipLocation: r.ipLocation || "", gender: r.gender ?? 0,
      }
      if (!nn) {
        try { const posts = await fetchUserPosts(r.secUid, 0); if (posts.videos.length > 0) { const p = posts.videos[0]; nn = p.author_nickname; av = p.author_avatar; fullUser.nickname = nn; fullUser.avatar = av } } catch { /* ignore */ }
      }
      // 异步补充资料：不阻塞保存
      fetchUserProfile(r.secUid).then((profile) => {
        if (profile) {
          const all = loadSavedUsers().map((u) => u.id === r.secUid ? {
            ...u,
            ...(profile.nickname ? { nickname: profile.nickname } : {}),
            ...(profile.avatar ? { avatar: profile.avatar } : {}),
            ...(profile.shortId ? { shortId: profile.shortId } : {}),
            ...(profile.totalFavorited ? { totalFavorited: profile.totalFavorited } : {}),
            ...(profile.followingCount ? { followingCount: profile.followingCount } : {}),
            ...(profile.followerCount ? { followerCount: profile.followerCount } : {}),
            ...(profile.signature ? { signature: profile.signature } : {}),
            ...(profile.ipLocation ? { ipLocation: profile.ipLocation } : {}),
            ...(profile.gender ? { gender: profile.gender } : {}),
            id: u.id, savedAt: u.savedAt,
          } : u)
          Storage.set(KEY_SAVED_USERS, JSON.stringify(all))
          setSavedUsers(loadSavedUsers())
          const updated = loadSavedUsers().find((x) => x.id === r.secUid)
          if (updated && loadSecUid() === r.secUid) setSavedInfo(updated)
        }
      }).catch(() => {})
      saveUser(fullUser)
      setSavedInfo(fullUser); setInputValue("")
      refreshSavedUsers()
    } catch (e) { setStatus({ type: "error", text: (e as Error).message }) }
    setSaving(false)
  }

  return (
    <NavigationStack>
      <List navigationTitle="设置">
        <Section>
          <VStack padding={16} spacing={12} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <Text font="headline" bold>当前用户</Text>
              <Spacer />
              {savedInfo ? (
                <Image systemName="arrow.clockwise" font="headline" foregroundStyle="systemBlue" onTapGesture={() => {
                  const uid = loadSecUid()
                  if (uid) {
                    fetchUserProfile(uid).then((profile) => {
                      if (profile) {
                        const all = loadSavedUsers().map((u) => u.id === uid ? {
                          ...u,
                          ...(profile.nickname ? { nickname: profile.nickname } : {}),
                          ...(profile.avatar ? { avatar: profile.avatar } : {}),
                          ...(profile.shortId ? { shortId: profile.shortId } : {}),
                          ...(profile.totalFavorited ? { totalFavorited: profile.totalFavorited } : {}),
                          ...(profile.followingCount ? { followingCount: profile.followingCount } : {}),
                          ...(profile.followerCount ? { followerCount: profile.followerCount } : {}),
                          ...(profile.signature ? { signature: profile.signature } : {}),
                          ...(profile.ipLocation ? { ipLocation: profile.ipLocation } : {}),
                          ...(profile.gender ? { gender: profile.gender } : {}),
                          id: u.id, savedAt: u.savedAt,
                        } : u)
                        Storage.set(KEY_SAVED_USERS, JSON.stringify(all))
                        const newUsers = loadSavedUsers()
                        setSavedUsers(newUsers)
                        const updated = newUsers.find((x) => x.id === uid)
                        if (updated) setSavedInfo(updated)
                      }
                    }).catch(() => {})
                  }
                }} />
              ) : null}
            </HStack>
            {savedInfo ? (
              <VStack spacing={12} frame={{ maxWidth: "infinity" }}>
                <HStack spacing={12}>
                  {savedInfo.avatar ? <Image imageUrl={savedInfo.avatar} resizable scaleToFill frame={{ width: 56, height: 56 }} clipShape={{ type: "rect", cornerRadius: 28 }} /> : <VStack frame={{ width: 56, height: 56 }} background="systemGray4" clipShape={{ type: "rect", cornerRadius: 28 }} alignment="center"><Image systemName="person.fill" font="title2" foregroundStyle="tertiaryLabel" /></VStack>}
                  <VStack spacing={2} alignment="leading">
                    <Text font="title3" bold>{savedInfo.nickname || "抖音用户"}</Text>
                    {savedInfo.shortId ? <Text font="subheadline" foregroundStyle="secondaryLabel">抖音号: {savedInfo.shortId}</Text> : null}
                  </VStack>
                </HStack>
                {(savedInfo.totalFavorited || savedInfo.followingCount || savedInfo.followerCount) ? (
                  <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
                    <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={2}>
                      <Text font="headline" bold>{formatCount(savedInfo.totalFavorited || 0)}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">获赞</Text>
                    </VStack>
                    <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={2}>
                      <Text font="headline" bold>{formatCount(savedInfo.followingCount || 0)}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">关注</Text>
                    </VStack>
                    <VStack frame={{ maxWidth: "infinity" }} alignment="center" spacing={2}>
                      <Text font="headline" bold>{formatCount(savedInfo.followerCount || 0)}</Text>
                      <Text font="caption" foregroundStyle="secondaryLabel">粉丝</Text>
                    </VStack>
                  </HStack>
                ) : null}
                {savedInfo.signature ? <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={3}>{savedInfo.signature}</Text> : null}
                {(savedInfo.ipLocation || savedInfo.gender) ? (
                  <HStack spacing={16}>
                    {savedInfo.ipLocation ? <HStack spacing={4}><Image systemName="location.fill" font="caption" foregroundStyle="tertiaryLabel" /><Text font="caption" foregroundStyle="tertiaryLabel">{savedInfo.ipLocation}</Text></HStack> : null}
                    {savedInfo.gender === 1 ? <Text font="caption" foregroundStyle="tertiaryLabel">♂ 男</Text> : savedInfo.gender === 2 ? <Text font="caption" foregroundStyle="tertiaryLabel">♀ 女</Text> : null}
                  </HStack>
                ) : null}
              </VStack>
            ) : (
              <Text foregroundStyle="secondaryLabel">尚未设置</Text>
            )}
          </VStack>
        </Section>

        <Section title="添加/修改抖音号">
          <TextField
            title="抖音号"
            prompt="粘贴抖音号 / 链接 / sec_uid"
            value={inputValue}
            onChanged={(val: string) => setInputValue(val)}
          />
          <Button
            title={saving ? "解析中..." : "保存"}
            action={handleSave}
            disabled={saving || !inputValue.trim()}
          />
          {status.text ? (
            <Text font="caption" foregroundStyle={status.type === "error" ? "systemRed" : "systemGreen"}>
              {status.text}
            </Text>
          ) : null}
        </Section>

        <Section title="Cookie 配置">
          <VStack padding={12} spacing={12} frame={{ maxWidth: "infinity" }}>
            <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
              {cookieStatus.checking ? (
                <ProgressView foregroundStyle="systemBlue" />
              ) : (
                <Image
                  systemName={cookieStatus.valid ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"}
                  foregroundStyle={cookieStatus.valid ? "systemGreen" : "systemOrange"}
                  font="body"
                />
              )}
              <VStack spacing={0} alignment="leading">
                <Text font="body" bold>抖音登录</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">{cookieStatus.checking ? "正在校验..." : cookieStatus.detail}</Text>
              </VStack>
              <Spacer />
              <Button
                title="获取 Cookie"
                buttonStyle="borderless"
                disabled={cookieStatus.checking}
                action={() => {
                  Navigation.present(<DouyinLoginView onDone={(ck: string) => {
                    validateCookieString(ck).then((r) => setCookieStatus({ checking: false, valid: r.valid, detail: r.detail }))
                    onCookieChanged?.()
                  }} />)
                }}
              />
            </HStack>

            {!cookieStatus.valid ? (
              <VStack spacing={8} frame={{ maxWidth: "infinity" }}>
                <TextField
                  title="Cookie"
                  prompt="粘贴抖音 Cookie"
                  value={cookieValue}
                  onChanged={(val: string) => setCookieValue(val)}
                />
                <HStack frame={{ maxWidth: "infinity" }}>
                  <Spacer />
                  <Button title={savingCookie ? "校验中..." : "校验并保存"} action={handleCookieSave} disabled={savingCookie || !cookieValue.trim()} />
                </HStack>
              </VStack>
            ) : null}
          </VStack>
        </Section>

        <Section title={`已保存用户（${savedUsers.length}）`}>
          {savedUsers.length === 0 ? (
            <Text font="caption" foregroundStyle="secondaryLabel">暂无已保存的用户</Text>
          ) : (
            savedUsers.map((u) => (
              <HStack
                key={u.id}
                spacing={12}
                padding={{ vertical: 8, leading: 0, trailing: 0 }}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button tint="systemRed" action={() => {
                      const users = loadSavedUsers().filter((x) => x.id !== u.id)
                      Storage.set(KEY_SAVED_USERS, JSON.stringify(users))
                      if (u.id === loadSecUid()) {
                        if (users.length > 0) saveSecUid(users[0].id)
                        else Storage.remove(KEY_SEC_UID)
                      }
                      refreshSavedUsers()
                    }}>
                      <VStack spacing={2}>
                        <Image systemName="trash" font="body" />
                        <Text font="caption" foregroundStyle="tertiaryLabel">删除</Text>
                      </VStack>
                    </Button>,
                  ],
                }}
              >
                <HStack spacing={12} frame={{ maxWidth: "infinity" }} onTapGesture={() => {
                  if (u.id !== currentUid) { saveSecUid(u.id); refreshSavedUsers() }
                }}>
                  {u.avatar ? <Image imageUrl={u.avatar} resizable scaleToFill frame={{ width: 36, height: 36 }} clipShape={{ type: "rect", cornerRadius: 18 }} /> : <VStack frame={{ width: 36, height: 36 }} background="systemGray4" clipShape={{ type: "rect", cornerRadius: 18 }} alignment="center"><Image systemName="person.fill" font="caption" foregroundStyle="tertiaryLabel" /></VStack>}
                  <VStack spacing={0} frame={{ maxWidth: "infinity" }} alignment="leading">
                    <Text font="subheadline" frame={{ maxWidth: "infinity", alignment: "leading" }}>{u.nickname || "未命名"}</Text>
                  </VStack>
                  {u.id === currentUid ? (
                    <Text font="caption" foregroundStyle="systemBlue">当前</Text>
                  ) : null}
                </HStack>
              </HStack>
            ))
          )}
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── 主入口 ───
// ─── 版本更新说明（新版本首次打开时以底部 Sheet 展示） ───
const UPDATE_NOTES: { version: string; date: string; items: string[] }[] = [
  {
    version: "1.0.37",
    date: "2026-10-17",
    items: [
      "修复：切换账号后短暂显示上一个账号的作品和昵称",
      "修复：一次请求超时会让作品只剩 15 条，且 5 分钟内不恢复",
      "修复：滑到最后一页会突然只剩 15 条",
      "修复：分页失败被误报成「作品仅自己可见」",
      "修复：在首页再点一次 Home 会整轮重新加载",
      "修复：登录后首页不自动刷新",
      "修复：反复打开登录页会占用内存",
      "优化：首屏请求超时收紧，加载更快",
    ],
  },
  {
    version: "1.0.36",
    date: "2026-10-17",
    items: [
      "修复：置顶作品不显示",
      "新增：置顶作品卡片显示「置顶」角标",
    ],
  },
  {
    version: "1.0.35",
    date: "2026-10-17",
    items: [
      "修复：置顶作品被排到列表末尾",
      "修复：连续刷新会导致列表变少",
      "修复：列表偶发顺序颠倒（最旧在前）",
    ],
  },
  {
    version: "1.0.34",
    date: "2026-10-17",
    items: [
      "修复：登录后「运行脚本」入口仍显示登录前的旧列表",
      "优化：列表排序改为置顶优先",
    ],
  },
  {
    version: "1.0.33",
    date: "2026-10-17",
    items: [
      "新增：从设置页登录后切回首页，列表自动刷新",
      "优化：再点一次 Home 只在有下一页时补拉",
    ],
  },
  {
    version: "1.0.32",
    date: "2026-10-17",
    items: [
      "新增：设置页「获取 Cookie」，一键登录抖音并自动保存",
      "修复：登录态失效时仍显示「Cookie 有效」",
      "修复：作品显示不全（未公开作品拿不到）",
      "优化：作品页显示「已显示 4 / 共 7 条」并给出重新登录入口",
    ],
  },
  {
    version: "1.0.31",
    date: "2026-10-17",
    items: [
      "修复小号作品显示不全（如 8 条只显示 4 条）：首页条目 < 20 时自动续拉最多 2 页",
      "自动跨页按 aweme_id 去重，合并后重新按发布时间降序排",
    ],
  },
  {
    version: "1.0.30",
    date: "2026-10-17",
    items: [
      "修复：作品只显示最早的几条，刷新也拉不到最新",
      "优化：列表按发布时间展示",
    ],
  },
  {
    version: "1.0.29",
    date: "2026-10-14",
    items: [
      "修复：作品列表不完整、不能翻页",
      "新增：登录后可完整加载全部作品，下滑继续加载",
    ],
  },
  {
    version: "1.0.28",
    date: "2026-10-14",
    items: [
      "修正作品页底部文案：不再谎报「已加载全部作品」（现在只有第一页 15 条）",
      "底部改为：仅显示最近 N 条 + 原因说明 + 「重试」与「看全部」（跳浏览器）",
      "定位进度：用你仓库的签名器（X-Argus/X-Gorgon/X-Ladon/X-Khronos/X-SS-STUB 全带）实测作品接口仍返空 → 不是算法问题，是抖音对匿名读取的门禁",
    ],
  },
  {
    version: "1.0.27",
    date: "2026-10-14",
    items: [
      "作品页提速：分享页 WebView 改为跨页复用，不再每次重建（之前每次白等 2-3 秒）",
      "闲置 45 秒自动释放引用，不会常驻占内存",
      "网页端签名通道升级为现行算法（补 a_bogus，纯本地计算，新增 abogus.ts）",
      "签名通道若被拦（空响应/blocked）会自动标记 10 分钟不再尝试，避免每次白等",
      "实测：网页接口现在返空（抖音额外校验 msToken 等浏览器态）→ 主通道仍是分享页渲染",
      "分享页支持下滑尝试多取作品（能多拿就多拿）",
    ],
  },
  {
    version: "1.0.26",
    date: "2026-10-14",
    items: [
      "修复作品页打不开（HTTP 403）：平台改了网页端 Argus 签名算法，旧签名已失效",
      "新增免签名通道：用 WebView 渲染移动分享页，从页面里直接取作品列表（不再依赖 uifid/签名）",
      "播放地址不在分享页里 → 改成点开时用移动端 detail 接口补（那条通道免签且已验证可用）",
      "旧的网页签名通道保留为后备，并加了 9 秒硬超时（之前会卡住不返回）",
      "实测：签名通道下请求会被服务端拖住；移动端 post 接口目前一律返空列表（IP 级风控）",
    ],
  },
  {
    version: "1.0.25",
    date: "2026-10-12",
    items: [
      "顶栏顺序调整（首页 Tab）：历史 → 刷新 → 设置 → 头像",
      "「刷新」由文字按钮改为图标按钮（arrow.clockwise），与左右入口统一",
    ],
  },
  {
    version: "1.0.24",
    date: "2026-10-12",
    items: [
      "首页 Tab 直接显示作品页，不再套一层菜单",
      "历史 / 设置 移到作品页顶栏（首页环境才显示这两个入口，图标按钮）",
      "首页不再多包一层 NavigationStack（作品页自带，避免嵌套）",
    ],
  },
  {
    version: "1.0.23",
    date: "2026-10-12",
    items: [
      "新增 App 首页 Home Tab（home_screen_default_ui.tsx）：在设置里打开 Show Home Tab 后出现",
      "首页做成「导航入口页」：作品 / 历史 / 设置 三个入口，功能一样不少",
      "代码拆成 shared.tsx（无副作用，两边共用）+ index.tsx（纯入口）",
      "首页 Tab 里不再显示「关闭」按钮（那里不存在退出 App 的概念）",
    ],
  },
  {
    version: "1.0.22",
    date: "2026-10-12",
    items: [
      "更新弹窗重新设计（参考你自己的 115获取Cookie / FileStore）",
      "改为固定高度的底部小卡片（不再撑满整屏）+ 拖拽指示条",
      "标题/正文用原生字号与行距，按钮改成系统的 emphasized 样式",
      "首次使用与版本更新文案分开：「首次使用 · 开始使用」/「本次更新 · 知道了」",
    ],
  },
  {
    version: "1.0.21",
    date: "2026-10-12",
    items: [
      "下载提速：去掉两个「白跑的往返」",
      "① 不再单独发 HEAD 探大小 —— 直接复用选档探测时已经拿到的文件总大小",
      "② 探测取到的那 128KB 文件头直接当第一块，不再丢掉重下",
      "详情加 60 秒缓存：反复导出同一作品不再重新请求（更快、也更少触发风控）",
      "画质探测次数减少：ratio 只试目标值 + 1080 保底（服务端会自动下调）",
      "下载本身不变：仍是官方 CDN 直连 + 4MB 分块（失败自动重试 3 次）",
    ],
  },
  {
    version: "1.0.20",
    date: "2026-10-12",
    items: [
      "作品 / 历史卡片改为固定尺寸：标题长短（1 行 / 2 行）不再把卡片撑成不同高",
      "标题区固定高 + 左上对齐，所以每张卡的首行标题都在同一条线上",
      "标题仍最多显示 2 行，超出省略；网格现在行内、行间都整齐对齐",
    ],
  },
  {
    version: "1.0.19",
    date: "2026-10-12",
    items: [
      "播放页去掉关闭按钮（它是 sheet，下滑即可关闭）",
      "下载按钮移到右下角、AVKit 进度条上方（底部那一行是系统的全屏/PiP，所以往上让开）",
      "下载按钮改成 AVKit 同款样式：裸白色字形，不再用毛玻璃圆底（原来看起来格格不入）",
      "位置偏移集中在 PLAYER_DOWNLOAD_TRAILING/BOTTOM_INSET 两个常量，好微调",
    ],
  },
  {
    version: "1.0.18",
    date: "2026-10-12",
    items: [
      "播放页按钮排进 AVKit 同一条控件栏：下载在「音量」右边，关闭在「投屏」左边",
      "按钮全部改用原生做法：系统毛玻璃底 + 语义色 label（跟随系统深/浅色，不再手写颜色）",
      "按钮尺寸改为 iOS 标准 44×44；下载图标改用 arrow.down.circle",
      "图文页码徽标也改成毛玻璃 + 语义色，不再用黑底 58% 透明",
      "对齐偏移集中为 PLAYER_BAR_LEADING/TRAILING_INSET 三个常量，好微调",
    ],
  },
  {
    version: "1.0.17",
    date: "2026-10-12",
    items: [
      "播放页按钮位置调整：关闭 + 下载收成左上角一列",
      "原先把「下载」放在右上，正好压在 AVKit 自己的按钮（画中画/全屏）上，看着像一堆按钮叠着",
      "AVKit 控件集中在右上与底部，现在与我们的按钮完全错开",
    ],
  },
  {
    version: "1.0.16",
    date: "2026-10-12",
    items: [
      "播放页重做：控件只占顶部一条，不再用全屏浮层盖住播放器（原生控件栏现在能正常响应触摸）",
      "关闭按钮在任何状态都在（加载中、播放失败也能退）",
      "悬浮按钮改用系统毛玻璃（以前黑底半透压在视频上看不清）",
      "收起/退出时暂停播放：不会再后台一直响",
      "图文作品与视频作品的控件位置统一；图文下载仍在每页底部（带页码，导出不错图）",
    ],
  },
  {
    version: "1.0.15",
    date: "2026-10-12",
    items: [
      "流畅度全面优化（代码审查后逐项修）",
      "作品网格改为懒加载：以前会把成百张卡片一次性全部建出来，现在只建可见区域",
      "切标签页不再重建其他页面（页面级 memo + 回调稳定化）",
      "消除 render 期的磁盘/Storage 读取（切换用户面板、作品页缓存判断）",
      "历史页卡片日期不再每帧重新格式化",
    ],
  },
  {
    version: "1.0.14",
    date: "2026-10-12",
    items: [
      "作品页不再每次进入/返回就重新加载：切标签页、看完作品返回都保持原样",
      "只有两种情况会自动重载：切换用户（点头像或在设置页切换）",
      "需要更新时点右上角「刷新」按钮即可",
      "列表缓存到内存，首次进入（无缓存）仍会自动加载",
    ],
  },
  {
    version: "1.0.13",
    date: "2026-10-12",
    items: [
      "画质校准到 2K：上限设为 1440p，不再追 4K/8K（那是平台硬门禁，已在 1.0.12 里查清并记录）",
      "解除上一版的 1080p 下限：作品本身只有 720p 时就下 720p，不再拦截（这种情况很少，因为现在最低都 1080）",
      "优先级不变：能拿 1440 就给 1440，其次 1080",
    ],
  },
  {
    version: "1.0.12",
    date: "2026-10-12",
    items: [
      "画质优先级明确：有 2K(1440p) 就下 2K，其次 1080p",
      "新增画质下限（默认 1080p）：平台只给 720p 的作品不再静默下载，而是直接告知原因并取消（低于 1080 等于没进步）",
      "因低于下限取消时，不会回退到更低清地址",
    ],
  },
  {
    version: "1.0.11",
    date: "2026-10-12",
    items: [
      "观看也保证最高画质：作品最高档是自研编码时，播放改用 play 接口取同分辨率正码（不再只给 720p）",
      "拿不到最高档时诊断会写明原因（例：最高 1080p 档为抖音自研编码，Apple 设备无法使用）",
      "实测确认：2K/1440p 本身就是标准编码 hvc1，脚本会直接选它（1440×2560 / 2560×1440 已验证）",
    ],
  },
  {
    version: "1.0.10",
    date: "2026-10-12",
    items: [
      "画质恢复：最高档是抖音自研编码（bvc2）时不再只能降到 720p",
      "改用 play 接口的 ratio 参数取回同分辨率的【标准编码】版本（实测 1080×1920 H.264，可存相册可播放）",
      "bit_rate[] 里的自研编码档已彻底剔除，不再参与选档，也不再刷一堆「跳过」提示",
      "诊断信息只留一行画质结论（例：画质 1080×1920 avc1）",
    ],
  },
  {
    version: "1.0.9",
    date: "2026-10-12",
    items: [
      "修复：下载完成后「Photos 保存失败」—— 真因是选到了抖音自研编码档位（fourcc=bvc2），iOS 既不能解码也不能存相册",
      "现在下载前会读文件头的视频编码，自动跳过 bvc2 这类系统不支持的档位，改用能存能放的最高画质档（H.264/HEVC）",
      "观看路径也一并修好：只用标准编码档，避免自研编码造成黑屏/播放失败",
      "诊断信息会写明跳过了哪个档位及其编码（例：跳过 1080p：bvc2 是抖音自研编码，iOS 不能存相册/播放）",
    ],
  },
  {
    version: "1.0.8",
    date: "2026-10-12",
    items: [
      "修复：点下载偶发失败 —— 推荐流里混进了【直播间卡片】（aweme_type 101），它没有播放地址、详情必被平台过滤，点它必然失败",
      "这类条目现在直接从列表剔除（既放不了也下不了，留着只会误导）",
      "真遇到受限作品时提示更明确：「该作品已被平台限制（core_dep）」，不再是一句模糊的失败",
      "下载更稳：分块 512KB → 4MB，单块失败自动重试 3 次（不再一抖动就整包重下），并去掉大文件的双倍内存占用",
    ],
  },
  {
    version: "1.0.7",
    date: "2026-10-12",
    items: [
      "修复：竖屏作品仍被降到 576x1024 —— 改为按【短边】取最高画质档",
      "两个坑：① 按字段名选会选到低清兼容档；② 拿 height 比 1080 在竖屏下会把 540p 当上限",
      "观看与下载现在共用同一条选档逻辑，都取最高可用画质",
    ],
  },
  {
    version: "1.0.6",
    date: "2026-10-12",
    items: [
      "修复：下载画质被降到 576p —— 改为按清晰度选档，优先 1080p",
      "原因：移动端详情接口的 play_addr_h264 是 576p 兼容档，真正的 1080p 在 bit_rate[] 里",
      "现在会自动选 1920x1080 那一档；想要更高可改 PREFERRED_VIDEO_HEIGHT",
    ],
  },
  {
    version: "1.0.5",
    date: "2026-10-12",
    items: [
      "作品详情 / 去水印：优先走移动端接口，免 Cookie、免 uifid、免签名，直接拿无水印直链",
      "用户信息：优先走免签接口，shortId / 获赞 / IP 地区自动补全",
      "作品列表：新增移动端免签通道，被限流或返回空时自动回退原有网页端签名通道",
      "修正：移动端接口的 iid 必须用真实 install_id（用 device_id 顶替会返回空列表）",
    ],
  },
]

function UpdateNotesView({ notes, isFirstRun, onClose }: {
  notes: { version: string; date: string; items: string[] }
  isFirstRun: boolean
  onClose: () => void
}) {
  return (
    // 样式参考用户自己的「115获取Cookie」更新弹窗：
    //   固定高度（presentationDetents）+ 拖拽指示条 + 左对齐 + 行距 + 原生 emphasized 按钮
    <VStack
      alignment="leading"
      spacing={16}
      padding={22}
      presentationDetents={[380]}
      presentationDragIndicator="visible"
    >
      <VStack alignment="leading" spacing={4}>
        <Text font={20} fontWeight="bold">
          {isFirstRun ? "首次使用" : "本次更新"} · v{notes.version}
        </Text>
        <Text font={13} foregroundStyle="secondaryLabel">{notes.date}</Text>
      </VStack>
      {isFirstRun ? (
        <Text font={15} lineSpacing={4} foregroundStyle="secondaryLabel">
          查看作品、收藏与历史；解析无水印视频、图文与动图，保存到相册或分享给朋友。
        </Text>
      ) : null}
      <VStack alignment="leading" spacing={10}>
        {notes.items.map((t, i) => (
          <Text key={i} font={14} lineSpacing={4}>{"• " + t}</Text>
        ))}
      </VStack>
      <Button
        title={isFirstRun ? "开始使用" : "知道了"}
        systemImage="arrow.right.circle.fill"
        buttonStyle="borderedProminent"
        action={onClose}
      />
    </VStack>
  )
}

export function App() {
  const dismiss = Navigation.useDismiss()
  const [tabIndex, setTabIndex] = useState(0)
  // 新版本首次打开：展示本次更新内容
  const [updateNotes, setUpdateNotes] = useState<typeof UPDATE_NOTES[number] | null>(() => {
    try {
      if (Storage.get<string>(KEY_SEEN_VERSION) === SCRIPT_VERSION) return null
      return UPDATE_NOTES[0] || null
    } catch { return null }
  })
  // 从没看过弹窗（Storage 里没这个 key）→ 当作「首次使用」，文案与按钮不同
  const [isFirstRun] = useState(() => {
    try { return !Storage.contains(KEY_SEEN_VERSION) } catch { return false }
  })

  function closeUpdateNotes() {
    try { Storage.set(KEY_SEEN_VERSION, SCRIPT_VERSION) } catch {}
    setUpdateNotes(null)
  }

  // 页面元素做 memo：切 tab 时只重建 isActive 变了的那个页面，
  // 其余页面拿到的是同一个元素引用，SwiftUI 不会重建（避免切 tab 卡顿）。
  const dismissApp = useCallback(() => { dismiss() }, [dismiss])
  const handleTabIndexChanged = useCallback((index: number) => { setTabIndex(index) }, [])
  const homeActive = tabIndex === 0
  const historyActive = tabIndex === 1
  const settingsActive = tabIndex === 2
  const homePage = useMemo(() => <HomeView dismissApp={dismissApp} isActive={homeActive} />, [dismissApp, homeActive])
  const historyPage = useMemo(() => <HistoryView dismissApp={dismissApp} isActive={historyActive} />, [dismissApp, historyActive])
  const settingsPage = useMemo(() => <SettingsView isActive={settingsActive} />, [settingsActive])

  return (
    <TabView
      tabIndex={tabIndex}
      onTabIndexChanged={handleTabIndexChanged}
      sheet={updateNotes ? {
        isPresented: true,
        onChanged: (presented: boolean) => { if (!presented) closeUpdateNotes() },
        content: <UpdateNotesView notes={updateNotes} isFirstRun={isFirstRun} onClose={closeUpdateNotes} />,
      } : undefined}
    >
      <Tab title="作品" systemImage="rectangle.grid.2x2" value={0}>
        {homePage}
      </Tab>
      <Tab title="历史" systemImage="clock" value={1}>
        {historyPage}
      </Tab>
      <Tab title="设置" systemImage="gear" value={2}>
        {settingsPage}
      </Tab>
    </TabView>
  )
}

