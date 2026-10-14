/**
 * 快手解析模块
 *
 * 参考实现：ParseHub `provider_api/kuaishou.py`
 *  · 快手没有好用的公开 JSON 接口，但**分享页 / 视频页的 HTML 里带 Apollo 缓存**：
 *    `window.__APOLLO_STATE__`（{defaultClient, clients}），视频信息就在里面
 *    （`videoResource.h264.adaptationSet[0].representation[0].url` 或 `manifestH265.*`）。
 *  · 不同路由稳定性差异大、命中风控时返回 `{"result":2}` → 需要换路由(/fw/photo/{id})与 header 重试。
 *  · ⚠️ H.265 在 iOS 上虽然能播，但保存/兼容性不如 H.264 → 这里**优先 h264**，没有才用 h265。
 */

import { fetch } from "scripting"

export interface KuaishouResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  cover_url?: string | null
  video_url?: string | null
  videoUrls?: string[]
  images?: string[]
  imagePreviews?: string[]
  durationSeconds?: number
  quality?: string
  link?: string
  error?: string
  debug?: string[]
}

const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
const UA_LIGHT = "Mozilla/5.0"

/** 取 `xxx = {…}` 的平衡花括号 JSON */
export function extractAssignedJson(html: string, key: string): any | null {
  const idx = html.indexOf(key)
  if (idx < 0) return null
  const start = html.indexOf("{", idx)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
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
          return JSON.parse(html.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 从各种快手链接里取作品 id（短链需先展开） */
export function extractKuaishouId(url: string): string | null {
  const patterns = [
    /kuaishou\.com\/short-video\/([A-Za-z0-9_-]{6,})/,
    /kuaishou\.com\/fw\/photo\/([A-Za-z0-9_-]{6,})/,
    /chenzhongtech\.com\/fw\/photo\/([A-Za-z0-9_-]{6,})/,
    /[?&](?:photoId|videoId|vid|modal_id)=([A-Za-z0-9_-]{6,})/,
    /kuaishou\.com\/f\/([A-Za-z0-9_-]{6,})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m?.[1]) return m[1]
  }
  return null
}

/** Apollo 里的嵌套字段常写成 `{type:"json", json:{…}}` → 拆一层 */
function unwrapJson(node: any): any {
  if (node && typeof node === "object" && node.type === "json" && node.json && typeof node.json === "object") return node.json
  return node
}

/** 深度扫描 Apollo state，找出「像视频/图集」的条目 */
function deepScan(state: any): {
  videoUrls: string[]
  images: string[]
  caption: string
  cover: string
  author: string
  durationMs: number
} {
  const out = { videoUrls: [] as string[], images: [] as string[], caption: "", cover: "", author: "", durationMs: 0 }
  const seen = new Set<any>()

  /** manifest（已拆 json）→ 最高分辨率那条的 url + 镜像 */
  const pickRepresentation = (manifestRaw: any): string => {
    const manifest = unwrapJson(manifestRaw)
    const set = manifest?.adaptationSet?.[0]
    const reps: any[] = set?.representation || []
    if (!reps.length) return ""
    const sorted = [...reps].sort((a, b) => (b.height || 0) - (a.height || 0))
    const url = sorted[0]?.url
    return typeof url === "string" && url.startsWith("http") ? url : ""
  }

  const pushVideo = (url: string) => {
    if (typeof url === "string" && url.startsWith("http") && !out.videoUrls.includes(url)) out.videoUrls.push(url)
  }

  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    // ⚠️ `{type:"json", json:{…}}` 包一层 → 下探真实数据
    if (node.type === "json" && node.json) walk(node.json, depth + 1)

    // 视频档位：h264 优先（iOS 兼容性最好），其次 h265 / 默认 manifest / 直链 photoUrl
    const videoResource = unwrapJson(node.videoResource)
    if (videoResource) {
      pushVideo(pickRepresentation(videoResource.h264))
      pushVideo(pickRepresentation(videoResource.h265 ?? videoResource.hevc))
    }
    pushVideo(pickRepresentation(node.manifestH265))
    if (node.__typename === "VisionVideoSetRepresentation" || typeof node.url === "string") {
      if (typeof node.url === "string" && node.url.includes(".mp4")) pushVideo(node.url)
    }
    if (typeof node.photoUrl === "string" && node.photoUrl.includes(".mp4")) pushVideo(node.photoUrl)

    // 元数据
    if (!out.durationMs && typeof node.duration === "number" && node.duration > 0) out.durationMs = node.duration
    if (!out.cover && typeof node.coverUrl === "string") out.cover = node.coverUrl
    if (!out.caption && typeof node.caption === "string" && node.caption.trim()) out.caption = node.caption
    if (!out.author && node.__typename === "VisionVideoDetailAuthor" && typeof node.name === "string") out.author = node.name
    if (!out.author && typeof node.userName === "string") out.author = node.userName
    if (!out.author && typeof node.author?.name === "string") out.author = node.author.name

    // 图集
    const atlas = unwrapJson(node.atlas)
    const atlasList = atlas?.cdn || atlas?.list || node.atlasPhotos
    if (Array.isArray(atlasList)) {
      for (const item of atlasList) {
        const url = typeof item === "string" ? item : item?.url || item?.cdn
        if (typeof url === "string" && url.startsWith("http") && !out.images.includes(url)) out.images.push(url)
      }
    }

    for (const key of Object.keys(node)) walk(node[key], depth + 1)
  }

  walk(state, 0)
  return out
}

