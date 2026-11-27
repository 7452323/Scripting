import { fetch } from "scripting"
import type { Cloud115Config } from "./config"
import type { RemoteMedia, HomeCard, HomeShelf } from "../types"
import { loadHistory, loadScrapeLibrary, type ScrapeEntry } from "../storage"
import { buildMediaGroups, groupKeyOf, type MediaGroup } from "./mediaGroups"
import { m115Decode, m115Encode, m115RandomKey } from "./m115"

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
/** 取直链/播放必须用 115 客户端 UA（官方接口会按 UA 判定客户端类型） */
const UA_115BROWSER = "Mozilla/5.0 115Browser/27.0.5.7"

function headers(cookie: string): Record<string, string> {
  return {
    "User-Agent": UA,
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
    Referer: "https://115.com/",
  }
}

export async function cloud115Check(config: Cloud115Config): Promise<string> {
  if (!config.cookie.trim()) throw new Error("请填写 115 Cookie")

  const res2 = await fetch("https://webapi.115.com/files?offset=0&limit=1&show_dir=1", {
    headers: headers(config.cookie),
    timeout: 20,
  })
  const text = await res2.text().catch(() => "")
  if (!(text || "").trim().startsWith("{")) {
    throw new Error("115 返回了风控页面（请求过于频繁），过一会儿再试")
  }
  let data2: any = null
  try {
    data2 = JSON.parse(text)
  } catch {}
  if (data2 && data2.state === true) return "Cookie 有效"
  throw new Error(data2?.error || data2?.msg || "Cookie 无效或已过期")
}

/** 空间：返回 used/total 字节 */
export async function cloud115Space(
  config: Cloud115Config
): Promise<{ used: number; total: number }> {
  if (!config.cookie.trim()) throw new Error("请先配置 115 Cookie")

  // 尝试多个接口
  const tries = [
    "https://webapi.115.com/user/info",
    "https://proapi.115.com/app/user_info",
    "https://webapi.115.com/files/index_info",
  ]

  for (const url of tries) {
    try {
      const res = await fetch(url, { headers: headers(config.cookie) })
      const data = await res.json().catch(() => null)
      if (!data) continue

      // 常见字段
      const used =
        Number(
          data?.data?.space_info?.used_size ??
            data?.data?.used ??
            data?.data?.size_total_use ??
            data?.space_used ??
            data?.data?.rt_space_info?.all_total?.size ??
            0
        ) || 0
      const total =
        Number(
          data?.data?.space_info?.all_total ??
            data?.data?.total ??
            data?.data?.size_total ??
            data?.space_total ??
            data?.data?.rt_space_info?.all_total?.size ??
            0
        ) || 0

      // index_info 结构
      const space = data?.data?.space_info || data?.data?.rt_space_info
      if (space) {
        const u = Number(space.all_use?.size || space.used_size || space.use_size || used) || 0
        const t = Number(space.all_total?.size || space.all_total || total) || 0
        if (t > 0) return { used: u, total: t }
      }

      if (total > 0) return { used, total }
    } catch {}
  }

  throw new Error("无法获取 115 空间信息")
}

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m3u8|ts|flv|wmv|m4v|webm|rmvb|iso)$/i
const VIDEO_ICO = /^(mp4|mkv|avi|mov|m3u8|ts|flv|wmv|m4v|webm|rmvb|iso)$/i

export interface Cloud115Entry {
  kind: "folder" | "video"
  /** 文件夹用 cid，视频用 pickCode */
  id: string
  name: string
  size: number
}

/**
 * ⚠️ 115 的 `fc` 不是文件夹标志（实测：文件夹 fc=0 且带 cid；文件 fc=1 且带 fid+sha）。
 * 文件夹 = 有 cid、没有 fid/sha；文件 = 有 fid（+sha）。
 */
function isFolderItem(f: any): boolean {
  if (!f) return false
  if (f.fid || f.sha) return false
  return !!(f.cid || f.cid_)
}

