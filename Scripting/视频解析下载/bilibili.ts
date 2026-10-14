/**
 * Bilibili 解析模块
 *
 * 2026-10 真机实测要点：
 *  · B 站高画质走 **DASH**：视频轨与音频轨是**分开的两个文件**（video.m4s / audio.m4s）。
 *    只下视频轨 → **成品没声音**，这就是「B站视频没声音」的根因。
 *  · 想要「单文件带声音」，要么用 progressive `durl`（`fnval=1`，画质通常上限 1080P），
 *    要么把 DASH 的视频轨 + 音频轨**在本地合轨**（见 index.tsx 的 mux 环节）。
 *  · 选轨要考虑**编码**：`av01`（AV1）iOS 不能解码、`hev1/hvc1` 可以、
 *    `avc1`（H.264）兼容性最好；音频优先普通 AAC（`mp4a.40.2`），FLAC/杜比（VIP）慎用。
 *  · playurl 需要 **WBI 签名**（`w_rid` + `wts`）。
 */

import { fetch } from "scripting"

export interface BilibiliTrack {
  id: number
  url: string
  backupUrls: string[]
  codecs: string
  bandwidth: number
  width?: number
  height?: number
}

export interface BilibiliParseResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  cover_url?: string
  link?: string
  error?: string
  debug?: string[]
  bvid?: string
  cid?: string
  /** 单文件（自带声音）的 progressive 地址 */
  video_url?: string | null
  /** progressive 画质 qn */
  progressiveQuality?: number
  /** DASH 视频轨（**无声音**，需要与音轨合轨） */
  dashVideoUrl?: string
  /** DASH 视频轨的镜像（PCDN 节点可能很慢，下载时要逐个试） */
  dashVideoBackups?: string[]
  dashVideoQuality?: number
  dashVideoCodecs?: string
  /** DASH 音频轨 */
  dashAudioUrl?: string
  dashAudioBackups?: string[]
  dashAudioCodecs?: string
  /** 是否建议走合轨（DASH 画质确实高于 progressive 时） */
  needsMux?: boolean
}

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const REFERER = "https://www.bilibili.com/"

/** B 站画质编号 → 文案（仅用于日志） */
const QN_LABEL: Record<number, string> = {
  6: "240P", 16: "360P", 32: "480P", 64: "720P", 74: "720P60", 80: "1080P",
  112: "1080P+", 116: "1080P60", 120: "4K", 125: "HDR", 126: "杜比视界", 127: "8K",
}

export function qnLabel(qn?: number): string {
  if (!qn) return "未知"
  return QN_LABEL[qn] || `${qn}`
}

// ─── WBI 签名 ──────────────────────────────────────────

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39,
  12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52,
]

let cachedMixinKey = ""

function md5hex(content: string): string {
  const data = Data.fromString(content)
  if (!data) return ""
  return Crypto.md5(data).toHexString()
}

async function ensureWbiKeys(debug: string[]): Promise<void> {
  if (cachedMixinKey) return
  try {
    const resp = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      headers: { "User-Agent": UA },
      timeout: 10,
    } as any)
    const data = await resp.json()
    const imgUrl: string = data?.data?.wbi_img?.img_url || ""
    const subUrl: string = data?.data?.wbi_img?.sub_url || ""
    const imgKey = imgUrl.split("/").pop()?.split(".")[0] || ""
    const subKey = subUrl.split("/").pop()?.split(".")[0] || ""
    if (!imgKey || !subKey) { debug.push("WBI：未取到 img_key / sub_key"); return }
    const orig = imgKey + subKey
    let mixin = ""
    for (let i = 0; i < 32; i++) mixin += orig[MIXIN_KEY_ENC_TAB[i]]
    cachedMixinKey = mixin
  } catch (error) {
    debug.push(`WBI 取键失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** WBI 签名：排序参数 + md5(query + mixinKey) */
export function wbiSign(params: Record<string, string>): Record<string, string> {
  const wts = Math.floor(Date.now() / 1000).toString()
  const filtered: Record<string, string> = { wts }
  for (const [k, v] of Object.entries(params)) filtered[k] = String(v).replace(/[!'()*]/g, "")
  const query = Object.keys(filtered).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(filtered[k])}`).join("&")
  filtered["w_rid"] = md5hex(query + cachedMixinKey)
  filtered["wts"] = wts
  return filtered
}

