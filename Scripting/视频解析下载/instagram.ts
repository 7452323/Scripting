/**
 * Instagram 解析模块
 *
 * 2026-10 真机实测 + 参考用户自己的 QX 脚本 `InstagramRestricted.js`：
 *
 *  ✅ 主通道（免登录）= 内嵌页：`https://www.instagram.com/p/{短码}/embed/captioned/`
 *     页面里的 `contextJSON` 就是官方 GraphQL 结果（`gql_data.shortcode_media`），自带短码可核对身份。
 *  ❌ 匿名 GraphQL（`/graphql/query` + doc_id）→ `401 {"require_login":true}`，必须带会话 Cookie；
 *     这是**受限内容**（embed 被判 invalid / 缺 `EmbeddedMediaImage`）时的补救通道：
 *     用同一个 cookie jar 去首页取 csrftoken → POST graphql（带 `X-IG-App-ID` + `x-csrftoken`）。
 *  ❌ 匿名帖子页 `/p/{短码}/` 只有空壳（没有 video_versions / mp4 / og:video）。
 *  ⚠️ 用 WebView 抓 `document.querySelector('video')` 会拿到页面上任意一个视频 → 下错内容。
 *
 * 取媒体时的两个质量坑（照搬自那份 QX 脚本的实战结论）：
 *  · `video_versions[0]` 可能是 DASH 分片（dashinit/bytestart/byteend）或低清：
 *    要挑 `.mp4` + 非分片 + `type===101`（progressive）+ 宽度最大。
 *  · `display_url` 那套图最大只有 640（糊图根因）：要从 `image_versions2.candidates` 里挑面积最大的；
 *    预览图另挑中等尺寸，避免网格里加载原图。
 */

import { fetch } from "scripting"

export interface InstagramMediaResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  video_url?: string | null
  videoUrls?: string[]
  images?: string[]
  /** 中等尺寸的预览图（给 UI 网格用，避免加载原图） */
  imagePreviews?: string[]
  cover_url?: string | null
  link?: string
  error?: string
  debug?: string[]
  mediaKind?: string
  needLogin?: boolean
}

export const IG_PAGE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const UA_APP = "Instagram 219.0.0.12.117 (iPhone14,3; iOS 16_0; en_US; en-US; scale=3.00; 1284x2778; 314619998)"
const IG_APP_ID = "936619743392459"
/** web 端 GraphQL 的 doc_id（与 QX 脚本 / IG web 一致） */
const POLARIS_DOC_ID = "27128499623469141"

// ─── 短码 / ID ─────────────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

export function instagramShortcode(url: string): string | null {
  const m =
    url.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/) ||
    url.match(/(?:^|\/)(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/)
  return m ? m[1] : null
}

/** 短码 → media_id（短码是 base64url 编码的 8 字节 id） */
export function shortcodeToMediaId(shortcode: string): string {
  let id = BigInt(0)
  for (const ch of shortcode) {
    const i = B64.indexOf(ch)
    if (i < 0) return ""
    id = id * BigInt(64) + BigInt(i)
  }
  return id.toString()
}

function cookieValue(cookie: string, name: string): string {
  const m = cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"))
  return m ? m[1] : ""
}

