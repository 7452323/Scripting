import { fetch } from "scripting"
import type { PlexConfig } from "./config"
import { buildServerUrl } from "./config"
import type { RemoteMedia } from "../types"

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