// ─── 选轨 ──────────────────────────────────────────────

/** 编码优先级：H.264 > HEVC > 其他（AV1 在 iOS 上不能解码，排最后） */
function codecRank(codecs: string): number {
  const c = String(codecs || "").toLowerCase()
  if (c.startsWith("avc")) return 3
  if (c.startsWith("hev") || c.startsWith("hvc")) return 2
  if (c.startsWith("av01")) return 0
  return 1
}

/** 音频优先普通 AAC（mp4a），FLAC / 杜比需要更强解码能力，排后面 */
function audioRank(codecs: string): number {
  const c = String(codecs || "").toLowerCase()
  if (c.startsWith("mp4a")) return 3
  if (c.includes("ec-3") || c.includes("ac-3")) return 1
  if (c.includes("flac")) return 0
  return 2
}

/** 视频轨：先按编码（H.264 优先），再按画质 id、带宽 */
export function pickBestVideoTrack(tracks: BilibiliTrack[]): BilibiliTrack | null {
  if (!tracks?.length) return null
  return [...tracks].sort((a, b) => {
    const byCodec = codecRank(b.codecs) - codecRank(a.codecs)
    if (byCodec !== 0) return byCodec
    if ((b.id || 0) !== (a.id || 0)) return (b.id || 0) - (a.id || 0)
    return (b.bandwidth || 0) - (a.bandwidth || 0)
  })[0]
}

/** 音频轨：先按编码（AAC 优先），再按带宽 */
export function pickBestAudioTrack(tracks: BilibiliTrack[]): BilibiliTrack | null {
  if (!tracks?.length) return null
  return [...tracks].sort((a, b) => {
    const byCodec = audioRank(b.codecs) - audioRank(a.codecs)
    if (byCodec !== 0) return byCodec
    return (b.bandwidth || 0) - (a.bandwidth || 0)
  })[0]
}

// ─── 解析 ──────────────────────────────────────────────

function extractBvid(url: string): string | null {
  return url.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] || url.match(/(BV[0-9A-Za-z]{10,})/)?.[1] || null
}

