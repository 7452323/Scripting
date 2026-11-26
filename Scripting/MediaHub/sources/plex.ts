import type { PlexConfig } from "./config"

export interface RemoteMedia {
  id: string
  title: string
  url: string
  poster?: string
  sourceType: "plex"
  sourceName: string
  extra?: Record<string, any>
}

function base(server: string) {
  return server.replace(/\/$/, "")
}

function headers(token: string) {
  return {
    Accept: "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": "mediahub-ios",
    "X-Plex-Product": "MediaHub",
    "X-Plex-Version": "0.2.0",
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

  return items.map((item: any) => {
    const ratingKey = String(item.ratingKey)
    const title =
      item.type === "episode" && item.grandparentTitle
        ? `${item.grandparentTitle} - ${item.title}`
        : item.title || "未命名"

    const part = item.Media?.[0]?.Part?.[0]
    const partKey = part?.key
    const stream = partKey
      ? `${server}${partKey}?X-Plex-Token=${config.token}`
      : `${server}/library/metadata/${ratingKey}?X-Plex-Token=${config.token}`

    const thumb = item.thumb
      ? `${server}${item.thumb}?X-Plex-Token=${config.token}`
      : undefined

    return {
      id: `plex_${ratingKey}`,
      title,
      url: stream,
      poster: thumb,
      sourceType: "plex" as const,
      sourceName: "Plex",
      extra: { ratingKey },
    }
  })
}

export async function plexSearch(config: PlexConfig, query: string): Promise<RemoteMedia[]> {
  const server = base(config.server)
  if (!server || !config.token) throw new Error("请先配置 Plex")

  const res = await fetch(
    `${server}/search?query=${encodeURIComponent(query)}&type=1,4`,
    { headers: headers(config.token) }
  )
  if (!res.ok) throw new Error(`Plex 搜索失败 (${res.status})`)
  const data = await res.json()
  const items = data?.MediaContainer?.Metadata || []

  return items.map((item: any) => {
    const ratingKey = String(item.ratingKey)
    const part = item.Media?.[0]?.Part?.[0]
    const partKey = part?.key
    const stream = partKey
      ? `${server}${partKey}?X-Plex-Token=${config.token}`
      : `${server}/library/metadata/${ratingKey}?X-Plex-Token=${config.token}`

    return {
      id: `plex_${ratingKey}`,
      title: item.title || "未命名",
      url: stream,
      sourceType: "plex" as const,
      sourceName: "Plex",
      extra: { ratingKey },
    }
  })
}
