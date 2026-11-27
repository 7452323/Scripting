import { fetch } from "scripting"
import type { PlexConfig } from "./config"
import { buildServerUrl } from "./config"
import type { RemoteMedia, HomeCard, HomeShelf } from "../types"

const CLIENT_ID = "mediahub-ios-scripting"
const PRODUCT = "MediaHub"
const VERSION = "0.3.0"

function base(server: string) {
  return (server || "").replace(/\/$/, "")
}

function ensureServer(config: PlexConfig): string {
  if (config.server) return base(config.server)
  return base(buildServerUrl(config.scheme || "http", config.host || "", config.port || "32400"))
}

function headers(token?: string) {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Client-Identifier": CLIENT_ID,
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": VERSION,
    "X-Plex-Device": "iOS",
    "X-Plex-Platform": "iOS",
  }
  if (token) h["X-Plex-Token"] = token
  return h
}

function toPlayable(server: string, token: string, item: any): RemoteMedia | null {
  const ratingKey = String(item.ratingKey || "")
  if (!ratingKey) return null
  const part = item.Media?.[0]?.Part?.[0]
  if (!part?.key) return null

  const title =
    item.type === "episode" && item.grandparentTitle
      ? `${item.grandparentTitle} - ${item.title || ""}`.trim()
      : item.title || "未命名"

  const stream = `${server}${part.key}?X-Plex-Token=${encodeURIComponent(token)}`
  const thumb = item.thumb
    ? `${server}${item.thumb}?X-Plex-Token=${encodeURIComponent(token)}`
    : undefined

  return {
    id: `plex_${ratingKey}`,
    title,
    url: stream,
    poster: thumb,
    sourceType: "plex",
    sourceName: "Plex",
    extra: { ratingKey },
  }
}

/** Safari 登录：创建 PIN 并返回授权页 URL */
export async function plexStartSafariLogin(): Promise<{ pinId: number; code: string; authUrl: string }> {
  const res = await fetch("https://plex.tv/api/v2/pins?strong=true", {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`创建 Plex PIN 失败 (${res.status}): ${t.slice(0, 120)}`)
  }
  const data = await res.json()
  const pinId = data.id
  const code = data.code
  if (!pinId || !code) throw new Error("Plex PIN 响应无效")

  const authUrl =
    `https://app.plex.tv/auth#?clientID=${encodeURIComponent(CLIENT_ID)}` +
    `&code=${encodeURIComponent(code)}` +
    `&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PRODUCT)}`

  // 打开 Safari
  try {
    const S: any = (globalThis as any).Safari
    if (S?.open) await S.open(authUrl)
    else if (S?.openURL) await S.openURL(authUrl)
    else if (typeof (globalThis as any).openURL === "function") {
      await (globalThis as any).openURL(authUrl)
    }
  } catch (e) {
    console.warn("打开 Safari 失败，请手动打开授权链接", e)
  }

  return { pinId, code, authUrl }
}

/** 轮询 PIN，成功返回 token */
export async function plexPollPin(pinId: number, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000)
    const res = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: headers(),
    })
    if (!res.ok) continue
    const data = await res.json()
    if (data.authToken) return data.authToken as string
  }
  throw new Error("等待 Plex 授权超时，请在 Safari 完成登录后重试")
}

export interface PlexServer {
  name: string
  uri: string
  token: string
  local: boolean
  relay: boolean
}

/** 登录后自动发现账号下的 Plex 服务器（优先直连 https → 直连 http → 中继） */
export async function plexDiscoverServers(token: string): Promise<PlexServer[]> {
  const res = await fetch(
    "https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1",
    { headers: headers(token), timeout: 20 }
  )
  if (!res.ok) throw new Error(`Plex 服务器发现失败 (${res.status})`)

  const list: any[] = await res.json()
  const out: PlexServer[] = []

  for (const resource of Array.isArray(list) ? list : []) {
    if (!String(resource?.provides || "").includes("server")) continue
    const connections: any[] = resource?.connections || []
    const ranked = connections
      .filter(conn => conn?.uri)
      .map(conn => ({
        uri: String(conn.uri).replace(/\/$/, ""),
        relay: !!conn.relay,
        local: !!conn.local,
        https: String(conn.uri).startsWith("https://"),
      }))
      .sort((a, b) => score(b) - score(a))

    if (ranked.length === 0) continue
    out.push({
      name: String(resource.name || "Plex"),
      uri: ranked[0].uri,
      token: String(resource.accessToken || token),
      local: ranked[0].local,
      relay: ranked[0].relay,
    })
  }

  return out
}