function toEntry(f: any): Cloud115Entry | null {
  const name = String(f?.n || f?.file_name || "")
  if (!name) return null

  if (isFolderItem(f)) {
    const cid = String(f.cid || f.cid_ || "")
    if (!cid) return null
    return { kind: "folder", id: cid, name, size: 0 }
  }

  const pickCode = String(f.pc || f.pick_code || "")
  if (!pickCode) return null
  const ico = String(f.ico || "").toLowerCase()
  if (!VIDEO_EXT.test(name) && !VIDEO_ICO.test(ico)) return null
  return { kind: "video", id: pickCode, name, size: Number(f.s || f.file_size || 0) }
}

/** 目录缓存：减少重复请求（115 对高频访问会回 405 风控页） */
const listCache = new Map<string, { at: number; entries: Cloud115Entry[] }>()
const LIST_TTL = 60000

/** 全局串行限速：115 的风控对突发请求很敏感（实测连发几十次就回 405 HTML） */
let last115At = 0
let chain: Promise<unknown> = Promise.resolve()
let minGap = 350

/** 遇到风控就自适应退避，避免把 IP 打进黑名单 */
function bumpGap() {
  minGap = Math.min(2500, Math.round(minGap * 2))
}

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last115At + minGap - Date.now()
    if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait))
    last115At = Date.now()
    return fn()
  })
  chain = run.catch(() => undefined)
  return run
}

/** 请求一页目录；非 JSON（HTML 风控页 / 405）给出可读错误 */
async function fetchDirPage(
  cookie: string,
  cid: string,
  offset: number,
  limit: number
): Promise<any> {
  const url =
    `https://webapi.115.com/files?aid=1&cid=${encodeURIComponent(cid)}&o=user_ptime&asc=0` +
    `&offset=${offset}&show_dir=1&limit=${limit}&snap=0&natsort=1&format=json`
  const res = await schedule(() =>
    fetch(url, { headers: headers(cookie), timeout: 20 })
  )
  const text = await res.text()
  const trimmed = (text || "").trim()

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed)
    } catch {}
  }

  if (res.status === 405 || res.status === 403 || /<html/i.test(trimmed)) {
    // 风控页：自适应退避后重试一次，仍失败才报错
    bumpGap()
    await new Promise<void>(resolve => setTimeout(resolve, minGap * 2))
    const retry = await schedule(() =>
      fetch(url, { headers: headers(cookie), timeout: 20 })
    )
    const text2 = ((await retry.text().catch(() => "")) || "").trim()
    if (text2.startsWith("{")) {
      try {
        return JSON.parse(text2)
      } catch {}
    }
    throw new Error("115 返回了风控页面（请求过于频繁），过一会儿再试")
  }
  throw new Error(`115 接口异常（HTTP ${res.status}）`)
}

/** 115 目录浏览：返回文件夹 + 视频（分页拉全，文件夹在前） */
export async function cloud115ListEntries(
  config: Cloud115Config,
  cid = "0",
  limit = 200
): Promise<Cloud115Entry[]> {
  if (!config.cookie.trim()) throw new Error("请先配置 115 Cookie")

  const cacheKey = `${cid}|${limit}`
  const cached = listCache.get(cacheKey)
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.entries

  const out: Cloud115Entry[] = []
  const pageSize = 100
  let offset = 0
  let total = -1

  for (let page = 0; page < 10; page++) {
    const data = await fetchDirPage(config.cookie, cid, offset, pageSize)
    if (!data || data.state !== true) {
      throw new Error(data?.error || data?.msg || "115 目录读取失败（Cookie 可能已过期）")
    }

    const list: any[] = Array.isArray(data.data) ? data.data : []
    total = Number(data.count ?? list.length)
    for (const f of list) {
      const entry = toEntry(f)
      if (entry) out.push(entry)
    }

    offset += list.length
    if (list.length === 0 || offset >= total || out.length >= limit) break
  }

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
    return a.name.localeCompare(b.name, "zh-Hans-CN")
  })
  const result = out.slice(0, limit)
  listCache.set(cacheKey, { at: Date.now(), entries: result })
  return result
}

