/**
 * 抖音解析 / 去水印模块（移动端免签通道）
 *
 * 2026-10-13 真机实测结论（算法参考本机脚本「镜花水月」）：
 *  · 网页端 `/aweme/v1/web/aweme/detail/` 已被风控拦死
 *    → 403 `Blocked by ArgusSecurityPlugin / Uifid Not Found`，这就是旧版「能解析、下不了」的根因；
 *  · 移动端 `/aweme/v1/aweme/detail/` 只要 iid 用真实的 install_id，
 *    就完全免签名 / 免 Cookie / 免 uifid 能拿到数据，且 play_addr 直接是最高画质标准编码 CDN 直链；
 *  · ⚠️ 千万不要带 x-gorgon / x-argus 等签名头：实测带上反而会返空；
 *  · ⚠️ 不碰 bit_rate[]：里面大量是抖音自研编码（fourcc=bvc2），iOS 既不能播也不能存相册；
 *    需要那个分辨率时改用 play 接口的 ratio 参数拿同分辨率的标准编码版本。
 *
 * 该模块被 `index.tsx`（主界面）与 `intent.tsx`（分享面板）共用。
 */

import { fetch } from "scripting"

export interface DouyinMediaResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  video_url?: string | null
  /** 无水印下载候选（已按画质优先级排好） */
  videoUrls?: string[]
  /** play_addr.uri，用于 play 接口取指定画质 */
  videoUri?: string
  images?: string[]
  imagePreviews?: string[]
  cover_url?: string | null
  link?: string
  error?: string
  videoId?: string
  /** 逐步诊断信息（短链展开、接口状态、命中画质） */
  debug?: string[]
}

export interface DouyinCandidate {
  url: string
  label: string
}

/** 移动端 App UA（免签通道必须用它；用浏览器 UA 会被要求签名） */
export const DY_APP_UA = "Aweme/404017 CFNetwork/3896.100.1.2.1 Darwin/27.0.0"
/** 下载 CDN 文件时的 UA / Referer（与 镜花水月 一致，实测可用） */
export const DY_DOWNLOAD_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
export const DY_REFERER = "https://www.douyin.com/"

const DY_MOBILE_HOSTS = ["api5-normal-c-lq.amemv.com", "api.amemv.com"]
const DY_PLAY_HOSTS = ["api-play.amemv.com", "api5-normal-c-lq.amemv.com"]
const DY_DEVICE_ID = "1923489864614387"
const DY_INSTALL_ID = "7683339722235938341"
const DETAIL_TTL_MS = 60000

// ─── 工具 ──────────────────────────────────────────────

function normalizeUrl(url: string): string {
  return /^\/\//.test(url) ? "https:" + url : url
}

/** 从抖音链接提取作品 ID（支持 v.douyin.com 以外的全部形态） */
export function extractDouyinId(url: string): string | null {
  const patterns = [
    /(?:douyin|iesdouyin)\.com\/(?:share\/)?(?:video|note|slides|playlist)\/([0-9]+)/i,
    /(?:iesdouyin|douyin)\.com\/video\/([0-9]+)/i,
    /aweme_id[=:]([0-9]+)/i,
    /modal_id=([0-9]+)/i,
    /\/(?:video|note|slides)\/([0-9]{15,})/i,
  ]
  for (const pattern of patterns) {
    const m = url.match(pattern)
    if (m && m[1]) return m[1]
  }
  return null
}

/**
 * 展开短链（v.douyin.com / 任意分享跳转）。
 * 实测（2026-10-13）：v.douyin.com → 302/200 后落到
 * `https://www.iesdouyin.com/share/video/<id>/?from_ssr=1…` 或 `https://www.douyin.com/video/<id>`，
 * fetch 会自动跟随并可在 resp.url 拿到最终地址；万一没跟随，再从响应头 / 正文里兜。
 */
