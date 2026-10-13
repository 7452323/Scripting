// 红果短剧数据层
//
// 播放/详情走 **App 协议**（X-Gorgon 签名，非浏览器模拟）：
//   POST api5-normal-sinfonlineb.fqnovel.com/novel/player/multi_video_detail/v1/  → 全部分集
//   POST api5-normal-sinfonlineb.fqnovel.com/novel/player/video_model/v1/        → 各清晰度直链 + CENC 密钥
// 浏览/搜索走官网的 _ROUTER_DATA（服务端已渲染好的 JSON，无渲染开销）。

import { fetch } from "scripting"

const API_HOST = "https://api5-normal-sinfonlineb.fqnovel.com"
const WEB_HOST = "https://hongguoduanju.com"
const APP_UA = "com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)"
const WEB_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"

const GORGON_KEY = "44b9b9d9a4aef9fca493aa757ca3c2c4a496938f"
const DEVICE_KEY = "hongguo_device_v1"

const BASE_QUERY: Record<string, string> = {
  aid: "8662", app_name: "novelread", version_code: "73532", version_name: "7.3.5.32",
  manifest_version_code: "73532", update_version_code: "73532", channel: "update_64",
  device_platform: "android", os: "android", ssmix: "a", device_type: "25053RT47C",
  device_brand: "Redmi", language: "zh", os_api: "36", os_version: "16",
  resolution: "1280*2772", dpi: "520", ac: "wifi",
}

export type Drama = {
  id: string
  title: string
  cover: string
  intro: string
  episodeCount: number
  episodeLabel: string
  tags: string[]
  hot: string
  rank: number
  /** 以下是**榜单行**自带的、已经格式化好的文案（App 接口没有）：
   *  「评分9.3」「9487万热度」「198.5万收藏」「604.8万点赞」「新剧」…… */
  score?: string
  favorites?: string
  likes?: string
  statusTag?: string
}

export type HomeSection = { key: string; tabType: string; title: string; items: Drama[] }
export type Episode = { index: number; vid: string; duration: number; cover: string; summary: string }
export type DramaDetail = Drama & { episodes: Episode[] }
export type StreamOption = { url: string; quality: number; codec: string; spade: string }
export type CategoryInfo = { slug: string; name: string; tags: { slug: string; name: string }[] }
export type CategoryTag = { slug: string; name: string }
export type Page<T> = { items: T[]; page: number; totalPages: number }

export const CATEGORIES: CategoryInfo[] = [
  { slug: "real-drama", name: "真人剧", tags: [] },
  { slug: "comic-drama", name: "漫剧", tags: [] },
  { slug: "ai-drama", name: "AI剧", tags: [] },
  { slug: "comic", name: "漫画", tags: [] },
]

export const RANKS: { key: string; name: string }[] = [
  { key: "hot-drama", name: "总榜" },
  { key: "hot-real-drama", name: "真人剧" },
  { key: "hot-comic-drama", name: "漫剧" },
  { key: "hot-ai-drama", name: "AI剧" },
]

// ---------------------------------------------------------------- 工具

function deviceIdentity(): { deviceId: string; iid: string } {
  const saved = Storage.get<{ deviceId: string; iid: string }>(DEVICE_KEY)
  if (saved && saved.deviceId && saved.iid) return saved
  const make = () => String(Math.floor(Math.random() * 8000000000000000000) + 1000000000000000000)
  const created = { deviceId: make(), iid: make() }
  Storage.set(DEVICE_KEY, created)
  return created
}

function rol8(value: number, n: number): number {
  const v = value & 0xff
  return n ? (((v << n) | (v >> (8 - n))) & 0xff) : v
}

function rev8(value: number): number {
  let v = value & 0xff, r = 0
  for (let i = 0; i < 8; i++) { r = (r << 1) | (v & 1); v >>= 1 }
  return r
}

/** 经典 X-Gorgon（轻量版）。签名覆盖实际发送的 query 字节，顺序敏感。 */
function gorgonHeaders(url: string, body: Data | null): Record<string, string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = new Uint8Array(20)
  const q = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?") + 1) : ""
  const qmd5 = new Uint8Array(required(Crypto.md5(required(Data.fromString(q), "query 编码失败")), "摘要失败").toArrayBuffer())
  payload.set(qmd5.subarray(0, 4), 0)
  if (body) payload.set(new Uint8Array(required(Crypto.md5(body), "摘要失败").toArrayBuffer()).subarray(0, 4), 4)
  payload[12] = 0x00; payload[13] = 0x06; payload[14] = 0x0b; payload[15] = 0x1c
  payload[16] = (now >>> 24) & 0xff; payload[17] = (now >>> 16) & 0xff
  payload[18] = (now >>> 8) & 0xff; payload[19] = now & 0xff
  const key = new Uint8Array(20)
  for (let i = 0; i < 20; i++) key[i] = Number.parseInt(GORGON_KEY.substr(i * 2, 2), 16)
  for (let i = 0; i < 20; i++) payload[i] = payload[i] ^ key[i]
  for (let i = 0; i < 20; i++) {
    payload[i] = rev8(rol8(payload[i], 4) ^ payload[(i + 1) % 20]) ^ 0xff ^ 20
  }
  const sig = new Uint8Array(26)
  sig.set([0x84, 0x04, 0x40, 0x1c, 0x00, 0x00])
  sig.set(payload, 6)
  const headers: Record<string, string> = {
    "x-khronos": String(now),
    "x-gorgon": hex(sig),
    "x-ss-req-ticket": String(Date.now()),
  }
  if (body) headers["x-ss-stub"] = required(Crypto.md5(body), "摘要失败").toHexString().toUpperCase()
  return headers
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message)
  return value
}