async function fetchPage(url: string, headers: Record<string, string>): Promise<{ html: string; status: number } | null> {
  try {
    const resp = await fetch(url, { headers, timeout: 20 } as any)
    const html = await resp.text()
    return { html, status: resp.status }
  } catch {
    return null
  }
}

/**
 * 解析快手作品（视频 / 图集）。短链会先跟随重定向拿真实地址。
 */
export async function parseKuaishou(url: string, cookie: string = ""): Promise<KuaishouResult> {
  const debug: string[] = []
  const result: KuaishouResult = { success: false, platform: "kuaishou", link: url, debug }

  const baseHeaders: Record<string, string> = {
    "User-Agent": UA_DESKTOP,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: "https://www.kuaishou.com/",
  }
  if (cookie) baseHeaders["Cookie"] = cookie

  // ① 短链展开
  let targetUrl = url
  let photoId = extractKuaishouId(url)
  if (!photoId) {
    try {
      const resp = await fetch(url, { headers: baseHeaders, timeout: 20 } as any)
      const finalUrl = String((resp as any).url || "")
      const html = await resp.text()
      photoId = extractKuaishouId(finalUrl) || extractKuaishouId(html)
      if (finalUrl) targetUrl = finalUrl
      debug.push(`短链展开：${finalUrl.slice(0, 90) || "未跳转"}`)
    } catch (error) {
      debug.push(`短链展开失败：${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    debug.push(`链接已含作品 ID：${photoId}`)
  }

  // ② 候选路由（风控时换路由重试）
  const candidates: string[] = []
  if (targetUrl) candidates.push(targetUrl)
  if (photoId) {
    candidates.push(`https://www.kuaishou.com/short-video/${photoId}`)
    candidates.push(`https://v.m.chenzhongtech.com/fw/photo/${photoId}`)
  }
  const headerVariants: Record<string, string>[] = [
    baseHeaders,
    { "User-Agent": UA_LIGHT, Referer: "https://www.kuaishou.com/", Accept: "text/html,*/*" },
  ]

  let state: any = null
  for (const candidate of candidates) {
    for (const headers of headerVariants) {
      const page = await fetchPage(candidate, headers)
      if (!page) continue
      // 风控特征
      if (page.html.trim().startsWith("{") && page.html.includes('"result"')) {
        debug.push(`${candidate.slice(0, 60)} → 命中风控（${page.html.slice(0, 60)}）`)
        continue
      }
      const found = extractAssignedJson(page.html, "__APOLLO_STATE__")
      if (found) {
        debug.push(`${candidate.slice(0, 60)} → HTTP ${page.status}，拿到 Apollo state`)
        state = found
        break
      }
      debug.push(`${candidate.slice(0, 60)} → HTTP ${page.status}，${Math.round(page.html.length / 1024)}KB，无 Apollo state`)
    }
    if (state) break
  }

  if (!state) {
    result.error = "拿不到快手页面数据（可能命中风控，可稍后重试或填 Cookie）"
    return result
  }

  const scanned = deepScan(state)
  result.title = scanned.caption
  result.author = scanned.author
  result.cover_url = scanned.cover || null
  result.durationSeconds = scanned.durationMs ? Math.round(scanned.durationMs / 1000) : 0

  if (scanned.videoUrls.length) {
    result.video_url = scanned.videoUrls[0]
    result.videoUrls = scanned.videoUrls
    result.quality = scanned.videoUrls[0].includes("h264") || scanned.videoUrls.length ? "H.264 优先" : ""
    result.success = true
    debug.push(`视频直链 ${scanned.videoUrls.length} 条（优先 H.264）`)
    return result
  }
  if (scanned.images.length) {
    result.images = scanned.images
    result.imagePreviews = scanned.images
    result.cover_url = scanned.images[0]
    result.success = true
    debug.push(`图集 ${scanned.images.length} 张`)
    return result
  }

  result.error = "页面里没找到可下载的视频/图片（可能是直播或需要登录的作品）"
  return result
}