export interface Cloud115VideoRef {
  pickCode: string
  name: string
  size: number
  folderPath: string
}

/** 递归收集视频（刮削用）：限制深度与数量，并发扫描避免大目录卡住 */
export async function cloud115WalkVideos(
  config: Cloud115Config,
  rootCid = "0",
  rootName = "",
  maxDepth = 2,
  maxFiles = 200,
  concurrency = 3,
  onScan?: (scanned: number) => void
): Promise<Cloud115VideoRef[]> {
  const out: Cloud115VideoRef[] = []
  let queue: { cid: string; path: string; depth: number }[] = [
    { cid: rootCid, path: rootName, depth: 0 },
  ]
  let scanned = 0

  while (queue.length > 0 && out.length < maxFiles) {
    const batch = queue.splice(0, concurrency)
    scanned += batch.length
    onScan?.(scanned)
    const listed = await Promise.all(
      batch.map(async node => {
        try {
          return { node, entries: await cloud115ListEntries(config, node.cid) }
        } catch {
          return { node, entries: [] as Cloud115Entry[] }
        }
      })
    )

    for (const { node, entries } of listed) {
      for (const entry of entries) {
        if (out.length >= maxFiles) break
        if (entry.kind === "video") {
          out.push({
            pickCode: entry.id,
            name: entry.name,
            size: entry.size,
            folderPath: node.path,
          })
        } else if (node.depth < maxDepth) {
          queue.push({
            cid: entry.id,
            path: node.path ? `${node.path}/${entry.name}` : entry.name,
            depth: node.depth + 1,
          })
        }
      }
    }
  }

  return out
}

/** 115 扫码登录会话 */
export interface Cloud115QrSession {
  uid: string
  time: string
  sign: string
  /** 二维码图片地址（直接用 <Image> 加载） */
  imageUrl: string
}

/** 发起扫码登录：拿 uid/time/sign 与二维码 */
export async function cloud115QrStart(): Promise<Cloud115QrSession> {
  const res = await fetch("https://qrcodeapi.115.com/api/1.0/web/1.0/token", { timeout: 20 })
  const data = await res.json().catch(() => null)
  const d = data?.data
  if (!d?.uid || !d?.sign) {
    throw new Error(data?.message || data?.msg || "115 二维码获取失败")
  }
  const uid = String(d.uid)
  return {
    uid,
    time: String(d.time ?? ""),
    sign: String(d.sign),
    imageUrl: `https://qrcodeapi.115.com/api/1.0/web/1.0/qrcode?uid=${encodeURIComponent(uid)}`,
  }
}

export interface Cloud115QrState {
  /** 0 待扫描 / 1 已扫描待确认 / 2 已登录成功 / -1 已失效 / -2 已取消 */
  status: number
  cookie?: string
  message?: string
}

const QR_STATUS_URL = "https://qrcodeapi.115.com/api/1.0/web/1.0/status/"
const QR_LOGIN_URL = "https://passportapi.115.com/app/1.0/web/1.0/login/qrcode"

/** 把 115 返回的 cookie 对象/字符串统一成 `UID=…; CID=…; SEID=…; KID=…` */
function cookieFrom(raw: any): string | undefined {
  if (!raw) return undefined
  if (typeof raw === "string") return raw.trim() || undefined
  if (typeof raw !== "object") return undefined

  const read = (name: string): string => {
    const key = Object.keys(raw).find(k => k.toLowerCase() === name.toLowerCase())
    const value = key ? raw[key] : undefined
    return value === undefined || value === null ? "" : String(value)
  }
  const parts = ["UID", "CID", "SEID", "KID"]
    .map(name => {
      const value = read(name)
      return value ? `${name}=${value}` : ""
    })
    .filter(Boolean)

  // UID + SEID 是 115 鉴权的核心，缺一不可
  if (!read("UID") || !read("SEID")) return undefined
  return parts.join("; ")
}