function hex(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0")
  return s
}

/**
 * 「这个 id 在红果不存在」专用错误。
 *
 * ⚠️ 实测（2026-10-06）：红果对**不存在的 series_id** 统一回 `code≠0` + message **「服务异常」**
 *  （三个乱造的 series_id 全这样；空 id 则回「参数错误」；2019 年的老剧 id 反而正常）。
 *  所以 App 里看到「详情加载失败 · 服务异常」= 这条记录的 id 已经查不到了——
 *  典型来源是**收藏 / 历史 / 下载里存下来的老记录**（剧被下架或换了新 ID）。
 *  这类错是确定性的（重试无用），单独标出来 UI 才能给「可能已下架」这种能懂的提示。
 */
export class MissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MissingError"
  }
}

function looksMissing(message: string): boolean {
  return message.includes("服务异常") || message.includes("不存在") || message.includes("已下架")
}

/** 把接口报文翻译成人话（原始报文保留在后面，方便排查）。 */
function missingMessage(original: string): string {
  return `红果接口返回「${original}」：这个 id 在红果已经查不到了，通常是这部剧已下架、或换了一个新 ID。常见于早先收藏 / 看过的老记录 —— 可以从列表里移除它。`
}

/** 接口重试次数与间隔。
 *  ⚠️ 重试不是为了扛高频：实测正常时连打 40 次 + 10 并发都是 0 失败，
 *  它只是为了扛**瞬时抖动**（断网切换、5xx、空响应）。确定性的错（如「格式异常」）不重试。 */
const APP_ATTEMPTS = 3
const APP_RETRY_DELAYS = [400, 1000]

type ApiAttempt = { ok: true; data: any } | { ok: false; retry: boolean; error: Error }

/**
 * ⚠️⚠️ 本项目最坑的一个 bug（用户实报「第八季点进去服务异常」的真因）：
 *
 * 红果的 series_id / vid 是 **19 位数字**，而 JS 的安全整数上限只有 `2^53-1 ≈ 9.007e15`：
 * 只要它在 JSON 里以**数字**形式出现，`JSON.parse` 就会把它**四舍五入**。
 * 实测：`7691717179049249854` → `7691717179049250000`，而这串圆整后的 id 在红果是「查不到」的
 * → 详情接口回 `code≠0` +「服务异常」。
 *
 * 修法：parse 之前先把**裸的 16~20 位整数**在原始文本上加引号。
 * 16 位以上不可能是别的东西（时间戳 13 位、金额不会这么长），所以这个替换是安全的；
 * 已经在引号里的数字不会被匹配（前面是 `"`，不是 `: , [`）。
 */
export function parseJsonSafe(text: string): any {
  return JSON.parse(text.replace(/([:\[,]\s*)(\d{16,20})(?=\s*[,}\]])/g, "$1\"$2\""))
}

/** 上游偶尔会把数组字段给成对象/字符串/半个对象。
 *  `x ?? []` 只能挡 null/undefined，挡不住类型不符——直接 `.map` / `for...of` 会抛 TypeError
 *  把整个首页或详情页干掉。统一走这里。 */
function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => { setTimeout(() => resolve(), ms) })
}

/**
 * 请求超时兜底。
 *
 * ⚠️ 红果在网络卡住 / 直链过期时是**挂住连接**而不是报错（实测），
 * 没有超时的 `fetch` 会让详情页永远转圈、让自动修复一直卡住。
 * 用 `Promise.race` 而不是 AbortController（iOS 侧的 fetch 不一定认 signal）。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应）`)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      reason => { clearTimeout(timer); reject(reason) },
    )
  })
}

const API_TIMEOUT = 12000
const WEB_TIMEOUT = 15000

/** 单次请求（不重试）。把「能不能重试」也一并判定好，重试循环里不用再判断。 */
async function apiAttempt(url: string, body: Data): Promise<ApiAttempt> {
  try {
    const response = await withTimeout(fetch(url, {
      method: "POST",
      headers: {
        "user-agent": APP_UA,
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "x-xs-from-web": "0",
        "sdk-version": "2",
        ...gorgonHeaders(url, body),
      },
      body,
    }), API_TIMEOUT, "红果接口")
    if (!response.ok) {
      return { ok: false, retry: response.status >= 500 || response.status === 429, error: new Error(`红果接口返回 ${response.status}`) }
    }
    const text = await response.text()
    if (!text) return { ok: false, retry: true, error: new Error("红果接口返回空响应（可能被风控）") }
    let json: any
    try { json = parseJsonSafe(text) } catch { return { ok: false, retry: false, error: new Error("红果接口返回格式异常") } }
    if (String(json?.code ?? "0") === "0") return { ok: true, data: json.data }
    const message = String(json?.message ?? `红果接口错误码 ${json?.code}`)
    // 「服务异常」确定性是「id 不存在」，但万一撞上服务端抖动也给一次机会；风控/频繁这类更是该重试
    return { ok: false, retry: looksMissing(message) || message.includes("风控") || message.includes("频繁"), error: new Error(message) }
  } catch (reason) {
    // 网络层异常（断网 / 超时）→ 值得重试
    return { ok: false, retry: true, error: reason instanceof Error ? reason : new Error(String(reason)) }
  }
}