/** HTML 里被转义过的 URL（`\u0026` / `\/`）→ 正常 URL */
function decodeEscapes(s: string): string {
  return s.replace(/\\u0026/g, "&").replace(/\\\//g, "/")
}

/**
 * 把内嵌页里的 `contextJSON` 还原成可 JSON.parse 的对象。
 * ⚠️ 只还原 \" 和 \u002F；**不能**动 \n（JSON 需要它保持转义）。
 * ⚠️ 有些实现（如 QX 重建出来的 embed）会把 JSON **再 stringify 一次**，所以解出来是字符串时要再 parse。
 */
function parseContextJson(raw: string): any {
  const text = raw.replace(/\\u002F/g, "/").replace(/\\"/g, '"')
  let parsed = JSON.parse(text)
  if (typeof parsed === "string") parsed = JSON.parse(parsed)
  return parsed
}

// ─── 媒体挑选（照搬 QX 脚本的实战结论） ────────────────

/** 挑可播的 mp4：排除 DASH 分片，优先 type=101（progressive）与更高宽度 */
export function pickBestVideoUrl(list: any): string {
  let best = "", score = -1
  const arr = Array.isArray(list) ? list : []
  for (const v of arr) {
    const u = String(v?.url || "")
    if (!u.includes(".mp4")) continue
    if (/dashinit|bytestart|byteend/.test(u)) continue
    const s = (v?.width || 0) + (v?.type === 101 ? 100000 : 0)
    if (s > score) { score = s; best = u }
  }
  return best
}

/** 挑最大面积的图（download 用）+ 一张中等尺寸预览图（UI 用） */
export function pickBestImage(node: any): { best: string; preview: string } {
  const cands: any[] =
    node?.image_versions2?.candidates ||
    (Array.isArray(node?.display_resources)
      ? node.display_resources.map((c: any) => ({ url: c.src, width: c.config_width, height: c.config_height }))
      : [])
  let best = "", bestPx = -1
  let preview = "", previewPx = -1
  for (const c of cands) {
    const w = c?.width || 0, h = c?.height || 0
    const px = w * h
    if (px > bestPx) { bestPx = px; best = c.url || "" }
    if (w > 0 && w <= 640 && px > previewPx) { previewPx = px; preview = c.url || "" }
  }
  const fallback = node?.display_url || node?.thumbnail_src || ""
  return { best: best || fallback, preview: preview || best || fallback }
}

// ─── 节点 → 统一媒体 ───────────────────────────────────

export interface ExtractedMedia {
  video: string
  images: string[]
  previews: string[]
  cover: string
  title: string
  author: string
  kind: string
}

function emptyMedia(): ExtractedMedia {
  return { video: "", images: [], previews: [], cover: "", title: "", author: "", kind: "" }
}

function captionOf(node: any): string {
  const cap = node?.caption
  if (typeof cap === "string") return cap
  return node?.edge_media_to_caption?.edges?.[0]?.node?.text || cap?.text || ""
}

/**
 * 把 `XDTGraph*` 归一化成 `Graph*`：
 * 内嵌页 / 部分 GraphQL 响应会带 XDT 前缀（ParseHub 的 `_normalize_typename` 同样处理）。
 */
function normalizeTypename(node: any): void {
  const t = String(node?.__typename || "")
  if (t.startsWith("XDTGraph")) node.__typename = t.slice(3)
}

function authorOf(node: any): string {
  return node?.owner?.username || node?.user?.username || ""
}

/** GraphQL（GraphXxx）与 v1（media_type / video_versions / image_versions2）两种结构都吃 */
export function mediaFromNode(node: any): ExtractedMedia {
  const out = emptyMedia()
  if (!node) return out
  normalizeTypename(node)
  out.title = captionOf(node)
  out.author = authorOf(node)

  const typename = String(node.__typename || "")
  const children: any[] = node?.edge_sidecar_to_children?.edges?.map((e: any) => e?.node || e)
    || node?.carousel_media
    || []
  const isSidecar = typename === "GraphSidecar" || children.length > 0
  const video = pickBestVideoUrl(node.video_versions) || node.video_url || ""
  const isVideo = node.is_video === true || typename === "GraphVideo" || node.media_type === 2 || !!video

  if (isSidecar) {
    out.kind = "GraphSidecar"
    for (const child of children) {
      normalizeTypename(child)
      const childVideo = pickBestVideoUrl(child?.video_versions) || child?.video_url || ""
      const img = pickBestImage(child)
      const childIsVideo = child?.is_video === true || child?.media_type === 2 || !!childVideo
      if (!out.cover && img.preview) out.cover = img.preview
      if (childIsVideo && childVideo) {
        if (!out.video) out.video = childVideo
      } else if (img.best) {
        out.images.push(img.best)
        out.previews.push(img.preview)
      }
    }
    if (!out.cover) out.cover = out.previews[0] || ""
    return out
  }

  if (isVideo) {
    out.kind = "GraphVideo"
    out.video = video
    const img = pickBestImage(node)
    out.cover = img.preview
    return out
  }

  out.kind = "GraphImage"
  const img = pickBestImage(node)
  if (img.best) out.images = [img.best]
  if (img.preview) out.previews = [img.preview]
  out.cover = img.preview
  return out
}

// ─── 内嵌页 ────────────────────────────────────────────

/** 内嵌页里 contextJSON 所在的位置（两种写法都覆盖） */
export function extractMediaFromEmbedHtml(html: string, shortcode: string): ExtractedMedia | null {
  const m = html.match(/contextJSON"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!m) return null
  let parsed: any = null
  try {
    parsed = parseContextJson(m[1])
  } catch {
    return null
  }
  const media = parsed?.gql_data?.shortcode_media || parsed?.shortcode_media
  if (!media) return null
  const gotShortcode = String(media.shortcode || parsed?.context?.shortcode || "")
  // ⚠️ 身份校验：必须是请求的那个短码
  if (gotShortcode && gotShortcode !== shortcode) return null
  return mediaFromNode(media)
}

/** 内嵌页被判「受限内容」的迹象（此时 embed 没有真数据） */
function looksRestrictedEmbed(html: string): boolean {
  return html.includes("utm_campaign=invalid") || (!html.includes("EmbeddedMediaImage") && !html.includes("contextJSON"))
}

// ─── 帖子页（登录态） ──────────────────────────────────

/** 从帖子 HTML 里提取媒体，**必须**在该短码附近的窗口内找到，避免拿到别人的视频 */
export function extractMediaFromHtml(html: string, shortcode: string): ExtractedMedia | null {
  const anchors: number[] = []
  for (const needle of [`"code":"${shortcode}"`, `"shortcode":"${shortcode}"`]) {
    let from = 0
    while (anchors.length < 6) {
      const i = html.indexOf(needle, from)
      if (i < 0) break
      anchors.push(i)
      from = i + needle.length
    }
  }
  if (!anchors.length) return null

  for (const i of anchors) {
    const win = html.slice(Math.max(0, i - 9000), i + 9000)
    const video = win.match(/"video_versions":\[\{[^}]*?"url":"([^"]+)"/)?.[1] || win.match(/"video_url":"([^"]+)"/)?.[1] || ""
    const cover = win.match(/"display_url":"([^"]+)"/)?.[1] || ""
    if (!video && !cover) continue

    const images: string[] = []
    const previews: string[] = []
    const carousel = win.match(/"carousel_media":\[(.{0,8000}?)\]/)
    if (carousel) {
      const re = /"image_versions2":\{"candidates":\[\{[^}]*?"url":"([^"]+)"/g
      let mm: RegExpExecArray | null
      while ((mm = re.exec(carousel[1])) !== null) {
        const u = decodeEscapes(mm[1])
        images.push(u)
        previews.push(u)
      }
    }
    return {
      video: video ? decodeEscapes(video) : "",
      images,
      previews,
      cover: cover ? decodeEscapes(cover) : "",
      title: decodeEscapes(win.match(/"caption":\{[^}]*?"text":"([^"]{0,300})"/)?.[1] || ""),
      author: win.match(/"owner":\{[^}]*?"username":"([^"]+)"/)?.[1] || "",
      kind: video ? "GraphVideo" : "GraphImage",
    }
  }
  return null
}

// ─── 结果组装 ──────────────────────────────────────────

function toResult(base: InstagramMediaResult, media: ExtractedMedia, via: string): InstagramMediaResult {
  const out: InstagramMediaResult = { ...base }
  out.title = out.title || media.title
  out.author = out.author || media.author
  out.video_url = media.video || null
  out.videoUrls = media.video ? [media.video] : []
  out.images = media.images.length ? media.images : (media.video ? undefined : (media.cover ? [media.cover] : undefined))
  out.imagePreviews = media.previews.length ? media.previews : out.images
  out.cover_url = media.cover || media.images[0] || null
  out.success = !!(media.video || out.images?.length)
  out.mediaKind = media.kind || undefined
  out.debug = [...(base.debug || []), `命中通道：${via}（${media.kind}${media.video ? "，视频" : `，图片 ${out.images?.length || 0} 张`}）`]
  if (!out.success) out.error = "该帖子没有可下载的媒体"
  return out
}

// ─── 通道①：内嵌页（免登录，主通道） ───────────────────

async function tryEmbedPage(shortcode: string, debug: string[]): Promise<InstagramMediaResult | null> {
  for (const kind of ["p", "reel", "tv"]) {
    const url = `https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA_DESKTOP, "Accept": "text/html,*/*" }, timeout: 20 } as any)
      const html = await resp.text()
      const media = extractMediaFromEmbedHtml(html, shortcode)
      if (media) {
        debug.push(`内嵌页(/embed/captioned/)：命中 ${shortcode}`)
        return toResult({ success: false, platform: "instagram", link: url, debug }, media, "内嵌页（免登录）")
      }
      if (looksRestrictedEmbed(html)) {
        debug.push(`内嵌页 ${kind}：被判受限内容（embed 无效），需要会话 Cookie 走 GraphQL 补救`)
      } else {
        debug.push(`内嵌页 ${kind}：HTTP ${resp.status}，页面里没有该帖子的媒体（${Math.round(html.length / 1024)}KB）`)
      }
    } catch (error) {
      debug.push(`内嵌页 ${kind}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return null
}

// ─── 通道②：web GraphQL（需 Cookie；受限内容的补救） ───

/**
 * 与 IG web 端同一套配方（QX 脚本验证过）：
 * 用**同一个 cookie jar** 去首页取 csrftoken → POST /graphql/query（带 X-IG-App-ID + x-csrftoken）。
 * ⚠️ csrftoken 必须和 sessionid 同源，否则判 CSRF 不匹配。
 */
async function tryGraphQL(
  shortcode: string,
  cookie: string,
  debug: string[]
): Promise<InstagramMediaResult | null> {
  const jar: Record<string, string> = {}
  for (const part of String(cookie || "").split(/;\s*/)) {
    const i = part.indexOf("=")
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  const cookieStr = () => Object.keys(jar).map((k) => `${k}=${jar[k]}`).join("; ")

  try {
    if (!jar.csrftoken) {
      const home = await fetch("https://www.instagram.com/", {
        headers: { "User-Agent": UA_DESKTOP, "Accept": "text/html,application/xhtml+xml", ...(Object.keys(jar).length ? { Cookie: cookieStr() } : {}) },
        timeout: 25,
      } as any)
      const setCookie = String((home.headers as any)?.get?.("set-cookie") || (home.headers as any)?.get?.("Set-Cookie") || "")
      const m = setCookie.match(/csrftoken=([^;]+)/)
      if (m) jar.csrftoken = m[1]
      debug.push(`GraphQL 预备：csrftoken ${jar.csrftoken ? "已获取" : "未取到"}`)
    }
    const headers: Record<string, string> = {
      "User-Agent": UA_DESKTOP,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.8",
      "Referer": "https://www.instagram.com/",
      "X-IG-App-ID": IG_APP_ID,
    }
    if (Object.keys(jar).length) headers["Cookie"] = cookieStr()
    if (jar.csrftoken) headers["x-csrftoken"] = jar.csrftoken

    const variables = JSON.stringify({ shortcode, __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false })
    const body = `variables=${encodeURIComponent(variables)}&doc_id=${POLARIS_DOC_ID}&server_timestamps=true`
    const resp = await fetch("https://www.instagram.com/graphql/query", { method: "POST", headers, body, timeout: 25 } as any)
    const text = await resp.text()
    let data: any = null
    try { data = JSON.parse(text) } catch {}
    if (data?.status && data.status !== "ok") debug.push(`GraphQL：status=${data.status}`)
    // 受限内容会明确回 xdt_shortcode_media = null
    if (data?.data && "xdt_shortcode_media" in data.data && data.data.xdt_shortcode_media === null) {
      debug.push("GraphQL：该帖为受限内容（xdt_shortcode_media=null，需登录 / 年龄验证）")
      return null
    }
    const item = data?.data?.xdt_shortcode_media || data?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0]
    if (!item) {
      const note = data?.require_login ? "服务端要求登录（require_login）" : (data?.message || text.slice(0, 80))
      debug.push(`GraphQL：无数据（HTTP ${resp.status}，${note}）`)
      return null
    }
    const gotCode = String(item.code || item.shortcode || "")
    if (gotCode && gotCode !== shortcode) {
      debug.push(`GraphQL：返回的是别的帖子（${gotCode}），已丢弃`)
      return null
    }
    debug.push(`GraphQL：命中 ${gotCode || shortcode} · media_type=${item.media_type ?? "?"}`)
    return toResult({ success: false, platform: "instagram", link: "", debug }, mediaFromNode(item), "web GraphQL")
  } catch (error) {
    debug.push(`GraphQL：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

// ─── 通道③：移动端私有 API（需 Cookie） ────────────────

async function tryPrivateApi(
  mediaId: string,
  shortcode: string,
  cookie: string,
  debug: string[]
): Promise<InstagramMediaResult | null> {
  for (const host of ["i.instagram.com", "www.instagram.com"]) {
    try {
      const resp = await fetch(`https://${host}/api/v1/media/${mediaId}/info/`, {
        headers: {
          "User-Agent": UA_APP,
          "X-IG-App-ID": IG_APP_ID,
          "Accept": "*/*",
          "x-ig-www-claim": "0",
          "Cookie": cookie,
        },
        timeout: 20,
      } as any)
      const text = await resp.text()
      if (!text.trim().startsWith("{")) {
        debug.push(`私有API ${host}：非 JSON（HTTP ${resp.status}）`)
        continue
      }
      const item = JSON.parse(text)?.items?.[0]
      if (!item) { debug.push(`私有API ${host}：无 items`); continue }
      if (item.code && item.code !== shortcode) {
        debug.push(`私有API ${host}：返回的是别的帖子（${item.code}），已丢弃`)
        continue
      }
      debug.push(`私有API ${host}：命中 ${item.code || shortcode}`)
      return toResult({ success: false, platform: "instagram", link: "", debug }, mediaFromNode(item), `私有API(${host})`)
    } catch (error) {
      debug.push(`私有API ${host}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return null
}

// ─── 通道④：帖子页 HTML（登录态） ──────────────────────

async function tryPostPage(
  shortcode: string,
  url: string,
  cookie: string,
  debug: string[]
): Promise<InstagramMediaResult | null> {
  const pageUrl = `https://www.instagram.com/p/${shortcode}/`
  for (const [label, ua] of [["iPhone", IG_PAGE_UA], ["桌面", UA_DESKTOP]] as [string, string][]) {
    try {
      const headers: Record<string, string> = { "User-Agent": ua, "Accept": "text/html,*/*" }
      if (cookie) headers["Cookie"] = cookie
      const resp = await fetch(pageUrl, { headers, timeout: 25 } as any)
      const html = await resp.text()
      const media = extractMediaFromHtml(html, shortcode)
      if (media) {
        debug.push(`帖子页(${label})：命中 ${shortcode}（${Math.round(html.length / 1024)}KB）`)
        return toResult({ success: false, platform: "instagram", link: url, debug }, media, `帖子页(${label})`)
      }
      debug.push(`帖子页(${label})：没有该帖子的媒体（${Math.round(html.length / 1024)}KB）`)
    } catch (error) {
      debug.push(`帖子页(${label})：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return null
}

// ─── 对外入口 ──────────────────────────────────────────

/**
 * 解析 Instagram 帖子（图片 / 视频 / 相册）。
 * 主通道是免登录的内嵌页；受限内容再用 Cookie 走 GraphQL / 私有 API / 登录态页面补救。
 */
export async function parseInstagramPost(url: string, cookie: string = ""): Promise<InstagramMediaResult> {
  const debug: string[] = []
  const result: InstagramMediaResult = { success: false, platform: "instagram", link: url, debug }

  const shortcode = instagramShortcode(url)
  if (!shortcode) {
    result.error = "无法从链接中提取 Instagram 短码"
    return result
  }
  const mediaId = shortcodeToMediaId(shortcode)
  const hasCookie = !!cookie.trim()
  debug.push(`短码 ${shortcode}（media_id ${mediaId}）${hasCookie ? "· 带 Cookie" : "· 未配置 Cookie"}`)

  const tried: InstagramMediaResult[] = []
  const collect = (r: InstagramMediaResult | null) => { if (r) tried.push(r); return r }

  collect(await tryEmbedPage(shortcode, debug))
  if (hasCookie) {
    collect(await tryGraphQL(shortcode, cookie, debug))
    collect(await tryPrivateApi(mediaId, shortcode, cookie, debug))
    collect(await tryPostPage(shortcode, url, cookie, debug))
  } else {
    collect(await tryPostPage(shortcode, url, cookie, debug))
  }

  const videoResult = tried.find((r) => r.success && r.video_url)
  if (videoResult) return videoResult
  const imageResult = tried.find((r) => r.success && (r.images?.length || 0) > 0)
  const videoPostButNoLink = tried.some((r) => r.mediaKind === "GraphVideo")
  if (videoPostButNoLink) {
    result.mediaKind = "GraphVideo"
    result.title = imageResult?.title
    result.author = imageResult?.author
    result.cover_url = imageResult?.cover_url || null
    result.needLogin = !hasCookie
    result.error = hasCookie
      ? "这是视频帖，但通道都没返回视频直链（可能内容受限）"
      : "这是视频帖 / 受限内容，匿名通道没返回直链：可到「设置 → 平台 Cookie → Instagram」填入 Cookie 再试"
    return result
  }
  if (imageResult) return imageResult

  result.needLogin = !hasCookie
  result.error = hasCookie
    ? "没有取到该帖子的媒体（可能已删除 / 私密账号 / Cookie 失效）"
    : "没有取到该帖子的媒体（可能已删除 / 私密账号 / 受限内容；可配 Instagram Cookie 再试）"
  return result
}