export async function expandDouyinShortLink(
  url: string,
  cookie?: string
): Promise<{ id: string | null; targetUrl: string; note: string }> {
  let id = extractDouyinId(url)
  if (id) return { id, targetUrl: url, note: `链接已含作品 ID：${id}` }

  if (!/v\.douyin|douyin\.com\/[A-Za-z0-9]{6,}$|iesdouyin/i.test(url)) {
    return { id: null, targetUrl: url, note: "不是可识别的抖音短链，且无法从链接中提取作品 ID" }
  }

  const headers: Record<string, string> = { "User-Agent": DY_DOWNLOAD_UA }
  if (cookie) headers["Cookie"] = cookie

  try {
    const resp = await fetch(url, { headers, timeout: 12 } as any)
    const finalUrl = String((resp as any).url || "")
    const location = String((resp.headers as any)?.get?.("Location") || (resp.headers as any)?.get?.("location") || "")
    for (const candidate of [finalUrl, location]) {
      const found = extractDouyinId(candidate)
      if (found) {
        return { id: found, targetUrl: candidate, note: `短链展开成功：${candidate.slice(0, 90)}` }
      }
    }
    // 兜底：从正文里找（部分短链返回的是带跳转信息的 HTML）
    const text = await resp.text().catch(() => "")
    const bodyId = extractDouyinId(text)
    if (bodyId) {
      return { id: bodyId, targetUrl: finalUrl || url, note: `从短链响应正文中提取到作品 ID：${bodyId}` }
    }
    return { id: null, targetUrl: finalUrl || url, note: `短链已访问但不含作品 ID（HTTP ${resp.status}，落点 ${finalUrl.slice(0, 80) || "空"}）` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { id: null, targetUrl: url, note: `短链展开失败：${message}` }
  }
}

// ─── 移动端免签接口 ────────────────────────────────────

/** 移动端公共参数（iid 必须是真实 install_id，否则接口会返空） */
export function dyMobileParams(): Record<string, string> {
  return {
    device_platform: "iphone", aid: "1128", channel: "App Store", app_name: "aweme",
    version_code: "40.4.0", version_name: "40.4.0",
    device_type: "iPhone17,3", os_version: "27.0.1",
    update_version_code: "40409917",
    iid: DY_INSTALL_ID, device_id: DY_DEVICE_ID,
  }
}

/** 按顺序尝试移动端主机；返回首个有内容的响应，同时带出每台主机的失败原因 */
async function dyMobileGet(
  path: string,
  extra: Record<string, string>,
  timeoutSeconds: number = 10
): Promise<{ text: string; host: string; notes: string[] }> {
  const params: Record<string, string> = { ...dyMobileParams(), ...extra }
  const query = Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&")
  const notes: string[] = []
  for (const host of DY_MOBILE_HOSTS) {
    try {
      const resp = await fetch(`https://${host}${path}?${query}`, {
        headers: { "User-Agent": DY_APP_UA, "Accept": "*/*" },
        timeout: timeoutSeconds,
      } as any)
      if (!resp.ok) {
        notes.push(`${host}: HTTP ${resp.status}`)
        continue
      }
      const text = await resp.text()
      if (text) return { text, host, notes }
      notes.push(`${host}: 空响应（可能被限流）`)
    } catch (error) {
      notes.push(`${host}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(notes.join("；") || "全部移动端主机均不可用")
}

let detailCache: { id: string; at: number; detail: any } | null = null

/**
 * 取作品详情（移动端免签，60 秒缓存）。
 * 失败时返回 note 说明真因：被平台过滤（core_dep）/ 主机报错 / 无数据。
 */
export async function fetchDouyinDetailMobile(
  awemeId: string
): Promise<{ detail: any | null; note: string }> {
  if (!awemeId) return { detail: null, note: "缺少作品 ID" }
  if (detailCache && detailCache.id === awemeId && Date.now() - detailCache.at < DETAIL_TTL_MS) {
    return { detail: detailCache.detail, note: "命中 60 秒详情缓存" }
  }
  try {
    const { text, host, notes } = await dyMobileGet("/aweme/v1/aweme/detail/", {
      aweme_id: awemeId,
      _rticket: String(Date.now()),
    })
    let data: any = null
    try {
      data = JSON.parse(text)
    } catch {
      return { detail: null, note: `详情响应不是 JSON（${host}，${text.slice(0, 60)}）` }
    }
    const detail = data?.aweme_detail
    if (detail) {
      detailCache = { id: awemeId, at: Date.now(), detail }
      const prefix = notes.length ? `${notes.join("；")} → ` : ""
      return { detail, note: `${prefix}${host} 详情正常` }
    }
    const reason = data?.filter_detail?.filter_reason
      ? `被平台过滤（filter_reason=${data.filter_detail.filter_reason}）`
      : `无 aweme_detail 字段（status_code=${data?.status_code ?? "?"}）`
    return { detail: null, note: `${host} ${reason}` }
  } catch (error) {
    return { detail: null, note: error instanceof Error ? error.message : String(error) }
  }
}

// ─── 选档 / 候选 ───────────────────────────────────────

/** 短边 = 宽高里小的那个；“1080p / 1440p”指的就是它，竖屏横屏都成立 */
function dyShortSide(addr: any): number {
  const w = addr?.width || 0
  const h = addr?.height || 0
  return w > 0 && h > 0 ? Math.min(w, h) : 0
}

/** playwm（带水印）→ play（无水印） */
function dyClipPlaywm(url: string): string {
  return url.includes("/playwm/") ? url.replace("/playwm/", "/play/") : url
}

/** 优先 CDN 直链（douyinvod / video/tos），其次才是需要 302 的 play 接口 */
function dyPreferDirect(urls: string[]): string[] {
  const direct = urls.filter((u) => u.includes("douyinvod.com") || u.includes("/video/tos/"))
  const rest = urls.filter((u) => !direct.includes(u))
  return [...direct, ...rest]
}

/** 标准编码档（play_addr 系列）按短边从高到低 */
function dyStandardAddrs(video: any): { key: string; urls: string[]; q: number }[] {
  const out: { key: string; urls: string[]; q: number }[] = []
  for (const key of ["play_addr", "play_addr_h264", "play_addr_265"]) {
    const addr = (video as any)?.[key]
    const urls = (addr?.url_list || []).filter((u: string) => typeof u === "string" && u.startsWith("http"))
    if (!urls.length) continue
    out.push({ key, urls, q: dyShortSide(addr) })
  }
  return out.sort((a, b) => b.q - a.q)
}

/** 作品最高分辨率（短边），含 bit_rate[] 里 iOS 用不了的档 —— 用于给 play 接口定 ratio 目标 */
function dyMaxShortSide(video: any): number {
  let max = 0
  const consider = (addr: any) => {
    if (!addr?.url_list?.length) return
    const q = dyShortSide(addr)
    if (q > max) max = q
  }
  consider(video?.play_addr)
  consider(video?.play_addr_h264)
  consider(video?.play_addr_265)
  if (Array.isArray(video?.bit_rate)) for (const br of video.bit_rate) consider(br?.play_addr)
  return max
}

/**
 * 无水印下载候选（按画质优先级）：
 *  ① 最高分辨率那档是自研编码（bvc2）时，先用 play 接口 ratio 拿同分辨率的标准编码版本；
 *  ② 标准编码档的 CDN 无水印直链（playwm → play，douyinvod / tos 优先）；
 *  ③ play 接口降级档（1080p / 720p）+ iesdouyin 保底。
 */
export function buildDouyinDownloadCandidates(video: any): DouyinCandidate[] {
  const out: DouyinCandidate[] = []
  const push = (raw: string, label: string) => {
    const clean = dyClipPlaywm(normalizeUrl(raw))
    if (!clean.startsWith("http")) return
    if (out.some((c) => c.url === clean)) return
    out.push({ url: clean, label })
  }

  const uri = video?.play_addr?.uri || video?.play_addr_h264?.uri || video?.play_addr_265?.uri || ""
  const ratioUrls = (target: number): DouyinCandidate[] =>
    uri && target > 0
      ? DY_PLAY_HOSTS.map((host) => ({
          url: `https://${host}/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=${target}p&line=0`,
          label: `play 接口 ${target}p`,
        }))
      : []

  const addrs = dyStandardAddrs(video)
  const best = addrs[0]
  const maxQ = dyMaxShortSide(video)

  if (best && maxQ > 0 && maxQ > best.q) {
    for (const c of ratioUrls(maxQ)) push(c.url, c.label)
  }
  for (const addr of addrs) {
    for (const url of dyPreferDirect(addr.urls)) push(url, `无水印${addr.q ? ` · ${addr.q}p` : ""}`)
  }
  for (const target of [1080, 720]) {
    for (const c of ratioUrls(target)) push(c.url, c.label)
  }
  if (uri) {
    push(
      `https://www.iesdouyin.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=720p&line=0&is_play_url=1&watermark=0&source=PackSourceEnum_PUBLISH`,
      "iesdouyin 720p 保底"
    )
  }
  return out
}

// ─── 对外入口：走移动端免签通道解析 ─────────────────────

/**
 * 解析一个抖音链接（短链 / 分享文案 / 网页链接都行）。
 * 只走免签通道：不依赖 Cookie（有 Cookie 也只是用于展开短链），不依赖 WebView。
 */
export async function parseDouyinViaMobile(
  url: string,
  cookie?: string
): Promise<DouyinMediaResult> {
  const debug: string[] = []
  const result: DouyinMediaResult = { success: false, platform: "douyin", link: url, debug }

  const expanded = await expandDouyinShortLink(url, cookie)
  debug.push(expanded.note)
  if (!expanded.id) {
    result.error = `无法获取作品 ID：${expanded.note}`
    return result
  }

  const awemeId = expanded.id
  result.videoId = awemeId
  result.link = `https://www.douyin.com/video/${awemeId}`

  const { detail, note } = await fetchDouyinDetailMobile(awemeId)
  debug.push(`作品详情：${note}`)
  if (!detail) {
    result.error = `抖音作品详情获取失败：${note}`
    return result
  }

  result.title = detail.desc || ""
  result.author = detail.author?.nickname || ""
  result.cover_url = detail.video?.cover?.url_list?.[0] || detail.video?.origin_cover?.url_list?.[0] || ""

  const imageList: string[] = (detail.images || [])
    .map((img: any) => (img.url_list || img.urlList || []).slice(-1)[0] || "")
    .filter(Boolean)
  if (imageList.length) {
    result.images = imageList
    result.imagePreviews = imageList
  }

  const video = detail.video
  const candidates = video ? buildDouyinDownloadCandidates(video) : []

  // 图文帖（无视频）：只返回图片
  if (!candidates.length) {
    if (!imageList.length) {
      result.error = "该作品既没有可下载的视频，也没有可保存的图片（可能是直播回放或已被平台限制）"
      return result
    }
    result.success = true
    debug.push(`图文帖：${imageList.length} 张图片`)
    return result
  }

  result.videoUrls = candidates.map((c) => c.url)
  result.video_url = candidates[0].url
  result.videoUri = video.play_addr?.uri || ""
  result.success = true
  debug.push(`无水印候选 ${candidates.length} 个，首选 ${candidates[0].label}`)
  return result
}