export async function appPost(path: string, payload: unknown): Promise<any> {
  const body = required(Data.fromString(JSON.stringify(payload)), "请求体编码失败")
  let lastError: Error = new Error("红果接口请求失败")
  let attempts = 0
  for (let attempt = 0; attempt < APP_ATTEMPTS; attempt++) {
    attempts = attempt + 1
    const identity = deviceIdentity()
    const params: Record<string, string> = {
      ...BASE_QUERY, device_id: identity.deviceId, iid: identity.iid, _rticket: String(Date.now()),
    }
    const query = Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join("&")
    const result = await apiAttempt(`${API_HOST}${path}?${query}`, body)
    if (result.ok) return result.data
    lastError = result.error
    if (!result.retry) break
    if (attempt < APP_ATTEMPTS - 1) await delay(APP_RETRY_DELAYS[attempt] ?? 800)
  }
  // 查不到的 id → 专用错误（UI 据此给「已下架」的提示与移除入口）
  if (looksMissing(lastError.message)) throw new MissingError(missingMessage(lastError.message))
  if (attempts > 1) throw new Error(`${lastError.message}（已重试 ${attempts - 1} 次）`)
  throw lastError
}

// ---------------------------------------------------------------- 详情 / 播放

/**
 * 详情 / 官网补充的**内存缓存**（5 分钟）。
 *
 * 为什么需要：从首页/资料库来回进出同一部剧时，原来每次都要重新等 0.5~1.5 秒的网络往返，
 * 这是「点进去卡一下」的主要来源。缓存只放**成功**结果（错误不缓存），
 * 下拉刷新 / 手动重试传 `{ fresh: true }` 绕过。
 */
const DETAIL_TTL = 5 * 60 * 1000
const DETAIL_CACHE_MAX = 24
const detailCache = new Map<string, { at: number; data: DramaDetail }>()
const webExtrasCache = new Map<string, { at: number; data: WebExtras | null }>()
const episodeExtrasCache = new Map<string, { at: number; data: EpisodeExtras | null }>()

function cacheGet<T>(map: Map<string, { at: number; data: T }>, key: string, fresh?: boolean): T | undefined {
  const hit = map.get(key)
  if (!hit || fresh || Date.now() - hit.at > DETAIL_TTL) return undefined
  return hit.data
}

function cacheSet<T>(map: Map<string, { at: number; data: T }>, key: string, data: T): void {
  map.set(key, { at: Date.now(), data })
  if (map.size <= DETAIL_CACHE_MAX) return
  let oldestKey = ""
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [k, v] of map) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k }
  if (oldestKey) map.delete(oldestKey)
}

/** 清掉缓存（不传 id 就全清）。改用「删除失效记录」那种真去网的路径时要先清。 */
export function clearDetailCache(seriesId?: string): void {
  if (seriesId) { detailCache.delete(seriesId); webExtrasCache.delete(seriesId); return }
  detailCache.clear(); webExtrasCache.clear()
}

export async function detail(seriesId: string, options?: { fresh?: boolean }): Promise<DramaDetail> {
  const cached = cacheGet(detailCache, seriesId, options?.fresh)
  if (cached) return cached
  const data = await appPost("/novel/player/multi_video_detail/v1/", {
    series_id: seriesId,
    biz_param: { need_all_video_definition: true, video_platform: 3 },
  })
  const entry = data?.[seriesId] ?? Object.values(data ?? {})[0]
  let info = (entry as any)?.video_data
  if (typeof info === "string") {
    try { info = parseJsonSafe(info) } catch { throw new Error("红果返回的分集数据格式异常") }
  }
  if (!info) throw new Error("红果没有返回该短剧详情")
  const list: any[] = asArray(info.video_list)
  // 既然已经成功拿到了详情，就把它记成「已验证」，季链那里不必再花一次请求去验
  verifiedSeries.add(String(info.series_id ?? seriesId))
  const episodes: Episode[] = list
    .map((item, i) => ({
      index: Number(item.vid_index ?? i + 1) || i + 1,
      vid: String(item.vid ?? ""),
      duration: Number(item.duration ?? 0) || 0,
      cover: String(item.episode_cover ?? item.cover ?? ""),
      summary: String(item.title ?? ""),
    }))
    .filter(item => item.vid)
    .sort((a, b) => a.index - b.index)
  const result: DramaDetail = {
    id: String(info.series_id ?? seriesId),
    title: String(info.series_title ?? ""),
    cover: String(info.series_cover ?? ""),
    intro: String(info.series_intro ?? ""),
    episodeCount: Number(info.episode_cnt ?? episodes.length) || episodes.length,
    episodeLabel: String(info.episode_right_text ?? (episodes.length ? `全${episodes.length}集` : "")),
    tags: asArray(info.secondary_infos).map((s: any) => String(s?.content ?? "")).filter((s: string) => s && s.length <= 6),
    hot: info.series_play_cnt ? `${Math.round(info.series_play_cnt / 10000)}万播放` : "",
    rank: 0,
    episodes,
  }
  cacheSet(detailCache, seriesId, result)
  return result
}

/** 把 12345 这种计数变成「1.2 万」（红果接口给的就是字符串数字）。 */
export function formatCount(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value).trim()
  const n = Number(raw)
  if (!raw || !Number.isFinite(n)) return raw
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return String(Math.round(n))
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number") return String(value)
  return ""
}

export type CelebrityInfo = { name: string; role: string; avatar: string }
export type ReviewInfo = { user: string; avatar: string; time: string; content: string; likes: string }

function mapReviews(value: unknown): ReviewInfo[] {
  const list = Array.isArray(value) ? value : []
  return list
    .map((item: any) => ({
      user: textOf(item?.user_name) || "红果用户",
      avatar: textOf(item?.user_avatar),
      time: textOf(item?.create_time),
      content: textOf(item?.content),
      likes: textOf(item?.digg_count),
    }))
    .filter((item: ReviewInfo) => item.content)
}

