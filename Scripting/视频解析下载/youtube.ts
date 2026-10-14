/**
 * YouTube 解析模块（自力实现，ParseHub 里 YouTube 是交给 yt-dlp 的，脚本里用不上）
 *
 * 策略：
 *  ① 抓 `https://www.youtube.com/watch?v=<id>` 页面，取 `ytInitialPlayerResponse`（平衡花括号切片）
 *  ② 从 `streamingData` 选流：
 *     · `formats` = progressive（视频+音频同一文件，通常 ≤720p）→ 直接下
 *     · `adaptiveFormats` = 分离轨道（1080p/4K）→ 下 video-only + audio-only，本地 ffmpeg `-c copy` 合轨
 *     · ⚠️ 优先 `avc1`（H.264）：`av01`(AV1) / `vp9` iOS 解码支持差
 *     · ⚠️ 有时只给 `signatureCipher`（无 `url`）→ 那条流跳过
 *  ③ 兜底：`youtubei/v1/player` + **ANDROID 客户端**（通常直接返回带 url 的流）
 *  ④ 受限视频（年龄 / 地区）需要 Cookie；返回 `needLogin` 让上层提示。
 */

import { fetch } from "scripting"

export interface YouTubeResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  cover_url?: string | null
  video_url?: string | null
  videoUrls?: string[]
  /** 自适应流：需与视频轨合轨的纯音频地址 */
  audio_url?: string | null
  /** 单文件（自带声音）的 progressive 地址，给不支持合轨的调用方（分享面板）用 */
  progressive_url?: string | null
  durationSeconds?: number
  quality?: string
  link?: string
  error?: string
  debug?: string[]
  needLogin?: boolean
}

const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** 从各种 YouTube 链接里取视频 ID */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m?.[1]) return m[1]
  }
  return null
}

/** 取 `xxx = {…}` 里的平衡花括号 JSON（页面里的 ytInitialPlayerResponse 等） */
export function extractAssignedJson(html: string, key: string): any | null {
  const idx = html.indexOf(key)
  if (idx < 0) return null
  const braceStart = html.indexOf("{", idx)
  if (braceStart < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

interface StreamPick {
  videoUrl: string
  audioUrl: string
  progressiveUrl: string
  height: number
  qualityLabel: string
  needMux: boolean
  note: string
}

/** 从 playerResponse.streamingData 里挑流（prioritizeAvc：优先 H.264） */
export function pickYouTubeStreams(streamingData: any, debug: string[]): StreamPick | null {
  const formats: any[] = Array.isArray(streamingData?.formats) ? streamingData.formats : []
  const adaptive: any[] = Array.isArray(streamingData?.adaptiveFormats) ? streamingData.adaptiveFormats : []
  const hasUrl = (f: any) => typeof f?.url === "string" && f.url.startsWith("http")

  const progressive = formats.filter((f) => hasUrl(f) && /video\/mp4/.test(f.mimeType || ""))
  const bestProgressive = progressive.sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null

  const avc = adaptive.filter((f) => hasUrl(f) && /^video\/mp4/.test(f.mimeType || "") && /avc1/.test(f.mimeType || ""))
  const anyVideo = adaptive.filter((f) => hasUrl(f) && /^video\/mp4/.test(f.mimeType || ""))
  const audioMp4 = adaptive.filter((f) => hasUrl(f) && /^audio\/mp4/.test(f.mimeType || ""))
  const bestAudio = audioMp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null
  const pool = avc.length ? avc : anyVideo
  const bestAdaptive = pool.sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null

  debug.push(`流：progressive ${progressive.length} 档（最高 ${bestProgressive?.height || 0}p）/ 自适应 avc1 ${avc.length} 档（最高 ${bestAdaptive?.height || 0}p）/ 音频 m4a ${audioMp4.length} 档`)
  const skipped = formats.length + adaptive.length - (progressive.length + anyVideo.length + audioMp4.length)
  if (skipped > 0) debug.push(`跳过 ${skipped} 条无直链（signatureCipher）或非 mp4 的流`)

  // 自适应用更高画质才值得合轨（否则直接用 progressive，自带声音）
  if (bestAdaptive && bestAudio && (bestAdaptive.height || 0) > (bestProgressive?.height || 0) + 1) {
    return {
      videoUrl: bestAdaptive.url,
      audioUrl: bestAudio.url,
      progressiveUrl: bestProgressive?.url || "",
      height: bestAdaptive.height || 0,
      qualityLabel: `${bestAdaptive.height || "?"}p 自适应（需合轨）`,
      needMux: true,
      note: `视频 ${bestAdaptive.height}p(${String(bestAdaptive.mimeType || "").split(";")[0]}) + 音频 ${Math.round((bestAudio.bitrate || 0) / 1000)}kbps`,
    }
  }
  if (bestProgressive) {
    return {
      videoUrl: bestProgressive.url,
      audioUrl: "",
      progressiveUrl: bestProgressive.url,
      height: bestProgressive.height || 0,
      qualityLabel: `${bestProgressive.qualityLabel || `${bestProgressive.height || "?"}p`}（单文件带声音）`,
      needMux: false,
      note: "progressive 单文件",
    }
  }
  if (bestAdaptive && bestAudio) {
    return {
      videoUrl: bestAdaptive.url,
      audioUrl: bestAudio.url,
      progressiveUrl: "",
      height: bestAdaptive.height || 0,
      qualityLabel: `${bestAdaptive.height || "?"}p 自适应（需合轨）`,
      needMux: true,
      note: "只有自适应流",
    }
  }
  if (bestAdaptive) {
    // 只有视频轨（无音频）也不该当作成功
    return null
  }
  return null
}

/**
 * youtubei player 客户端矩阵（2026-10 实测）：
 *  ✅ **ANDROID_VR**（Quest 3）：直接返回 26 条带直链的 adaptiveFormats + 1 条 progressive，playabilityStatus=OK
 *  ❌ WEB / MWEB：只给 `signatureCipher`（无直链，需要跑播放器 JS 解密）
 *  ❌ IOS：HTTP 400；TVHTML5：playabilityStatus=ERROR；ANDROID（手机）：HTTP 400（旧 key/版本已废）
 */
const CLIENTS: { name: string; key: string; client: Record<string, any>; ua: string }[] = [
  {
    name: "ANDROID_VR",
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.60.19",
      androidSdkVersion: 32,
      deviceModel: "Quest 3",
      userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip",
    },
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; GB) gzip",
  },
  {
    name: "IOS",
    key: "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
    client: {
      clientName: "IOS",
      clientVersion: "19.29.1",
      deviceModel: "iPhone16,2",
      userAgent: "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
    },
    ua: "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)",
  },
]

