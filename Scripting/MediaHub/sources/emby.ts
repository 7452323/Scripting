import { fetch } from "scripting"
import type { EmbyConfig } from "./config"
import type { RemoteMedia } from "../types"

function base(server: string) {
  return server.replace(/\/$/, "")
}

function authHeaders(token: string) {
  return {
    "X-Emby-Token": token,
    "X-Emby-Authorization":
      'MediaBrowser Client="MediaHub", Device="iOS", DeviceId="mediahub-ios", Version="0.2.1"',
  }
}

function toPlayable(server: string, token: string, item: any): RemoteMedia | null {
  // 仅电影与剧集可直接播；Series 需再选分集
  if (item.Type === "Series" || item.Type === "Folder" || item.Type === "BoxSet") {
    return null
  }
  if (item.Type !== "Movie" && item.Type !== "Episode" && item.Type !== "Video") {
    // 仍尝试有 MediaSources 的项
    if (!item.MediaSources && !item.Path) return null
  }

  const id = String(item.Id)
  const title =
    item.Type === "Episode" && item.SeriesName
      ? `${item.SeriesName} - S${item.ParentIndexNumber || 0}E${item.IndexNumber || 0} ${item.Name || ""}`.trim()
      : item.Name || "未命名"

  const poster = item.ImageTags?.Primary
    ? `${server}/Items/${id}/Images/Primary?maxHeight=400&quality=80&api_key=${encodeURIComponent(token)}`
    : undefined

  const stream =
    `${server}/Videos/${id}/stream?Static=true&mediaSourceId=${encodeURIComponent(id)}` +
    `&api_key=${encodeURIComponent(token)}`

  return {
    id: `emby_${id}`,
    title,
    url: stream,
    poster,
    sourceType: "emby",
    sourceName: "Emby",
    headers: { "X-Emby-Token": token },
    extra: { embyId: id, type: item.Type },
  }
}

export async function embyLogin(config: EmbyConfig): Promise<EmbyConfig> {
  const server = base(config.server)
  if (!server) throw new Error("请填写 Emby 服务器地址")
  if (!config.username) throw new Error("请填写用户名")

  const res = await fetch(`${server}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization":
        'MediaBrowser Client="MediaHub", Device="iOS", DeviceId="mediahub-ios", Version="0.2.1"',
    },
    body: JSON.stringify({
      Username: config.username,
      Pw: config.password || "",
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Emby 登录失败 (${res.status}): ${text.slice(0, 160)}`)
  }

  const data = await res.json()
  return {
    ...config,
    accessToken: data.AccessToken,
    userId: data.User?.Id || data.UserId,
    enabled: true,
  }
}

export async function embyListLatest(config: EmbyConfig, limit = 30): Promise<RemoteMedia[]> {
  if (!config.accessToken || !config.userId) {
    throw new Error("请先在设置中登录 Emby")
  }
  const server = base(config.server)
  const token = config.accessToken
  const url =
    `${server}/Users/${config.userId}/Items/Latest?Limit=${limit}` +
    `&IncludeItemTypes=Movie,Episode&Fields=PrimaryImageAspectRatio,Overview,Path,MediaSources`

  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`Emby 列表失败 (${res.status})`)
  const items = await res.json()
  const list = Array.isArray(items) ? items : items.Items || []

  return list
    .map((item: any) => toPlayable(server, token, item))
    .filter(Boolean) as RemoteMedia[]
}

export async function embySearch(config: EmbyConfig, query: string): Promise<RemoteMedia[]> {
  if (!config.accessToken || !config.userId) throw new Error("请先登录 Emby")
  const server = base(config.server)
  const token = config.accessToken
  const url =
    `${server}/Users/${config.userId}/Items?SearchTerm=${encodeURIComponent(query)}` +
    `&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=40` +
    `&Fields=PrimaryImageAspectRatio,MediaSources`

  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`Emby 搜索失败 (${res.status})`)
  const data = await res.json()
  const list = data.Items || []

  return list
    .map((item: any) => toPlayable(server, token, item))
    .filter(Boolean) as RemoteMedia[]
}