/** 详情页的**额外展示信息**：评分、收藏 / 点赞数、榜单位置、热度、演员、热门评论。 */
export type WebExtras = {
  rating?: string
  ratingCount?: string
  favourites?: string
  likes?: string
  rankLabel?: string
  hotText?: string
  celebrities: CelebrityInfo[]
  reviews: ReviewInfo[]
  reviewTotal?: string
}

/**
 * 详情页的补充信息 —— ⚠️ 这些**不在 App 接口里**。
 *
 * `multi_video_detail` 只给剧集 / 播放数据，而红果**官网**的 `/detail?series_id=` 页面的
 * `_ROUTER_DATA.loaderData.detail_page` 里带着：
 * - `seriesDetail.celebrities`（演员）+ `tags` / `episode_right_text` 等
 * - `seriesSocialInfo`（评分 / 收藏 / 点赞 / 榜单标签 / 热度 / `reviews` 热门评论）
 *
 * 所以这一块是**纯展示**的额外请求：失败就静默忽略，绝不影响播放。
 */
export async function webExtras(seriesId: string, options?: { fresh?: boolean }): Promise<WebExtras | null> {
  const cached = cacheGet(webExtrasCache, seriesId, options?.fresh)
  if (cached !== undefined) return cached
  const entry = loaderPage(loaderOf(await webGet(`/detail?series_id=${encodeURIComponent(seriesId)}`)), ["detail_page"])
  const series = entry?.seriesDetail
  const social = entry?.seriesSocialInfo
  if (!series && !social) { cacheSet(webExtrasCache, seriesId, null); return null }

  const celebrities: CelebrityInfo[] = (Array.isArray(series?.celebrities) ? series.celebrities : [])
    .map((item: any) => ({ name: textOf(item?.nickname), role: textOf(item?.sub_title), avatar: textOf(item?.avatar) }))
    .filter((item: CelebrityInfo) => item.name || item.avatar)

  const reviews: ReviewInfo[] = mapReviews(social?.reviews?.reviews)

  const rating = Number(social?.rating)
  const hot = social?.hot_score_data
  const extras: WebExtras = {
    rating: Number.isFinite(rating) && rating > 0 ? rating.toFixed(1) : undefined,
    ratingCount: textOf(social?.rating_count) || undefined,
    favourites: textOf(social?.series_favorite_count) || undefined,
    likes: textOf(social?.series_like_count) || undefined,
    rankLabel: textOf(social?.rank_label) || undefined,
    hotText: textOf(hot?.text) || undefined,
    celebrities,
    reviews,
    reviewTotal: textOf(social?.reviews?.total_count) || undefined,
  }
  const useful = extras.rating || extras.favourites || extras.likes || extras.rankLabel || extras.hotText || celebrities.length || reviews.length
  const result = useful ? extras : null
  cacheSet(webExtrasCache, seriesId, result)
  return result
}

/** 单集评论（**每集不一样**，各自有总数）。 */
export type EpisodeExtras = { reviews: ReviewInfo[]; total?: string }

/**
 * 某一集的评论：官网**播放页** `/player/{series_id}/{vid}` 的 SSR 里有 `episodeSocialInfo`。
 *
 * ⚠️ 实测（2026-10-06）：
 * - 详情页 `seriesSocialInfo.reviews` = **整剧精选**，固定 9 条（total 如 1074）
 * - 播放页 `episodeSocialInfo.reviews` = **本集精选**，固定 15 条，total 是本集真实总数
 *   （同一部剧第 1 集 23789 条 / 第 2 集 4521 条，名单完全不同）
 * - 两处都**不能翻页**（review_page / page / offset / index 等参数都试过，SSR 无反应）；
 *   上千条的完整列表只在 App 里。所以这里就是网页能看到的最多。
 *
 * 同样是纯展示：失败静默忽略。
 */
export async function episodeExtras(seriesId: string, vid: string, options?: { fresh?: boolean }): Promise<EpisodeExtras | null> {
  // 本集评论也缓存：同一集反复进出、或切集后切回来时不用重新拉 SSR 页（每页解析要逐字符扫整页）
  const key = `${seriesId}:${vid}`
  const cached = cacheGet(episodeExtrasCache, key, options?.fresh)
  if (cached !== undefined) return cached
  const page = loaderPage(
    loaderOf(await webGet(`/player/${encodeURIComponent(seriesId)}/${encodeURIComponent(vid)}`)),
    ["player_(series_id)/(vid)/page", "player_"],
  )
  const social = page?.episodeSocialInfo
  const reviews = mapReviews(social?.reviews?.reviews)
  const total = textOf(social?.reviews?.total_count) || undefined
  const result = reviews.length || total ? { reviews, total } : null
  cacheSet(episodeExtrasCache, key, result)
  return result
}

