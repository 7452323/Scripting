/**
 * 小红书解析模块（2026-10 真机实测）
 *
 * 关键结论：
 *  · ✅ **正路 = 笔记页 SSR**：带上登录 Cookie 抓
 *    `https://www.xiaohongshu.com/explore/{noteId}?xsec_token=…&xsec_source=pc_feed`
 *    → HTML 里的 `window.__INITIAL_STATE__.note.noteDetailMap[firstNoteId].note` 就是完整笔记数据
 *    （title / desc / imageList / video.media.stream）。
 *    ⚠️ 匿名抓同一页只有 36KB 且 **没有 `noteDetailMap`** → 小红书详情确实要登录态。
 *    ⚠️ `xsec_token` 必须带上（App/网页分享链接里都有）；SSR 里还会把 `undefined` 写成 JS 字面量，JSON.parse 前要换成 null。
 *  · ❌ 签名 API `POST edith.xiaohongshu.com/api/sns/web/v1/feed`（页内调 `window._webmsxyw` 拿 x-s）：
 *    签名本身没问题（`/api/sns/web/v2/user/me` 返回 code=0），但 feed 接口单独风控 →
 *    `{"success":false,"code":300011,"msg":"当前账号存在异常，请切换账号后重试"}`。
 *    改成 same-origin 调 `www.xiaohongshu.com/api/...` 直接 HTTP 500。⇒ 不要再依赖签名 API。
 *  · ⚠️ **视频流家族命名变了**：`stream` 的 key 不再是 `h264/h265/av1/h266`，而是 `EF4/EF5/EF6/EF7`
 *    （实测 EF4=h264、EF5=hevc）。`videoCodec` 字段只是原样回显家族名，**分辨不出编码** →
 *    用 `ffprobe`（脚本里 `Shell.run` 可用）实测每个候选的 codec_name 再选，避开 iOS 不能解的 AV1/VVC。
 *  · 图片：`imageList[].urlDefault` 是可显示尺寸；**原图**用 trace id 重建
 *    `https://sns-img-hw.xhscdn.com/{32位hex目录之后的部分}`（实测 206 可下）。
 */

import { fetch } from "scripting"

export interface XhsMediaResult {
  success: boolean
  platform?: string
  title?: string
  desc?: string
  author?: string
  video_url?: string | null
  videoUrls?: string[]
  videoQuality?: string
  images?: string[]
  imagePreviews?: string[]
  cover_url?: string | null
  link?: string
  error?: string
  debug?: string[]
  /** 动图（livePhoto）数量 */
  livePhotoCount?: number
  needLogin?: boolean
}

const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
/** iOS 能解码的编码（h264 / hevc 都能存相册；av1、vvc 不行） */
const IOS_OK_CODECS = ["h264", "hevc", "h265", "mpeg4"]
/** 编码优先级（同分辨率时 H.264 兼容性最好） */
const CODEC_RANK: Record<string, number> = { h264: 3, hevc: 2, h265: 2, mpeg4: 1 }

// ─── URL / 短链 ────────────────────────────────────────

export function extractXhsNoteId(url: string): string | null {
  const patterns = [
    /xiaohongshu\.com\/explore\/([0-9a-fA-F]{16,})/,
    /xiaohongshu\.com\/discovery\/item\/([0-9a-fA-F]{16,})/,
    /xhslink\.com\/[A-Za-z0-9/]+/,
    /(?:noteId|note_id)=([0-9a-fA-F]{16,})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m?.[1]) return m[1]
  }
  return null
}

