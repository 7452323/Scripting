import type { EmbyConfig } from "./config"

export interface RemoteMedia {
  id: string
  title: string
  url: string
  poster?: string
  sourceType: "emby"
  sourceName: string
  extra?: Record<string, any>
}

function base(server: string) {
  return server.replace(/\/$/, "")
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
        'MediaBrowser Client="MediaHub", Device="iOS", DeviceId="mediahub-ios", Version="0.2.0"',
    },
    body: JSON.stringify({
      Username: config.username,
      Pw: config.password || "",
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Emby 登录失败 (${res.status}): ${text.slice(0, 120)}`)
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
  const url =
    `${server}/Users/${config.userId}/Items/Latest?Limit=${limit}` +
    `&IncludeItemTypes=Movie,Episode&Fields=PrimaryImageAspectRatio,Overview,Path`

  const res = await fetch(url, {
    headers: {
      "X-Emby-Token": config.accessToken,
    },
  })
  if (!res.ok) throw new Error(`Emby 列表失败 (${res.status})`)
  const items = await res.json()
  const list = Array.isArray(items) ? items : items.Items || []

  return list.map((item: any) => {
    const id = String(item.Id)
    const title =
      item.Type === "Episode" && item.SeriesName
        ? `${item.SeriesName} - ${item.Name}`
        : item.Name || "未命名"
    const poster = item.ImageTags?.Primary
      ? `${server}/Items/${id}/Images/Primary?maxHeight=400&quality=80&api_key=${config.accessToken}`
      : undefined
    const stream =
      `${server}/Videos/${id}/stream?Static=true&mediaSourceId=${id}&api_key=${config.accessToken}`

    return {
      id: `emby_${id}`,
      title,
      url: stream,
      poster,
      sourceType: "emby" as const,
      sourceName: "Emby",
      extra: { embyId: id },
    }
  })
}

export async function embySearch(config: EmbyConfig, query: string): Promise<RemoteMedia[]> {
  if (!config.accessToken || !config.userId) throw new Error("请先登录 Emby")
  const server = base(config.server)
  const url =
    `${server}/Users/${config.userId}/Items?SearchTerm=${encodeURIComponent(query)}` +
    `&IncludeItemTypes=Movie,Episode,Series&Recursive=true&Limit=40`

  const res = await fetch(url, {
    headers: { "X-Emby-Token": config.accessToken },
  })
  if (!res.ok) throw new Error(`Emby 搜索失败 (${res.status})`)
  const data = await res.json()
  const list = data.Items || []

  return list.map((item: any) => {
    const id = String(item.Id)
    const title = item.Name || "未命名"
    const stream =
      `${server}/Videos/${id}/stream?Static=true&mediaSourceId=${id}&api_key=${config.accessToken}`
    return {
      id: `emby_${id}`,
      title,
      url: stream,
      sourceType: "emby" as const,
      sourceName: "Emby",
      extra: { embyId: id, type: item.Type },
    }
  })
}
