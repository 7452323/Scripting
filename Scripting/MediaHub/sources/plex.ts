import { fetch } from "scripting"
import type { PlexConfig } from "./config"
import type { RemoteMedia } from "../types"

function base(server: string) {
  return server.replace(/\/$/, "")
}

function headers(token: string) {
  return {
    Accept: "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "mediahub-ios",
    "X-Plex-Product": "MediaHub",
    "X-Plex-Version": "0.2.1",
  }
}

function toPlayable(server: string, token: string, item: any): RemoteMedia | null {
  const ratingKey = String(item.ratingKey || "")
  if (!ratingKey) return null

  // 仅 movie / episode 有 Part
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

export async function plexTest(config: PlexConfig): Promise<string> {
  const server = base(config.server)
  if (!server || !config.token) throw new Error("请填写 Plex 服务器与 Token")
  const res = await fetch(`${server}/identity`, { headers: headers(config.token) })
  if (!res.ok) throw new Error(`Plex 连接失败 (${res.status})`)
  const data = await res.json()
  return data?.MediaContainer?.machineIdentifier || "已连接"
}

export async function plexListRecent(config: PlexConfig, limit = 30): Promise<RemoteMedia[]> {
  const server = base(config.server)
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
  const server = base(config.server)
  if (!server || !config.token) throw new Error("请先配置 Plex")

  // type 1=movie 4=episode
  const res = await fetch(
    `${server}/hubs/search?query=${encodeURIComponent(query)}&limit=20`,
    { headers: headers(config.token) }
  )

  // 部分服务器仅支持 /search
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