/** 展开 b23.tv 短链 */
export async function expandB23(url: string): Promise<{ bvid: string | null; targetUrl: string; note: string }> {
  const direct = extractBvid(url)
  if (direct) return { bvid: direct, targetUrl: url, note: `链接已含 BV 号：${direct}` }
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA }, timeout: 12 } as any)
    const html = await resp.text()
    const finalUrl = String((resp as any).url || "")
    const bvid = extractBvid(finalUrl) || extractBvid(html)
    return bvid
      ? { bvid, targetUrl: finalUrl || url, note: `短链展开成功：${bvid}` }
      : { bvid: null, targetUrl: finalUrl || url, note: "短链已访问但没找到 BV 号" }
  } catch (error) {
    return { bvid: null, targetUrl: url, note: `短链展开失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 解析 B 站视频：同时问 DASH（高画质，音视频分离）与 progressive（单文件带声音），
 * 由调用方决定用哪一个 —— 只有在 DASH 画质确实更高时才值得本地合轨。
 */
export async function parseBilibiliVideo(url: string, cookie: string = ""): Promise<BilibiliParseResult> {
  const debug: string[] = []
  const result: BilibiliParseResult = { success: false, platform: "bilibili", link: url, debug }

  const expanded = await expandB23(url)
  debug.push(expanded.note)
  if (!expanded.bvid) { result.error = "无法提取 BV 号"; return result }
  const bvid = expanded.bvid
  result.bvid = bvid

  const authHeaders: Record<string, string> = { "User-Agent": UA, "Referer": REFERER }
  if (cookie) authHeaders["Cookie"] = cookie

  // ① 视频信息
  let cid = ""
  let aid = ""
  try {
    const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers: authHeaders, timeout: 12 } as any)
    const data = await resp.json()
    if (data?.code !== 0) {
      result.error = `获取视频信息失败：code=${data?.code} ${data?.message || ""}`
      return result
    }
    result.title = data.data?.title || ""
    result.author = data.data?.owner?.name || ""
    result.cover_url = data.data?.pic || ""
    cid = String(data.data?.cid || "")
    aid = String(data.data?.aid || "")
    debug.push(`视频信息：${result.title}（${data.data?.owner?.name || ""}）`)
  } catch (error) {
    result.error = `获取视频信息异常：${error instanceof Error ? error.message : String(error)}`
    return result
  }
  if (!cid || !aid) { result.error = "缺少 cid / aid"; return result }
  result.cid = cid

  await ensureWbiKeys(debug)

  const playurl = async (fnval: string, qn: string): Promise<any | null> => {
    try {
      const signed = wbiSign({ avid: aid, cid, qn, fnval, fnver: "0", fourk: "1" })
      const query = Object.entries(signed).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
      const resp = await fetch(`https://api.bilibili.com/x/player/playurl?${query}`, { headers: authHeaders, timeout: 15 } as any)
      const data = await resp.json()
      if (data?.code !== 0) {
        debug.push(`playurl(fnval=${fnval}) 失败：code=${data?.code} ${data?.message || ""}`)
        return null
      }
      return data.data
    } catch (error) {
      debug.push(`playurl(fnval=${fnval}) 异常：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  // ② DASH（高画质，音视频分离）
  const dashData = await playurl("4048", "127")
  let dashVideo: BilibiliTrack | null = null
  let dashAudio: BilibiliTrack | null = null
  if (dashData?.dash) {
    const toTrack = (t: any): BilibiliTrack => ({
      id: t?.id || 0,
      url: t?.baseUrl || t?.base_url || t?.backupUrl?.[0] || t?.backup_url?.[0] || "",
      backupUrls: t?.backupUrl || t?.backup_url || [],
      codecs: String(t?.codecs || ""),
      bandwidth: t?.bandwidth || 0,
      width: t?.width,
      height: t?.height,
    })
    const videos: BilibiliTrack[] = (dashData.dash.video || []).map(toTrack)
    const audios: BilibiliTrack[] = (dashData.dash.audio || []).map(toTrack)
    dashVideo = pickBestVideoTrack(videos)
    dashAudio = pickBestAudioTrack(audios)
    debug.push(`DASH：视频 ${videos.length} 档 / 音频 ${audios.length} 档`)
    if (dashVideo) debug.push(`DASH 视频选中：${qnLabel(dashVideo.id)} ${dashVideo.codecs} ${dashVideo.width}x${dashVideo.height}`)
    if (dashAudio) debug.push(`DASH 音频选中：${dashAudio.codecs} ${Math.round((dashAudio.bandwidth || 0) / 1000)}kbps`)
  }

  // ③ progressive（单文件，自带声音）
  const durlData = await playurl("1", "80")
  const durl = durlData?.durl?.[0]
  if (durl?.url) {
    result.video_url = durl.url
    result.progressiveQuality = durlData?.quality || 0
    debug.push(`progressive（自带声音）：${qnLabel(result.progressiveQuality)}`)
  } else {
    debug.push("progressive：不可用（该视频只有 DASH）")
  }

  if (dashVideo?.url) {
    result.dashVideoUrl = dashVideo.url
    result.dashVideoBackups = dashVideo.backupUrls || []
    result.dashVideoQuality = dashVideo.id
    result.dashVideoCodecs = dashVideo.codecs
  }
  if (dashAudio?.url) {
    result.dashAudioUrl = dashAudio.url
    result.dashAudioBackups = dashAudio.backupUrls || []
    result.dashAudioCodecs = dashAudio.codecs
  }

  // 决策：DASH 画质明显更高（或没有 progressive）→ 需要合轨
  const dashQ = dashVideo?.id || 0
  const progQ = result.progressiveQuality || 0
  result.needsMux = !!dashVideo?.url && dashQ > progQ && !!dashAudio?.url
  debug.push(result.needsMux
    ? `结论：DASH ${qnLabel(dashQ)} 高于 progressive ${qnLabel(progQ)} → 需下载音视频并合轨`
    : `结论：使用 progressive ${qnLabel(progQ)}（单文件自带声音，无需合轨）`)

  result.success = !!(result.video_url || result.dashVideoUrl)
  if (!result.success) result.error = "没有拿到任何播放地址（可能需要登录 Cookie 或该视频受限）"
  return result
}