export function extractXsecToken(url: string): string | null {
  const m = url.match(/[?&]xsec_token=([^&#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function extractXsecSource(url: string): string {
  const m = url.match(/[?&]xsec_source=([^&#]+)/)
  return m ? decodeURIComponent(m[1]) : "pc_feed"
}

/** 短链展开（xhslink.com → 真实笔记地址，通常带 xsec_token） */
export async function resolveXhsShortLink(
  url: string,
  cookie: string
): Promise<{ noteId: string | null; token: string | null; source: string; targetUrl: string; note: string }> {
  const directId = extractXhsNoteId(url)
  if (directId) {
    return { noteId: directId, token: extractXsecToken(url), source: extractXsecSource(url), targetUrl: url, note: `链接已含笔记 ID` }
  }
  const headers: Record<string, string> = { "User-Agent": UA_DESKTOP, "Accept": "text/html,application/xhtml+xml,*/*" }
  if (cookie) headers["Cookie"] = cookie
  try {
    const resp = await fetch(url, { headers, timeout: 20 } as any)
    const finalUrl = String((resp as any).url || "")
    const html = await resp.text().catch(() => "")
    const noteId = extractXhsNoteId(finalUrl) || extractXhsNoteId(html)
    return {
      noteId,
      token: extractXsecToken(finalUrl) || extractXsecToken(html),
      source: extractXsecSource(finalUrl),
      targetUrl: finalUrl || url,
      note: noteId ? `短链展开成功：${finalUrl.slice(0, 90)}` : "短链已访问但没解析到笔记 ID",
    }
  } catch (error) {
    return { noteId: null, token: null, source: "pc_feed", targetUrl: url, note: `短链展开失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

// ─── SSR 解析 ──────────────────────────────────────────

/** 解析 HTML 里的 `window.__INITIAL_STATE__`（⚠️ 必须先把 JS 的 undefined 换成 null） */
export function parseXhsInitialState(html: string): any | null {
  const markers = ["window.__INITIAL_STATE__=", "window.__INITIAL_STATE__ = ", "window.__INITIAL_SSR_STATE__="]
  let idx = -1
  let marker = ""
  for (const m of markers) {
    const i = html.indexOf(m)
    if (i >= 0 && (idx < 0 || i < idx)) { idx = i; marker = m }
  }
  if (idx < 0) return null
  let json = html.slice(idx + marker.length)
  const end = json.indexOf("</script>")
  if (end >= 0) json = json.slice(0, end)
  json = json.trim().replace(/;$/, "").replace(/\bundefined\b/g, "null")
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** 从 SSR state 里取目标笔记（并核对 noteId） */
export function findNoteInState(state: any, noteId: string): any | null {
  const root = state?.note
  if (!root) return null
  const map = root.noteDetailMap || {}
  const first = root.firstNoteId
  const candidates: any[] = []
  if (first && map[first]) candidates.push(map[first]?.note)
  candidates.push(map[noteId]?.note)
  for (const key of Object.keys(map)) candidates.push(map[key]?.note)
  const found = candidates.find((n) => n && (!n.noteId || String(n.noteId) === noteId))
  return found || candidates.find((n) => !!n) || null
}

// ─── 媒体 ──────────────────────────────────────────────

/** 小红书 CDN 会下发 http:// 的视频地址，统一升级成 https（iOS 更稳） */
function secureUrl(u: string): string {
  return u.startsWith("http://") ? "https://" + u.slice(7) : u
}

/** 原图：用 trace id 重建（`sns-img-hw.xhscdn.com/{目录后路径}`） */
export function rawXhsImageUrl(url: string): string {
  const m = url.match(/\/[a-f0-9]{32}\/(.*?\/[^/!]+?)(?:!.*)?$/)
  if (m) return `https://sns-img-hw.xhscdn.com/${m[1]}`
  const m2 = url.match(/\/([^/!]+?)(?:!.*)?$/)
  return m2 ? `https://sns-img-hw.xhscdn.com/${m2[1]}` : url
}

export interface XhsVideoCandidate {
  family: string
  url: string
  backupUrls: string[]
  width: number
  height: number
  size: number
  durationMs: number
  qualityType: string
}

/** 收集视频候选（stream 的 key 现在是 EF4/EF5/… 家族名），按短边从大到小 */
export function collectXhsVideoCandidates(note: any): XhsVideoCandidate[] {
  const stream = note?.video?.media?.stream
  const out: XhsVideoCandidate[] = []
  if (!stream || typeof stream !== "object") return out
  for (const family of Object.keys(stream)) {
    const list = stream[family]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item?.masterUrl) continue
      out.push({
        family,
        url: item.masterUrl,
        backupUrls: item.backupUrls || [],
        width: item.width || 0,
        height: item.height || 0,
        size: item.size || 0,
        durationMs: item.duration || 0,
        qualityType: item.qualityType || "",
      })
    }
  }
  return out.sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height))
}

/** 用 ffprobe 实测某个候选的编码（`videoCodec` 字段分辨不出真实编码） */
export async function probeXhsCodec(url: string): Promise<{ codec: string; width: number; height: number } | null> {
  try {
    const r = await Shell.run(
      `ffprobe -v error -select_streams v -show_entries stream=codec_name,width,height -of default=nw=1 "${url}"`,
      { timeout: 60 }
    )
    if (r.exitCode !== 0) return null
    const text = r.output || ""
    const codec = text.match(/codec_name=(\S+)/)?.[1] || ""
    const width = parseInt(text.match(/width=(\d+)/)?.[1] || "0", 10)
    const height = parseInt(text.match(/height=(\d+)/)?.[1] || "0", 10)
    if (!codec) return null
    return { codec, width, height }
  } catch {
    return null
  }
}

/**
 * 选最佳视频：按分辨率从高到低，用 ffprobe 实测编码，
 * 取第一个 iOS 能解码的（H.264/HEVC）；全都不能解时退回最高分辨率并说明。
 */
async function pickXhsVideo(
  note: any,
  debug: string[]
): Promise<{ url: string; width: number; height: number; codec: string } | null> {
  const cands = collectXhsVideoCandidates(note)
  if (!cands.length) return null
  debug.push(`视频候选 ${cands.length} 档：${cands.map((c) => `${c.family} ${c.width}x${c.height}`).join(" / ")}`)

  let fallback: { url: string; width: number; height: number; codec: string } | null = null
  let tried = 0
  for (const c of cands) {
    if (tried >= 4) break
    tried++
    const info = await probeXhsCodec(c.url)
    if (!info) { debug.push(`  跳过 ${c.family} ${c.width}x${c.height}：探测失败`); continue }
    const label = `${info.width}x${info.height} ${info.codec}`
    if (!fallback) fallback = { url: c.url, width: info.width, height: info.height, codec: info.codec }
    if (IOS_OK_CODECS.includes(info.codec)) {
      debug.push(`  选中 ${c.family}：${label}`)
      return { url: c.url, width: info.width, height: info.height, codec: info.codec }
    }
    debug.push(`  跳过 ${c.family}：${label}（iOS 不能解码）`)
  }
  if (fallback) {
    debug.push(`  ⚠️ 所有候选都不是 iOS 友好编码，退回 ${fallback.codec}（可能存不进相册）`)
    return fallback
  }
  return null
}

// ─── 对外入口 ──────────────────────────────────────────

/**
 * 解析小红书笔记（视频 / 图文 / 动图）。
 * 需要登录 Cookie（小红书详情页匿名只给壳），并且链接最好带 `xsec_token`（分享链接自带）。
 */
export async function parseXhsNote(url: string, cookie: string = ""): Promise<XhsMediaResult> {
  const debug: string[] = []
  const result: XhsMediaResult = { success: false, platform: "xiaohongshu", link: url, debug }

  const resolved = await resolveXhsShortLink(url, cookie)
  debug.push(resolved.note)
  if (!resolved.noteId) {
    result.error = "无法从小红书链接中提取笔记 ID"
    return result
  }
  const noteId = resolved.noteId
  const hasCookie = !!cookie.trim()
  debug.push(`笔记 ${noteId}${resolved.token ? "（带 xsec_token）" : "（⚠️ 链接没有 xsec_token）"}${hasCookie ? " · 带 Cookie" : " · 未配置 Cookie"}`)

  const token = resolved.token || ""
  const pageUrl = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(token)}&xsec_source=${encodeURIComponent(resolved.source || "pc_feed")}`
  const headers: Record<string, string> = {
    "User-Agent": UA_DESKTOP,
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Referer": "https://www.xiaohongshu.com/",
    ...(cookie ? { Cookie: cookie } : {}),
  }

  let html = ""
  try {
    const resp = await fetch(pageUrl, { headers, timeout: 25 } as any)
    html = await resp.text()
    const finalUrl = String((resp as any).url || "")
    if (/\/login/.test(finalUrl)) {
      result.needLogin = true
      result.error = "小红书要求登录：请到「设置 → 平台 Cookie → 小红书」填入 Cookie"
      return result
    }
    debug.push(`笔记页 HTTP ${resp.status}，${Math.round(html.length / 1024)}KB`)
  } catch (error) {
    result.error = `笔记页请求失败：${error instanceof Error ? error.message : String(error)}`
    return result
  }

  const state = parseXhsInitialState(html)
  const note = state ? findNoteInState(state, noteId) : null
  if (!note) {
    result.needLogin = !hasCookie
    result.error = hasCookie
      ? (resolved.token ? "笔记页里没有该笔记的数据（可能已删除 / 仅作者可见 / xsec_token 过期）" : "笔记页没有返回数据：这个链接缺少 xsec_token，请从 App「分享 → 复制链接」拿完整链接")
      : "小红书需要登录态：请到「设置 → 平台 Cookie → 小红书」填入 Cookie 再试"
    return result
  }

  // 身份核对
  if (note.noteId && String(note.noteId) !== noteId) {
    result.error = `笔记 ID 不一致（页面返回 ${note.noteId}），已放弃以免下错内容`
    return result
  }

  result.title = note.title || (note.desc ? String(note.desc).split("\n")[0].slice(0, 60) : "")
  result.desc = note.desc || ""
  result.author = note.user?.nickname || note.user?.nickName || ""

  const images: any[] = Array.isArray(note.imageList) ? note.imageList : []
  result.livePhotoCount = images.filter((i) => i?.livePhoto).length

  if (note.type === "video" || note.video) {
    const picked = await pickXhsVideo(note, debug)
    if (picked) {
      result.video_url = secureUrl(picked.url)
      result.videoUrls = [secureUrl(picked.url)]
      result.videoQuality = `${picked.width}x${picked.height} ${picked.codec}`
    }
    if (images[0]) result.cover_url = rawXhsImageUrl(images[0].urlDefault || images[0].urlPre || "")
    if (!picked) {
      result.error = "拿不到可用的视频流（可能需要登录或该笔记已下架）"
      return result
    }
  } else {
    const rawList: string[] = []
    const previewList: string[] = []
    for (const img of images) {
      const preview = img?.urlDefault || img?.urlPre || ""
      const raw = rawXhsImageUrl(preview || img?.url || "")
      if (raw) { rawList.push(raw); previewList.push(preview || raw) }
    }
    result.images = rawList
    result.imagePreviews = previewList
    result.cover_url = previewList[0] || null
    if (!rawList.length) {
      result.error = "这条笔记没有可下载的图片"
      return result
    }
  }

  result.success = true
  debug.push(`类型=${note.type || "?"} 图片 ${images.length} 张${result.livePhotoCount ? `（其中动图 ${result.livePhotoCount}）` : ""}`)
  return result
}