function score(conn: { relay: boolean; https: boolean; local: boolean }): number {
  return (conn.relay ? 0 : 4) + (conn.https ? 2 : 1) + (conn.local ? 1 : 0)
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export async function plexTest(config: PlexConfig): Promise<string> {
  const server = ensureServer(config)
  if (!server || !config.token) throw new Error("请先完成 Plex 登录并填写服务器")
  const res = await fetch(`${server}/identity`, { headers: headers(config.token) })
  if (!res.ok) throw new Error(`Plex 连接失败 (${res.status})`)
  const data = await res.json()
  return data?.MediaContainer?.machineIdentifier || "已连接"
}

export async function plexListRecent(config: PlexConfig, limit = 30): Promise<RemoteMedia[]> {
  const server = ensureServer(config)
  if (!server || !config.token) throw new Error("请先配置 Plex")

  const res = await fetch(
    `${server}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`,
    { headers: headers(config.token) }
  )
  if (!res.ok) throw new Error(`Plex 列表失败 (${res.status})`)
  const data = await res.json()
  const items = data?.MediaContainer?.Metadata || []

  return items
    .map((item: any) => toPlayable(server, config.token, item))
    .filter(Boolean) as RemoteMedia[]
}

export async function plexSearch(config: PlexConfig, query: string): Promise<RemoteMedia[]> {
  const server = ensureServer(config)
  if (!server || !config.token) throw new Error("请先配置 Plex")

  const res = await fetch(
    `${server}/hubs/search?query=${encodeURIComponent(query)}&limit=20`,
    { headers: headers(config.token) }
  )

  let items: any[] = []
  if (res.ok) {
    const data = await res.json()
    const hubs = data?.MediaContainer?.Hub || []
    for (const hub of hubs) {
      if (Array.isArray(hub.Metadata)) items.push(...hub.Metadata)
    }
  } else {
    const res2 = await fetch(
      `${server}/search?query=${encodeURIComponent(query)}&type=1,4`,
      { headers: headers(config.token) }
    )
    if (!res2.ok) throw new Error(`Plex 搜索失败 (${res2.status})`)
    const data2 = await res2.json()
    items = data2?.MediaContainer?.Metadata || []
  }

  return items
    .map((item: any) => toPlayable(server, config.token, item))
    .filter(Boolean) as RemoteMedia[]
}

/* --------------------------- 首页（对齐 SenPlayer） --------------------------- */

function plexCard(server: string, token: string, item: any): HomeCard | null {
  const ratingKey = String(item?.ratingKey || "")
  if (!ratingKey) return null

  const part = item?.Media?.[0]?.Part?.[0]
  const q = `X-Plex-Token=${encodeURIComponent(token)}`
  const isEpisode = item.type === "episode"
  const isShow = item.type === "show"

  const title =
    isEpisode && item.grandparentTitle ? item.grandparentTitle : item.title || "未命名"
  let subtitle = ""
  if (isEpisode) {
    const s = item.parentIndex != null ? `S${item.parentIndex}` : ""
    const e = item.index != null ? `E${item.index}` : ""
    subtitle = [s + e, item.title].filter(Boolean).join(" · ")
  } else if (isShow) {
    subtitle = [item.year, item.childCount ? `${item.childCount} 集` : ""]
      .filter(Boolean)
      .join(" · ")
  } else {
    subtitle = String(item.year || "")
  }

  const durationSeconds = Number(item.duration || 0) / 1000
  const positionSeconds = Number(item.viewOffset || 0) / 1000

  return {
    id: `plex_${ratingKey}`,
    title,
    subtitle,
    poster: item.thumb ? `${server}${item.thumb}?${q}` : undefined,
    backdrop: item.art ? `${server}${item.art}?${q}` : undefined,
    url: part?.key ? `${server}${part.key}?${q}` : "",
    headers: { "X-Plex-Token": token },
    progress: durationSeconds > 0 ? Math.min(1, positionSeconds / durationSeconds) : 0,
    positionSeconds,
    durationSeconds,
    kind: isEpisode ? "episode" : isShow ? "series" : "movie",
  }
}

/** 首页：继续观看 / 最近添加 / 每个媒体库一栏 */
export async function plexHome(config: PlexConfig): Promise<HomeShelf[]> {
  const server = ensureServer(config)
  if (!server || !config.token) throw new Error("还没有登录 Plex：请到「设置」→ Plex 扫码登录")
  const token = config.token
  const q = `X-Plex-Token=${encodeURIComponent(token)}`

  const getJson = async (path: string, size = 20): Promise<any> => {
    const sep = path.includes("?") ? "&" : "?"
    const res = await fetch(
      `${server}${path}${sep}${q}&X-Plex-Container-Start=0&X-Plex-Container-Size=${size}`,
      { headers: headers(token), timeout: 20 }
    )
    if (!res.ok) throw new Error(`Plex 请求失败 (${res.status})：${path}`)
    return res.json().catch(() => null)
  }

  const shelves: HomeShelf[] = []

  // 1. 继续观看
  try {
    const data = await getJson("/library/onDeck", 12)
    const cards = ((data?.MediaContainer?.Metadata || []) as any[])
      .map(item => plexCard(server, token, item))
      .filter(Boolean) as HomeCard[]
    if (cards.length > 0) {
      shelves.push({ key: "plex_resume", title: "继续观看", cards, landscape: true })
    }
  } catch {}

  // 2. 最近添加
  try {
    const data = await getJson("/library/recentlyAdded", 20)
    const cards = ((data?.MediaContainer?.Metadata || []) as any[])
      .map(item => plexCard(server, token, item))
      .filter(Boolean) as HomeCard[]
    if (cards.length > 0) {
      shelves.push({ key: "plex_latest", title: "最近添加", cards, landscape: false })
    }
  } catch {}

  // 3. 每个媒体库一栏
  try {
    const data = await getJson("/library/sections", 40)
    const dirs = (data?.MediaContainer?.Directory || []) as any[]
    const wanted = dirs.filter(d => d?.type === "movie" || d?.type === "show")
    const results = await Promise.all(
      wanted.map(async dir => {
        const key = String(dir.key || "")
        if (!key) return null
        try {
          const path =
            dir.type === "show"
              ? `/library/sections/${key}/recentlyAdded`
              : `/library/sections/${key}/all?sort=addedAt:desc`
          const sec = await getJson(path, 20)
          const cards = ((sec?.MediaContainer?.Metadata || []) as any[])
            .map(item => plexCard(server, token, item))
            .filter(Boolean) as HomeCard[]
          if (cards.length === 0) return null
          return {
            key: `plex_sec_${key}`,
            title: String(dir.title || "媒体库"),
            cards,
            landscape: false,
          } as HomeShelf
        } catch {
          return null
        }
      })
    )
    for (const shelf of results) if (shelf) shelves.push(shelf)
  } catch {}

  if (shelves.length === 0) return []
  return shelves
}