export async function streams(vid: string): Promise<StreamOption[]> {
  // 播放地址缓存：同一集在几分钟内会被「预取 + 真正切过去」连着问两次，
  // 缓存后第二次不再打签名接口（省一个往返，也是切集卡顿的来源之一）。
  const hit = streamCache.get(vid)
  if (hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.options
  const pending = streamPending.get(vid)
  if (pending) return await pending
  const task = fetchStreams(vid)
  streamPending.set(vid, task)
  try {
    const options = await task
    streamCache.set(vid, { at: Date.now(), options })
    if (streamCache.size > STREAM_CACHE_MAX) {
      const oldest = streamCache.keys().next().value
      if (oldest !== undefined) streamCache.delete(oldest)
    }
    return options
  } finally {
    streamPending.delete(vid)
  }
}

/** 播放地址缓存（只是接口结果，不占多少内存）。 */
const STREAM_TTL_MS = 5 * 60 * 1000
const STREAM_CACHE_MAX = 40
const streamCache = new Map<string, { at: number; options: StreamOption[] }>()
const streamPending = new Map<string, Promise<StreamOption[]>>()

async function fetchStreams(vid: string): Promise<StreamOption[]> {
  const data = await appPost("/novel/player/video_model/v1/", {
    video_id: vid,
    content_type: 1,
    biz_param: { need_all_video_definition: true, video_platform: 3 },
  })
  let model = data?.video_model
  if (typeof model === "string") {
    try { model = parseJsonSafe(model) } catch { throw new Error("红果返回的播放地址格式异常") }
  }
  const rows: any[] = asArray(model?.video_list)
  const out: StreamOption[] = []
  for (const row of rows) {
    const url = String(row.main_url ?? "").trim()
    if (!url.startsWith("http")) continue
    const meta = row.video_meta ?? {}
    const digits = String(meta.definition ?? "").replace(/[^0-9]/g, "")
    out.push({
      url,
      quality: digits ? Number(digits) : 0,
      codec: String(meta.codec_type ?? ""),
      spade: String((row.encrypt_info ?? {}).spade_a ?? ""),
    })
  }
  if (!out.length) throw new Error("红果没有返回可播放的地址")
  return out.sort((a, b) => a.quality - b.quality)
}

/** 选择就近清晰的档位。
 *  注：codec_type 的 bytevc1 / bytevc2 实测 stsd 都是 hvc1（HEVC），iOS 均可硬解，
 *  所以不做编码过滤，只按体积与清晰度权衡。 */
export function pickStream(options: StreamOption[], preferred = 480): StreamOption {
  if (!options.length) throw new Error("没有可用的清晰度")
  if (preferred <= 0) return options[options.length - 1]
  return options.reduce((best, current) =>
    Math.abs(current.quality - preferred) < Math.abs(best.quality - preferred) ? current : best, options[0])
}

// ---------------------------------------------------------------- 网页浏览（SSR JSON）

function extractJson(html: string, marker: string): any {
  const at = html.indexOf(marker)
  if (at < 0) return null
  const start = html.indexOf("{", at)
  if (start < 0) return null
  let depth = 0, inString = false, escaped = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        try { return parseJsonSafe(html.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function loaderOf(html: string): Record<string, any> {
  const data = extractJson(html, "_ROUTER_DATA")
  return (data?.loaderData ?? {}) as Record<string, any>
}

function loaderPage(loader: Record<string, any>, prefixes: string[]): any {
  for (const name of prefixes) {
    const value = loader[name]
    if (value && typeof value === "object" && Object.keys(value).length) return value
  }
  for (const key of Object.keys(loader)) {
    for (const name of prefixes) {
      const stem = name.replace(/\$$/, "")
      const value = loader[key]
      if (stem && key.startsWith(stem) && value && typeof value === "object" && Object.keys(value).length) return value
    }
  }
  return {}
}

async function webGet(path: string, userAgent = WEB_UA): Promise<string> {
  const response = await withTimeout(fetch(WEB_HOST + path, {
    headers: { "user-agent": userAgent, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": "zh-CN,zh;q=0.9" },
  }), WEB_TIMEOUT, "红果官网")
  if (!response.ok) throw new Error(`官网返回 ${response.status}`)
  return await response.text()
}

function htmlDecode(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

function toDrama(raw: any, category = ""): Drama | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw.video_data && typeof raw.video_data === "object" ? raw.video_data : raw
  const id = String(data.series_id_str ?? data.series_id ?? raw.series_id_str ?? raw.series_id ?? data.id ?? raw.id ?? "")
  if (!/^\d{6,}$/.test(id)) return null
  // 榜单接口没有 episode_cnt，但它给了完整的 episodeVids / vid_list，长度就是集数
  const vidList: any[] = Array.isArray(data.vid_list) ? data.vid_list
    : Array.isArray(data.episodeVids) ? data.episodeVids
    : Array.isArray(raw.episodeVids) ? raw.episodeVids
    : Array.isArray(raw.vid_list) ? raw.vid_list
    : []
  const count = Number(data.episode_cnt ?? raw.episode_cnt ?? data.series_episode_info?.episode_cnt ?? 0) || vidList.length
  const label = count ? `共 ${count} 集` : String(data.episode_right_text ?? raw.episode_right_text ?? "")
  const tags = asArray(data.category_list ?? data.tags ?? raw.tags).map((t: any) => String(t?.name ?? t ?? "")).filter(Boolean)
  // 榜榜单行带的是「评分9.3 / 9487万热度 / 198.5万收藏 / 604.8万点赞」这种**已格式化好的文案**，
  // 以前全被丢掉 → 榜单上只剩一个「No.1」。这里原样保留，UI 直接用。
  const text = (value: unknown) => String(value ?? "").trim()
  const score = text(raw.scoreText ?? data.scoreText ?? data.series_score).replace(/^评分\s*/, "").replace(/\s*分$/, "") || undefined
  const heat = text(raw.heatText ?? data.heatText ?? data.hot_score_data?.text ?? raw.hot_score_data?.text) || undefined
  const favorites = text(raw.favoriteText ?? data.favoriteText) || undefined
  const likes = text(raw.likeText ?? data.likeText) || undefined
  const statusTag = text(Array.isArray(raw.statusTags) ? raw.statusTags[0] : raw.statusTags) || undefined
  return {
    id,
    title: String(data.series_title ?? data.series_name ?? data.title ?? raw.series_name ?? raw.title ?? id),
    cover: String(data.series_cover ?? data.cover ?? raw.series_cover ?? ""),
    intro: String(data.series_intro ?? data.video_desc ?? raw.series_intro ?? ""),
    episodeCount: count,
    episodeLabel: label,
    tags: tags.slice(0, 6),
    hot: heat ?? "",
    rank: Number(raw.rank ?? 0) || 0,
    score,
    favorites,
    likes,
    statusTag,
  }
}

export async function home(): Promise<HomeSection[]> {
  return (await homeFeed()).sections
}

export type Banner = { id: string; title: string; cover: string; tags: string[]; intro: string }
export type HomeFeed = { sections: HomeSection[]; banners: Banner[] }

function sectionsOf(page: any): HomeSection[] {
  const sections: HomeSection[] = []
  for (const section of asArray(page.homeSections)) {
    const items = asArray(section?.video_list).map((v: any) => toDrama(v)).filter(Boolean) as Drama[]
    if (items.length) sections.push({
      key: String(section.tab_type ?? sections.length),
      tabType: String(section.tab_type ?? ""),
      title: String(section.tab_name ?? "推荐"),
      items,
    })
  }
  return sections
}

/**
 * 首页顶部轮播数据。
 * 实测（2026-10）`page.mBannerList` 5 条（移动端）/ `bannerList` 4 条（PC 版）。
 * ⚠️ 每张 `background_cover` 是 **竖版 1170×2160** 海报（比例 1:1.846）——官方 H5 的
 *    容器高度就是图片自然高度（1rem=10vw，18.46154rem），即**不裁切**地铺满整宽，
 *    同时底部叠渐变 + 另一张「剧名图」`title_link`(960×540)。这里只取海报当底图，剧名用文字画。
 */
function bannersOf(page: any): Banner[] {
  const mobile: any[] = Array.isArray(page?.mBannerList) ? page.mBannerList : []
  const desktop: any[] = Array.isArray(page?.bannerList) ? page.bannerList : []
  const rows = mobile.length ? mobile : desktop
  const out: Banner[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = String(row?.series_id ?? "").trim()
    const cover = String(row?.background_cover ?? row?.background_cover_pc ?? row?.series_cover ?? "").trim()
    if (!/^\d{6,}$/.test(id) || !cover.startsWith("http") || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      title: String(row?.series_name ?? "").trim(),
      cover,
      tags: (Array.isArray(row?.tags) ? row.tags : []).map((t: any) => String(t?.name ?? t ?? "")).filter(Boolean).slice(0, 3),
      intro: String(row?.series_intro ?? "").trim(),
    })
  }
  return out
}

/** 首页一次取全：板块流 + 顶部轮播（同一份 SSR JSON，只发一次请求）。 */
export async function homeFeed(): Promise<HomeFeed> {
  const page = loaderOf(await webGet("/")).page ?? {}
  const sections = sectionsOf(page)
  if (!sections.length) throw new Error("官网没有返回首页内容")
  return { sections, banners: bannersOf(page) }
}

export async function category(slug: string, tag: string, page = 1): Promise<Page<Drama> & { tags: { slug: string; name: string }[] }> {
  const path = `/category/${slug}${tag ? "/" + tag : ""}?page=${Math.max(1, page)}`
  const data = loaderPage(loaderOf(await webGet(path)), ["category_$", "category_page", "category_"])
  const items = asArray(data.recommendList).map((v: any) => toDrama(v)).filter(Boolean) as Drama[]
  const rows: any[] = asArray(data.selectorList)
  const tags: { slug: string; name: string }[] = []
  for (const row of rows) for (const item of asArray(row?.items)) {
    tags.push({ slug: String(item.selector_item_id ?? ""), name: String(item.show_name ?? "") })
  }
  return { items, page: Number(data.pagination?.pageNum ?? page) || page, totalPages: Number(data.pagination?.totalPages ?? 1) || 1, tags }
}

export async function rank(key: string, page = 1): Promise<Page<Drama>> {
  const html = await webGet(`/rank/${key}?page=${Math.max(1, page)}`, BOT_UA)
  let rows: any[] = []
  let totalPages = 1
  const direct = loaderPage(loaderOf(html), [`rank_${key}/page`, `rank_${key}`, "rank_"])
  const content = direct.content && Object.keys(direct.content).length ? direct.content : direct
  if (asArray(content.rankList).length) {
    rows = asArray(content.rankList)
    totalPages = Number(content.pagination?.totalPages ?? 1) || 1
  } else {
    // 部分页面把榜单数据放在 runWindowFn 的 data-fn-args 里
    const match = html.match(/data-fn-args=(['"])([\s\S]*?)\1/)
    if (match) {
      try {
        const args = parseJsonSafe(htmlDecode(match[2]))
        const payload = Array.isArray(args) ? args[args.length - 1] : null
        rows = asArray(payload?.rankList)
        totalPages = Number(payload?.pagination?.totalPages ?? 1) || 1
      } catch { /* 忽略 */ }
    }
  }
  const items = rows.map((row: any) =>
    toDrama({ ...row, series_id: row.seriesId ?? row.id, series_title: row.title, series_cover: row.cover, series_intro: row.description })
  ).filter(Boolean) as Drama[]
  if (!items.length) throw new Error("榜单暂时没有数据")
  return { items, page, totalPages }
}

/** 四个频道各自的「题材」标签（红果站内真实分类）。取一次缓存 10 分钟。 */
let tagCache: { at: number; groups: CategoryInfo[] } | null = null
export async function allCategoryTags(force = false): Promise<CategoryInfo[]> {
  if (!force && tagCache && Date.now() - tagCache.at < 600000) return tagCache.groups
  const groups = await Promise.all(CATEGORIES.map(async item => {
    try {
      const page = await category(item.slug, "", 1)
      return { slug: item.slug, name: item.name, tags: page.tags }
    } catch {
      return { slug: item.slug, name: item.name, tags: [] }
    }
  }))
  tagCache = { at: Date.now(), groups }
  return groups
}

export async function search(keyword: string): Promise<Drama[]> {
  const word = keyword.trim()
  if (!word) return []
  const data = loaderPage(loaderOf(await webGet("/search/" + encodeURIComponent(word))), ["search_(keyword)/page", "search_"])
  if (data.isSuccess === false) throw new Error("官网搜索暂时不可用")
  const rows: any[] = asArray(data.searchList)
  const out: Drama[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const drama = toDrama(row, "短剧")
    if (drama && !seen.has(drama.id)) { seen.add(drama.id); out.push(drama) }
  }
  return out
}

// ---------------------------------------------------------------- 季（跨季连播）
//
// 红果的详情接口里**没有任何「季关联」字段**（seriesDetail 只有基础字段），
// 所以季与季只能靠**标题**关联：
//   1. 剥掉「第X季/第X部」得到剧名基名与季号；
//   2. 用基名搜一次，把基名相同的兄弟季全收进来（站内搜索硬上限 10 条）；
//   3. 遇到没被搜到的季（如万妖图录传 13 季只会回 10 条），
//      再用「{基名}第N季」定向搜——实测目标季必定是第 1 条。

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_TEXT = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"]

function cnToNumber(text: string): number {
  if (!text) return 0
  if (/^\d+$/.test(text)) return Number(text)
  if (text === "十") return 10
  const at = text.indexOf("十")
  if (at < 0) return CN_DIGIT[text] ?? 0
  const head = at === 0 ? 1 : (CN_DIGIT[text[0]] ?? 0)
  const tail = at === text.length - 1 ? 0 : (CN_DIGIT[text[at + 1]] ?? 0)
  return head * 10 + tail
}

export function numberToCn(value: number): string {
  if (value < 10) return CN_TEXT[value]
  if (value === 10) return "十"
  if (value < 20) return "十" + CN_TEXT[value - 10]
  const tens = Math.floor(value / 10), ones = value % 10
  return CN_TEXT[tens] + "十" + (ones ? CN_TEXT[ones] : "")
}

/** 去掉空白与中英标点，用于跨季名对齐（红果的标题并不统一，带不带冒号都有）。 */
export function normalizeTitle(title: string): string {
  return title.replace(/[\s：:！!？?，,。.、·・\-—_…~「」『』《》〈〉（）()\[\]【】'"“”‘’]/g, "").toLowerCase()
}

export type SeasonInfo = { base: string; season: number; hasMarker: boolean }

/** 从标题里抽出「剧名基名 + 季号」。 */
export function parseSeason(title: string): SeasonInfo {
  const text = title.trim()
  const marker = /第\s*(十[一二三四五六七八九]?|[一二三四五六七八九]|\d{1,3})\s*(季|部|辑)/g
  let match: RegExpExecArray | null = null
  let last: RegExpExecArray | null = null
  while ((match = marker.exec(text)) !== null) last = match
  if (last) {
    const season = cnToNumber(last[1])
    if (season >= 1 && season <= 99) {
      const base = text.slice(0, last.index) + text.slice(last.index + last[0].length)
      // 「持械入宋：第一季」剥完会留下尾冒号，去掉尾部分隔符再当基名用
      return { base: base.replace(/[\s：:·・\-—_]+$/, "").trim(), season, hasMarker: true }
    }
  }
  // 没有「第X季」的写法：结尾 1~2 位数字（例：美颜系统开挂，大佬全跪下2）
  const tail = /^(.*[^\d])(\d{1,2})$/.exec(text)
  if (tail && normalizeTitle(tail[1]).length >= 4) {
    const season = Number(tail[2])
    if (season >= 2 && season <= 30) return { base: tail[1].trim(), season, hasMarker: false }
  }
  return { base: text, season: 1, hasMarker: false }
}

export type SeasonRecord = { id: string; title: string; season: number }

const seasonCache = new Map<string, Map<number, SeasonRecord>>()

function remember(baseKey: string, record: SeasonRecord): void {
  let chain = seasonCache.get(baseKey)
  if (!chain) { chain = new Map<number, SeasonRecord>(); seasonCache.set(baseKey, chain) }
  if (!chain.has(record.season)) chain.set(record.season, record)
}

export function cachedSeasons(title: string): SeasonRecord[] {
  const info = parseSeason(title)
  const chain = seasonCache.get(normalizeTitle(info.base))
  if (!chain) return []
  return [...chain.values()].sort((a, b) => a.season - b.season)
}

/**
 * 本次会话里已确认「能打开」/「打不开」的 series_id。
 *
 * ⚠️ 存在的意义：季链是拿「基名 + 季号」去站内搜索**猜**出来的，
 *  猜到的条目可能是已下架 / 已改 ID 的（详情接口对这类 id 一律回「服务异常」）。
 *  直接把猜到的条目列进「季」那排，用户就会看见一个永远打不开的季。
 *  所以：**先验证、再收录**——「没有的就不加进去」。
 */
const verifiedSeries = new Set<string>()
const deadSeries = new Set<string>()

/** 一个 series_id 的三种状态：
 *  - `"alive"`　能打开且至少有 1 集
 *  - `"missing"` **确认**不存在（上游回「服务异常」）—— 只有这种才允许判死
 *  - `"unknown"` 断网 / 超时 / 上游抖动 —— 什么都不做，下次再试
 *
 *  ⚠️ 一定要区分后两者：以前把它们压成一个 `boolean`，于是「飞行模式下点一次
 *  「检查失效记录」」会把收藏和历史当成「确实已下架」逐条删掉（不可逆的数据丢失）。 */
export type SeriesState = "alive" | "missing" | "unknown"

/** 这个 series_id 真的能打开吗（能打开且至少有 1 集才算数）。
 *  ⚠️ 只有「这个 id 不存在」（MissingError）才算 missing；断网这类瞬时失败一律 unknown，
 *  既不写黑名单、也不让调用方删数据。 */
export async function seriesExists(id: string): Promise<SeriesState> {
  // ⚠️ dead 必须在 verified 之前判：`detail` 拿到详情时就会写 verifiedSeries，
  // 而「详情成功但一集都没有」又会写 deadSeries——同一个 id 可能两个集合都在，
  // 先看 verified 就会出现「第一次判死、第二次判活」的翻转。
  if (deadSeries.has(id)) return "missing"
  if (verifiedSeries.has(id)) return "alive"
  try {
    // ⚠️ 必须绕过缓存：这个函数就是用来判断「红果上还有没有这部剧」的，
    //    吃了详情缓存就会永远判「还在」，一键清理会彻底失效。
    const data = await detail(id, { fresh: true })
    if (!data.episodes.length) { deadSeries.add(id); return "missing" }
    verifiedSeries.add(id)
    return "alive"
  } catch (reason) {
    if (reason instanceof MissingError) { deadSeries.add(id); return "missing" }
    return "unknown"
  }
}

/** 并发（小池）验证一批候选，保持原顺序。selfId 直接放行（调用方已经加载过它了）。 */
async function verifiedOnly<T extends { id: string }>(records: T[], selfId: string, pool = 4): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < records.length; i += pool) {
    const slice = records.slice(i, i + pool)
    const keep = await Promise.all(slice.map(async record => (record.id === selfId || (await seriesExists(record.id)) === "alive") ? record : null))
    for (const record of keep) if (record) out.push(record)
  }
  return out
}

/**
 * 记录里的 id 失效时的**自动修复**：拿剧名回站内再找一次。
 *
 * 现实来由：老版本把 19 位 id 当 JS 数字解析过（见 `parseJsonSafe`），
 * 存进收藏 / 历史的 id 是被四舍五入过的，这串在红果查不到 → 点开就「服务异常」。
 * 同名剧还在，重新搜一次就能把记录接回去（比让用户手动删掉好得多）。
 */
export async function repairDrama(record: { id: string; title: string }): Promise<Drama | null> {
  const wanted = parseSeason(record.title)
  const wantedBase = normalizeTitle(wanted.base)
  try {
    const list = await search(record.title)
    for (const item of list) {
      if (item.id === record.id) continue
      const parsed = parseSeason(item.title)
      if (normalizeTitle(parsed.base) !== wantedBase || parsed.season !== wanted.season) continue
      if ((await seriesExists(item.id)) !== "alive") continue
      return item
    }
  } catch { /* 修不好就走原来的失效流程 */ }
  return null
}

/** 用基名搜一次，把同基名的兄弟季全部收进缓存。 */
export async function discoverSeasons(title: string, selfId: string): Promise<SeasonRecord[]> {
  const info = parseSeason(title)
  const baseKey = normalizeTitle(info.base)
  const chain = seasonCache.get(baseKey)
  if (chain && chain.size > 1) return [...chain.values()].sort((a, b) => a.season - b.season)
  remember(baseKey, { id: selfId, title, season: info.season })
  try {
    const list = await search(info.base)
    const found: SeasonRecord[] = []
    for (const drama of list) {
      const parsed = parseSeason(drama.title)
      if (normalizeTitle(parsed.base) !== baseKey) continue
      if (drama.id === selfId || found.some(item => item.id === drama.id)) continue
      found.push({ id: drama.id, title: drama.title, season: parsed.season })
    }
    // ⚠️ 先验证再收录：只把确实能打开（且有集数）的季写进链里
    for (const record of await verifiedOnly(found, selfId)) remember(baseKey, record)
  } catch { /* 季链发现失败不该影响播放 */ }
  return cachedSeasons(title)
}

/** 找第 season 季；缓存里没有就用「{基名}第N季」定向搜一次。 */
export async function findSeason(title: string, selfId: string, season: number): Promise<SeasonRecord | null> {
  const info = parseSeason(title)
  const baseKey = normalizeTitle(info.base)
  const cached = seasonCache.get(baseKey)?.get(season)
  if (cached && (await seriesExists(cached.id)) === "alive") return cached
  if (season === info.season) {
    const record = { id: selfId, title, season }
    remember(baseKey, record)
    return record
  }
  try {
    const list = await search(`${info.base}第${numberToCn(season)}季`)
    for (const drama of list) {
      const parsed = parseSeason(drama.title)
      if (normalizeTitle(parsed.base) !== baseKey) continue
      if (parsed.season !== season) continue
      // ⚠️ 搜到的条目也要验证：搜索结果里可能有已下架的
      if ((await seriesExists(drama.id)) !== "alive") continue
      const record = { id: drama.id, title: drama.title, season }
      remember(baseKey, record)
      return record
    }
  } catch { /* ignore */ }
  return null
}