/** 用 youtubei player 接口取播放器响应（客户端矩阵逐个试） */
async function playerViaClient(videoId: string, debug: string[]): Promise<any | null> {
  for (const c of CLIENTS) {
    try {
      const resp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${c.key}&prettyPrint=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": c.ua,
          Origin: "https://www.youtube.com",
        },
        body: JSON.stringify({
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          context: { client: { hl: "en", gl: "US", utcOffsetMinutes: 0, ...c.client } },
        }),
        timeout: 25,
      } as any)
      if (!resp.ok) {
        debug.push(`youtubei[${c.name}]：HTTP ${resp.status}`)
        continue
      }
      const data = await resp.json()
      const status = data?.playabilityStatus?.status
      if (status && status !== "OK") {
        debug.push(`youtubei[${c.name}]：playabilityStatus=${status}（${data?.playabilityStatus?.reason || ""}）`)
        continue
      }
      debug.push(`youtubei[${c.name}]：OK`)
      return data
    } catch (error) {
      debug.push(`youtubei[${c.name}] 异常：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return null
}

function buildResult(pr: any, debug: string[], videoId: string, link: string): YouTubeResult {
  const result: YouTubeResult = { success: false, platform: "youtube", link, debug }
  const details = pr?.videoDetails || {}
  result.title = details.title || ""
  result.author = details.author || ""
  result.durationSeconds = parseInt(details.lengthSeconds || "0", 10) || 0
  const thumbs: any[] = details.thumbnail?.thumbnails || []
  result.cover_url = thumbs.length ? thumbs[thumbs.length - 1]?.url || null : null

  const status = pr?.playabilityStatus?.status
  if (status && status !== "OK") {
    result.error = `该视频不可播放：${pr?.playabilityStatus?.reason || status}`
    result.needLogin = status === "LOGIN_REQUIRED" || /age|sign in|bot/i.test(String(pr?.playabilityStatus?.reason || ""))
    return result
  }

  const picked = pickYouTubeStreams(pr?.streamingData, debug)
  if (!picked) {
    result.error = "没拿到可下载的流（可能需要 Cookie / 或该视频限制了第三方下载）"
    result.needLogin = true
    return result
  }
  result.video_url = picked.videoUrl
  result.videoUrls = [picked.videoUrl]
  result.audio_url = picked.audioUrl || null
  result.progressive_url = picked.progressiveUrl || null
  result.quality = picked.qualityLabel
  result.success = true
  debug.push(`选中：${picked.qualityLabel} · ${picked.note}`)
  return result
}

/**
 * 解析 YouTube 视频。返回的 `audio_url` 非空时，下载阶段会拉视频轨+音频轨并本地合轨。
 */
export async function parseYouTubeVideo(url: string, cookie: string = ""): Promise<YouTubeResult> {
  const debug: string[] = []
  const result: YouTubeResult = { success: false, platform: "youtube", link: url, debug }

  const videoId = extractYouTubeId(url.trim())
  if (!videoId) {
    result.error = "无法从链接中提取 YouTube 视频 ID"
    return result
  }
  debug.push(`视频 ID：${videoId}${cookie ? " · 带 Cookie" : ""}`)

  // ① youtubei player（ANDROID_VR 优先：实测只有它给直链）
  const viaApi = await playerViaClient(videoId, debug)
  if (viaApi) {
    const built = buildResult(viaApi, debug, videoId, url)
    if (built.success) return built
    debug.push(`youtubei 响应不可用：${built.error || "未知"}`)
    result.error = built.error
    result.needLogin = built.needLogin
  }

  // ② 网页播放器响应（备用：有时网页版会给直链，也可能只给 signatureCipher）
  try {
    const headers: Record<string, string> = {
      "User-Agent": UA_DESKTOP,
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml",
    }
    if (cookie) headers["Cookie"] = cookie
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en&has_verified=1&bpctr=9999999999`, {
      headers,
      timeout: 25,
    } as any)
    const html = await resp.text()
    debug.push(`watch 页 HTTP ${resp.status}，${Math.round(html.length / 1024)}KB`)
    const pr = extractAssignedJson(html, "ytInitialPlayerResponse")
    if (pr) {
      const built = buildResult(pr, debug, videoId, url)
      if (built.success) return built
      // 失败也先留着原因，继续试 ANDROID 客户端
      debug.push(`网页播放器响应不可用：${built.error || "未知"}`)
      result.error = built.error
      result.needLogin = built.needLogin
    } else {
      debug.push("页面里没找到 ytInitialPlayerResponse（可能是同意页 / 机器人校验）")
    }
  } catch (error) {
    debug.push(`watch 页异常：${error instanceof Error ? error.message : String(error)}`)
  }

  if (!result.error) result.error = "YouTube 解析失败（可能需要 Cookie 或该视频受地区限制）"
  return result
}