/** 扫码确认后，用 uid 向 passportapi 换取登录 Cookie（115 的 status 接口本身不返回 Cookie） */
async function exchangeQrLogin(uid: string): Promise<string | undefined> {
  const res = await fetch(QR_LOGIN_URL, {
    method: "POST",
    timeout: 15,
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/plain, */*",
      Referer: "https://115.com/",
    },
    body: `account=${encodeURIComponent(uid)}&app=web`,
  })
  const data = await res.json().catch(() => null)
  return cookieFrom(data?.data?.cookie) ?? cookieFrom(data?.data)
}

/**
 * 轮询扫码状态。
 * 协议（对齐 115driver / 115 网页端）：
 * 1. GET  /api/1.0/web/1.0/status/  → data.status 0 待扫 / 1 已扫待确认 / 2 已确认 / -1 过期 / -2 取消
 * 2. 确认后 POST passportapi/…/login/qrcode  account=<uid>&app=web → data.cookie
 * force=true 时跳过第 1 步直接换 Cookie（给「立即检查」兜底）。
 * probe=true 时即使 status 还报 0 也试一次换 Cookie（防 status 接口不报确认态）。
 */
export async function cloud115QrPoll(
  session: Cloud115QrSession,
  force = false,
  probe = false
): Promise<Cloud115QrState> {
  if (force) {
    try {
      const cookie = await exchangeQrLogin(session.uid)
      if (cookie) return { status: 2, cookie }
    } catch {}
    return { status: 0, message: "115 还没确认登录" }
  }

  // 注意：/get/status/ 已废弃（会挂住不响应），必须用 /api/1.0/web/1.0/status/
  // `_` 时间戳 + no-cache 防止被缓存成永远「请扫描二维码」
  const url =
    `${QR_STATUS_URL}?uid=${encodeURIComponent(session.uid)}` +
    `&time=${encodeURIComponent(session.time)}&sign=${encodeURIComponent(session.sign)}` +
    `&_=${Date.now()}`

  const res = await fetch(url, {
    timeout: 12,
    headers: {
      "User-Agent": UA,
      Referer: "https://115.com/",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  })
  const data = await res.json().catch(() => null)
  if (!data) return { status: 0, message: "115 状态接口无响应" }

  // 少数情况 status 接口会直接给 cookie
  const direct = cookieFrom(data?.data?.cookie)
  if (direct) return { status: 2, cookie: direct }

  const message = String(data?.data?.msg || data.message || data.msg || data.error || "")
  const code = Number(data.code ?? data.errno ?? 0)
  const hasStatusField = data?.data && data.data.status !== undefined
  let status = hasStatusField ? Number(data.data.status) || 0 : 0

  if (message.includes("过期") || message.includes("失效")) status = -1
  else if (message.includes("取消")) status = -2
  else if (!hasStatusField && (message.includes("确认") || message.includes("扫描"))) {
    // 兼容只给文案不给 status 字段的返回
    status = message.includes("确认") ? 1 : 0
  }

  // 已扫描 / 已确认 / 接口声称成功 → 换取 Cookie
  const maybeDone =
    status >= 1 || probe || (data.state === true && code === 0 && !hasStatusField)
  if (maybeDone) {
    try {
      const cookie = await exchangeQrLogin(session.uid)
      if (cookie) return { status: 2, cookie, message }
    } catch {}
    if (status >= 2) status = 1
    return { status, message: status >= 1 ? message || "已扫描，请在 115 App 上点确认" : message }
  }

  return { status, message }
}

export function formatSpace(bytes: number): string {
  if (!bytes || bytes <= 0) return "—"
  const tb = bytes / 1024 / 1024 / 1024 / 1024
  if (tb >= 1) return `${tb.toFixed(tb >= 10 ? 0 : 1)}T`
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)}G`
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(0)}M`
}

export async function cloud115ListVideos(
  config: Cloud115Config,
  cid = "0",
  limit = 50
): Promise<RemoteMedia[]> {
  const entries = await cloud115ListEntries(config, cid, limit)
  return entries
    .filter(e => e.kind === "video")
    .slice(0, limit)
    .map(e => ({
      id: `115_${e.id}`,
      title: e.name,
      url: "",
      sourceType: "115" as const,
      sourceName: "115网盘",
      headers: { Cookie: config.cookie, Referer: "https://115.com/", "User-Agent": UA },
      extra: { pickCode: e.id, size: e.size },
    }))
}

function pickUrl(data: any, pickCode: string): string | null {
  if (!data) return null
  const candidates = [
    data?.data?.[pickCode]?.url?.url,
    data?.data?.[pickCode]?.url,
    data?.data?.file_url,
    data?.data?.url?.url,
    data?.data?.url,
    data?.url,
    data?.file_url,
    typeof data?.data === "string" && /^https?:\/\//.test(data.data) ? data.data : null,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//.test(c)) return c
  }
  return null
}

async function readJson(res: any): Promise<{ data: any; html: boolean; status: number }> {
  const text = (await res.text().catch(() => "")) || ""
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    try {
      return { data: JSON.parse(trimmed), html: false, status: res.status }
    } catch {}
  }
  return { data: null, html: /<html/i.test(trimmed) || res.status === 405, status: res.status }
}

/**
 * 取 115 播放直链。依次尝试：网页版 files/download（GET / POST）→ proapi downurl。
 * 任一接口回 HTML（405 风控）时直接给出可读提示。
 */
export async function cloud115GetPlayUrl(
  config: Cloud115Config,
  pickCode: string
): Promise<{ url: string; headers: Record<string, string> }> {
  if (!config.cookie.trim()) throw new Error("请先配置 115 Cookie")
  if (!pickCode) throw new Error("缺少 pickCode")

  const h = headers(config.cookie)
  const reasons: string[] = []
  let blocked = false

  /**
   * 官方客户端通道：POST proapi/app/chrome/downurl + m115 加密。
   * 只有它能拿大文件（webapi/files/download 会回「文件大小超出限制」）。
   */
  const tryM115 = async (): Promise<{ url: string; cookie: string } | null> => {
    const key = m115RandomKey()
    const body = m115Encode(JSON.stringify({ pickcode: pickCode }), key)
    const res = await schedule(() =>
      fetch(`https://proapi.115.com/app/chrome/downurl?t=${Date.now()}`, {
        method: "POST",
        headers: {
          Cookie: config.cookie,
          Referer: "https://115.com/",
          "User-Agent": UA_115BROWSER,
          Accept: "application/json;charset=UTF-8",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `data=${encodeURIComponent(body)}`,
        timeout: 30,
      })
    )
    const { data, html } = await readJson(res)
    if (html) blocked = true
    if (!data) {
      reasons.push(`加密接口 ${res.status}`)
      return null
    }
    if (data.state !== true || !data.data) {
      reasons.push(data.message || data.error || "加密接口失败")
      return null
    }
    let plain = ""
    try {
      plain = m115Decode(String(data.data), key)
    } catch {
      reasons.push("加密响应解密失败")
      return null
    }
    let map: any = null
    try {
      map = JSON.parse(plain)
    } catch {
      reasons.push("加密响应解析失败")
      return null
    }
    const info = map?.[pickCode] ?? (map ? Object.values(map)[0] : null)
    const url = info?.url?.url ?? info?.url
    if (typeof url === "string" && /^https?:/i.test(url)) {
      // ⚠️ CDN 直链必须带 auth_cookie，否则 403 {"message":"no cookie"}
      const auth = info?.url?.auth_cookie
      const cookie =
        auth?.name && auth?.value ? `${auth.name}=${auth.value}` : config.cookie
      return { url, cookie }
    }
    reasons.push(info ? "115 返回空直链" : "115 无该文件直链")
    return null
  }

  const tryGet = async () => {
    const res = await schedule(() =>
      fetch(`https://webapi.115.com/files/download?pick_code=${encodeURIComponent(pickCode)}`, {
        headers: h,
        timeout: 25,
      })
    )
    const { data, html } = await readJson(res)
    if (html) blocked = true
    const url = pickUrl(data, pickCode)
    if (!url) reasons.push(data?.error || data?.msg || `webapi ${res.status}`)
    return url
  }

  const tryPost = async () => {
    const res = await schedule(() =>
      fetch("https://webapi.115.com/files/download", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/x-www-form-urlencoded" },
        body: `pick_code=${encodeURIComponent(pickCode)}`,
        timeout: 25,
      })
    )
    const { data, html } = await readJson(res)
    if (html) blocked = true
    const url = pickUrl(data, pickCode)
    if (!url) reasons.push(data?.error || data?.msg || `webapi POST ${res.status}`)
    return url
  }

  const tryProapi = async () => {
    const res = await schedule(() =>
      fetch(`https://proapi.115.com/app/chrome/downurl?pickcode=${encodeURIComponent(pickCode)}`, {
        headers: h,
        timeout: 25,
      })
    )
    const { data, html } = await readJson(res)
    if (html) blocked = true
    const url = pickUrl(data, pickCode)
    if (!url) reasons.push(data?.error || data?.msg || `proapi ${res.status}`)
    return url
  }

  let url: string | null = null
  let playCookie = ""
  for (const attempt of [tryM115, tryPost, tryGet, tryProapi]) {
    try {
      const got = await attempt()
      if (got) {
        if (typeof got === "string") url = got
        else {
          url = got.url
          playCookie = got.cookie
        }
      }
    } catch (e: any) {
      reasons.push(e?.message || String(e))
    }
    if (url) break
  }

  if (!url) {
    if (blocked) throw new Error("115 返回了风控页面（请求过于频繁），过一会儿再试")
    throw new Error(`取 115 直链失败：${reasons.filter(Boolean).join(" / ") || "未知原因"}`)
  }

  return {
    url,
    headers: {
      Cookie: playCookie || config.cookie,
      Referer: "https://115.com/",
      "User-Agent": UA_115BROWSER,
    },
  }
}

/* --------------------------- 首页（对齐 SenPlayer） --------------------------- */

/** SenPlayer 刮削库的分类顺序 */
const CATEGORY_ORDER = ["电影", "电视剧", "动画电影", "动画剧集", "纪录片", "综艺", "少儿", "新闻"]

function scrapedCard(entry: ScrapeEntry, progress = 0, position = 0, duration = 0): HomeCard {
  return {
    id: `115_${entry.refId}`,
    title: entry.title,
    subtitle: [
      entry.year,
      entry.season != null ? `S${entry.season}` : "",
      entry.episode != null ? `E${entry.episode}` : "",
      entry.rating ? `★${entry.rating.toFixed(1)}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    poster: entry.poster,
    backdrop: entry.backdrop,
    url: "",
    headers: {},
    progress,
    positionSeconds: position,
    durationSeconds: duration,
    kind: entry.episode != null ? "episode" : "movie",
    pickCode: entry.refId,
  }
}

/** 一部影视一张卡（剧集显示总集数，点进去才看季/集） */
function groupCard(group: MediaGroup, progress = 0): HomeCard {
  const meta = [
    group.year,
    group.type === "series" ? `${group.episodeCount} 集` : group.category,
    group.rating ? `★${group.rating.toFixed(1)}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
  return {
    id: `group_${group.key}`,
    title: group.title,
    subtitle: meta,
    poster: group.poster,
    backdrop: group.backdrop ?? group.poster,
    url: "",
    headers: {},
    progress,
    positionSeconds: 0,
    durationSeconds: 0,
    kind: group.type === "series" ? "series" : "movie",
    groupKey: group.key,
  }
}

/**
 * 115 首页（对齐 SenPlayer）：继续观看 → 最近添加 → 按类别分栏
 * ⚠️ 卡片一律按「影视」聚合（一部剧一张卡），不能一集一张——否则首页全是同一张封面。
 * 没有刮削数据时退化成网盘根目录视频列表。
 */
export async function cloud115Home(config: Cloud115Config): Promise<HomeShelf[]> {
  if (!config.cookie.trim()) {
    throw new Error("还没有登录 115：请到「设置」→ 115 网盘 → 扫码登录")
  }

  const shelves: HomeShelf[] = []
  const scraped = loadScrapeLibrary().filter(e => e.source === "115")

  if (scraped.length > 0) {
    const groups = buildMediaGroups(scraped)
    const groupByKey = new Map(groups.map(g => [g.key, g]))
    const entryByRef = new Map(scraped.map(e => [e.refId, e]))

    // 1. 继续观看（一部剧一张卡，带进度）
    const resume: HomeCard[] = []
    const seenGroup = new Set<string>()
    for (const h of loadHistory()) {
      if (!h.mediaId.startsWith("115_") || h.progress <= 0 || h.duration <= 0) continue
      const ratio = Math.min(1, h.progress / h.duration)
      if (ratio < 0.02 || ratio > 0.98) continue
      const entry = entryByRef.get(h.mediaId.slice(4))
      if (!entry) continue
      const group = groupByKey.get(groupKeyOf(entry))
      if (!group || seenGroup.has(group.key)) continue
      seenGroup.add(group.key)
      resume.push(groupCard(group, ratio))
      if (resume.length >= 12) break
    }
    if (resume.length > 0) {
      shelves.push({ key: "115_resume", title: "继续观看", cards: resume, landscape: true })
    }

    // 2. 最近添加（按组内最新更新时间）
    const latestOf = new Map<string, number>()
    for (const e of scraped) {
      const key = groupKeyOf(e)
      latestOf.set(key, Math.max(latestOf.get(key) ?? 0, e.updatedAt || 0))
    }
    const recent = [...groups]
      .sort((a, b) => (latestOf.get(b.key) ?? 0) - (latestOf.get(a.key) ?? 0))
      .slice(0, 20)
    if (recent.length > 0) {
      shelves.push({
        key: "115_recent",
        title: "最近添加",
        cards: recent.map(g => groupCard(g)),
        landscape: false,
      })
    }

    // 3. 按类别分栏（SenPlayer 的刮削库分类）
    const byCat = new Map<string, MediaGroup[]>()
    for (const g of groups) {
      const key = g.category || (g.type === "series" ? "电视剧" : "电影")
      const list = byCat.get(key) || []
      list.push(g)
      byCat.set(key, list)
    }
    const ordered = [
      ...CATEGORY_ORDER.filter(c => byCat.has(c)),
      ...[...byCat.keys()].filter(c => !CATEGORY_ORDER.includes(c)),
    ]
    for (const name of ordered) {
      const list = byCat.get(name) || []
      if (list.length === 0) continue
      shelves.push({
        key: `115_cat_${name}`,
        title: name,
        cards: list.map(g => groupCard(g)),
        landscape: false,
      })
    }
  }

  // 4. 没有刮削数据：直接列根目录视频
  if (scraped.length === 0) {
    const list = await cloud115ListVideos(config, "0", 30)
    const cards: HomeCard[] = list.map(item => ({
      id: `115_${item.extra?.pickCode || item.id}`,
      title: item.title,
      subtitle: item.extra?.size ? formatSpace(Number(item.extra.size)) : "115 网盘",
      poster: item.poster,
      url: "",
      headers: {},
      progress: 0,
      positionSeconds: 0,
      durationSeconds: 0,
      kind: "movie",
      pickCode: String(item.extra?.pickCode || ""),
    }))
    if (cards.length > 0) {
      shelves.push({ key: "115_root", title: "网盘视频", cards, landscape: false })
    }
  }

  return shelves
}
