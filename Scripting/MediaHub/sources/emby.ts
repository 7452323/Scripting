import { fetch } from "scripting"
import type { EmbyConfig } from "./config"
import type { RemoteMedia, HomeCard } from "../types"

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

/** https 握不上时自动回退到 http（Emby 8096 多数是明文） */
const serverCache = new Map<string, string>()

export async function probeEmbyServer(baseUrl: string): Promise<string> {
  const cached = serverCache.get(baseUrl)
  if (cached) return cached

  const candidates = embyCandidates(baseUrl)
  const httpsFirst = candidates.filter(value => value.startsWith("https://"))
  const httpLater = candidates.filter(value => !value.startsWith("https://"))

  const hit = (await firstReachable(httpsFirst)) || (await firstReachable(httpLater))

  if (hit) serverCache.set(baseUrl, hit)
  return hit || baseUrl
}

/** 并发探测一组地址，谁先返回 200 就用谁；全失败返回 null */
async function firstReachable(candidates: string[]): Promise<string | null> {
  if (candidates.length === 0) return null

  return await new Promise<string | null>(resolve => {
    let pending = candidates.length
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    for (const candidate of candidates) {
      ;(async () => {
        try {
          const res = await fetch(`${candidate}/System/Info/Public`, {
            timeout: 4,
            allowInsecureRequest: true,
          })
          if (res.ok) finish(candidate)
        } catch {}
        pending -= 1
        if (pending === 0) finish(null)
      })()
    }
  })
}

/** 候选地址：原地址 → 去端口（反向代理 443）→ 换协议（Emby 8096 通常是 http） */
function embyCandidates(baseUrl: string): string[] {
  const isHttps = baseUrl.startsWith("https://")
  const httpsUrl = baseUrl.replace(/^http:\/\//i, "https://")
  const httpUrl = baseUrl.replace(/^https:\/\//i, "http://")
  const stripPort = (url: string) => url.replace(/:(\d+)(?=\/|$)/, "")
  const port = (baseUrl.match(/:(\d+)(?:\/|$)/) || [])[1] || ""

  const exact = isHttps ? [baseUrl, httpUrl] : [baseUrl, httpsUrl]
  const portless = exact.map(stripPort)

  const ordered =
    port === "8096" || port === "80"
      ? [...exact, ...portless]
      : port === "8920" || port === "443"
        ? [baseUrl, ...portless, httpsUrl]
        : [...exact, ...portless]

  return ordered.filter((value, index) => ordered.indexOf(value) === index)
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
  const rawServer = base(config.server)
  if (!rawServer) throw new Error("请填写 Emby 服务器地址")
  if (!config.username) throw new Error("请填写用户名")
  const server = await probeEmbyServer(rawServer)

  const res = await fetch(`${server}/Users/AuthenticateByName`, {
    allowInsecureRequest: true,
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
  const server = await probeEmbyServer(base(config.server))
  const token = config.accessToken
  const url =
    `${server}/Users/${config.userId}/Items/Latest?Limit=${limit}` +
    `&IncludeItemTypes=Movie,Episode&Fields=PrimaryImageAspectRatio,Overview,Path,MediaSources`

  const res = await fetch(url, { headers: authHeaders(token), allowInsecureRequest: true, timeout: 15 })
  if (!res.ok) throw new Error(`Emby 列表失败 (${res.status})`)
  const items = await res.json()
  const list = Array.isArray(items) ? items : items.Items || []

  return list
    .map((item: any) => toPlayable(server, token, item))
    .filter(Boolean) as RemoteMedia[]
}

export async function embySearch(config: EmbyConfig, query: string): Promise<RemoteMedia[]> {
  if (!config.accessToken || !config.userId) throw new Error("请先登录 Emby")
  const server = await probeEmbyServer(base(config.server))
  const token = config.accessToken
  const url =
    `${server}/Users/${config.userId}/Items?SearchTerm=${encodeURIComponent(query)}` +
    `&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=40` +
    `&Fields=PrimaryImageAspectRatio,MediaSources`

  const res = await fetch(url, { headers: authHeaders(token), allowInsecureRequest: true, timeout: 15 })
  if (!res.ok) throw new Error(`Emby 搜索失败 (${res.status})`)
  const data = await res.json()
  const list = data.Items || []

  return list
    .map((item: any) => toPlayable(server, token, item))
    .filter(Boolean) as RemoteMedia[]
}

/* --------------------------- 首页数据（Emby） --------------------------- */

const TICKS_PER_SECOND = 10_000_000

const HOME_FIELDS =
  "PrimaryImageAspectRatio,Overview,Path,MediaSources,ImageTags,BackdropImageTags,UserData,ProductionYear,OfficialRating"

const STREAM_HEADERS = (token: string) => ({ "X-Emby-Token": token })

export interface EmbyCard extends HomeCard {}

export interface EmbySection {
  key: string
  title: string
  cards: EmbyCard[]
}

export interface EmbyHomeData {
  resume: EmbyCard[]
  latest: EmbyCard[]
  /** 按 Emby 实际媒体库（/Users/{uid}/Views）动态生成的栏目 */
  sections: EmbySection[]
}

/** CollectionType → 该库要拉取的 Item 类型 */
const VIEW_ITEM_TYPES: Record<string, string> = {
  movies: "Movie",
  tvshows: "Series",
  boxsets: "BoxSet",
  music: "MusicAlbum",
  musicvideos: "MusicVideo",
  homevideos: "Video",
  photos: "Photo",
}

/** 首页：继续观看 / 最近加入 / 每个媒体库一栏（完全按服务器实际数据生成） */
export async function embyHome(config: EmbyConfig): Promise<EmbyHomeData> {
  if (!config.accessToken || !config.userId) throw new Error("请先登录 Emby")
  const server = await probeEmbyServer(base(config.server))
  const token = config.accessToken
  const uid = config.userId
  const images = "&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop"
  const baseQuery = `Fields=${HOME_FIELDS}${images}`

  const [resumeRaw, latestRaw, viewsRaw] = await Promise.all([
    getJson(
      `${server}/Users/${uid}/Items/Resume?Limit=12&MediaTypes=Video&Recursive=true&${baseQuery}`,
      token
    ),
    getJson(
      `${server}/Users/${uid}/Items/Latest?Limit=20&IncludeItemTypes=Movie,Episode&${baseQuery}`,
      token
    ),
    getJson(`${server}/Users/${uid}/Views`, token),
  ])

  if (!resumeRaw && !latestRaw && !viewsRaw) {
    throw new Error(
      "无法连接 Emby：请检查服务器地址与端口（Emby 默认 8096，反向代理走 443）"
    )
  }

  const views: any[] = viewsRaw?.Items || []
  const sectionList: EmbySection[] = []

  await Promise.all(
    views.slice(0, 8).map(async view => {
      const viewId = String(view?.Id || "")
      if (!viewId) return
      const collectionType = String(view.CollectionType || "")
      const itemType = VIEW_ITEM_TYPES[collectionType]
      const typeQuery = itemType ? `&IncludeItemTypes=${itemType}` : ""
      const raw = await getJson(
        `${server}/Users/${uid}/Items?ParentId=${viewId}&Recursive=true` +
          `&SortBy=DateCreated&SortOrder=Descending&Limit=18${typeQuery}&${baseQuery}`,
        token
      )
      const cards = toCards(server, token, raw)
      if (cards.length === 0) return
      sectionList.push({
        key: viewId,
        title: String(view.Name || "媒体库"),
        cards,
      })
    })
  )

  return {
    resume: toCards(server, token, resumeRaw),
    latest: toCards(server, token, latestRaw),
    sections: sectionList,
  }
}

function enc(value: string): string {
  return encodeURIComponent(value)
}

function posterUrl(server: string, itemId: string, token: string): string {
  return `${server}/Items/${itemId}/Images/Primary?maxHeight=420&quality=80&api_key=${enc(token)}`
}

function backdropUrl(server: string, itemId: string, token: string): string {
  return `${server}/Items/${itemId}/Images/Backdrop/0?maxWidth=1200&quality=80&api_key=${enc(token)}`
}

export function toEmbyCard(server: string, token: string, item: any): EmbyCard | null {
  if (!item || !item.Id) return null
  const type = String(item.Type || "")
  if (type !== "Movie" && type !== "Episode" && type !== "Series") return null

  const id = String(item.Id)
  const kind: EmbyCard["kind"] =
    type === "Series" ? "series" : type === "Episode" ? "episode" : "movie"

  const durationSeconds = Math.round((item.RunTimeTicks || 0) / TICKS_PER_SECOND)
  const positionSeconds = Math.round(
    (item.UserData?.PlaybackPositionTicks || 0) / TICKS_PER_SECOND
  )
  const progress =
    durationSeconds > 0 ? Math.min(1, positionSeconds / durationSeconds) : 0

  // 剧集的封面/背景用剧本身的海报，观感更统一
  const seriesId = item.SeriesId ? String(item.SeriesId) : undefined
  const posterItemId = type === "Episode" && seriesId ? seriesId : id
  const hasPoster =
    type === "Episode"
      ? !!item.SeriesPrimaryImageTag || !!item.ImageTags?.Primary
      : !!item.ImageTags?.Primary

  const backdropItemId = item.BackdropImageTags?.length
    ? id
    : item.ParentBackdropImageTags?.length && item.ParentBackdropItemId
      ? String(item.ParentBackdropItemId)
      : type === "Episode" && seriesId
        ? seriesId
        : item.BackdropImageTags?.length
          ? id
          : undefined

  const title =
    type === "Episode"
      ? String(item.SeriesName || item.Name || "未命名")
      : String(item.Name || "未命名")

  const episodeTag =
    type === "Episode"
      ? `S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0}`
      : ""
  const extra =
    type === "Episode"
      ? item.Name && item.Name !== item.SeriesName
        ? ` · ${item.Name}`
        : ""
      : ""
  const meta = [item.ProductionYear ? String(item.ProductionYear) : "", item.OfficialRating || ""]
    .filter(Boolean)
    .join(" · ")

  const url =
    kind === "series"
      ? ""
      : `${server}/Videos/${id}/stream?Static=true&mediaSourceId=${enc(id)}&api_key=${enc(token)}`

  return {
    id,
    title,
    subtitle:
      type === "Episode"
        ? `${episodeTag}${extra}`
        : kind === "series"
          ? item.RecursiveItemCount
            ? `${item.RecursiveItemCount} 集${meta ? ` · ${meta}` : ""}`
            : meta || "剧集"
          : meta || "电影",
    poster: hasPoster ? posterUrl(server, posterItemId, token) : undefined,
    backdrop: backdropItemId ? backdropUrl(server, backdropItemId, token) : undefined,
    url,
    headers: STREAM_HEADERS(token),
    progress,
    positionSeconds,
    durationSeconds,
    kind,
  }
}

async function getJson(url: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: authHeaders(token), allowInsecureRequest: true, timeout: 15 })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function postJson(url: string, token: string, body: unknown): Promise<any | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      allowInsecureRequest: true,
      timeout: 20,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function toCards(server: string, token: string, data: any): EmbyCard[] {
  if (!data) return []
  const list: any[] = Array.isArray(data) ? data : data.Items || []
  return list
    .map(item => toEmbyCard(server, token, item))
    .filter((card): card is EmbyCard => card != null)
}

/** 点剧集：取第一集未看的（都看过就第一集） */
export async function embySeriesNextEpisode(
  config: EmbyConfig,
  seriesId: string
): Promise<EmbyCard | null> {
  if (!config.accessToken || !config.userId) throw new Error("请先登录 Emby")
  const server = await probeEmbyServer(base(config.server))
  const token = config.accessToken
  const uid = config.userId
  const sort = encodeURIComponent("ParentIndexNumber,IndexNumber")
  const data = await getJson(
    `${server}/Shows/${seriesId}/Episodes?UserId=${uid}&Limit=300&SortBy=${sort}` +
      `&Fields=${HOME_FIELDS}&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop`,
    token
  )
  const cards = toCards(server, token, data)
  if (cards.length === 0) return null
  const unplayed = cards.find(card => card.progress <= 0.02)
  return unplayed || cards[0]
}

/** 取真实可播地址：先 PlaybackInfo 拿 MediaSourceId / PlaySessionId（直接用 itemId 会 400） */
export interface EmbyPlayback {
  url: string
  headers: Record<string, string>
  mediaSourceId: string
  playSessionId?: string
  transcoding: boolean
}

export async function embyPlaybackUrl(
  config: EmbyConfig,
  itemId: string
): Promise<EmbyPlayback | null> {
  if (!config.accessToken || !config.userId) throw new Error("请先登录 Emby")
  const server = await probeEmbyServer(base(config.server))
  const token = config.accessToken
  const uid = config.userId

  const deviceProfile = {
    MaxStreamingBitrate: 120000000,
    MaxStaticBitrate: 120000000,
    MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: [
      {
        Container: "mp4,m4v,mov",
        Type: "Video",
        VideoCodec: "h264,hevc",
        AudioCodec: "aac,mp3,ac3,eac3,alac",
      },
    ],
    TranscodingProfiles: [
      {
        Container: "ts",
        Type: "Video",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "2",
      },
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "hevc,h264",
        AudioCodec: "aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "2",
      },
    ],
    CodecProfiles: [],
    ContainerProfiles: [],
  }

  const info = await postJson(
    `${server}/Items/${itemId}/PlaybackInfo?UserId=${uid}`,
    token,
    {
      UserId: uid,
      MaxStreamingBitrate: 120000000,
      StartTimeTicks: 0,
      AutoOpenLiveStream: true,
      IsPlayback: true,
      DeviceProfile: deviceProfile,
    }
  )

  const mediaSources: any[] = info?.MediaSources || []
  const mediaSource = mediaSources[0]
  const mediaSourceId = mediaSource?.Id ? String(mediaSource.Id) : itemId
  const playSessionId = info?.PlaySessionId ? String(info.PlaySessionId) : undefined

  const container = String(mediaSource?.Container || "").toLowerCase()
  const streams: any[] = mediaSource?.MediaStreams || []
  const video = streams.find(s => s?.Type === "Video")
  const audio = streams.find(s => s?.Type === "Audio")
  const videoCodec = String(video?.Codec || "").toLowerCase()
  const audioCodec = String(audio?.Codec || "").toLowerCase()
  const directPlay =
    ["mp4", "m4v", "mov"].includes(container) &&
    ["h264", "hevc"].includes(videoCodec) &&
    ["aac", "mp3", "ac3", "eac3", "alac"].includes(audioCodec)

  const query =
    `MediaSourceId=${enc(mediaSourceId)}` +
    (playSessionId ? `&PlaySessionId=${enc(playSessionId)}` : "") +
    `&DeviceId=mediahub-ios&api_key=${enc(token)}`

  // 服务器 ffmpeg 对 mp4 直转会报错，HLS 实测稳定（MKV/TrueHD 也能播）
  // HEVC 源：copy 视频进 fMP4（起播 ~2s），只转音频；其它源用 ts 直拷
  const hevcSource = videoCodec === "hevc"
  const url = directPlay
    ? `${server}/Videos/${itemId}/stream?Static=true&${query}`
    : `${server}/Videos/${itemId}/master.m3u8?${query}` +
      `&VideoCodec=${hevcSource ? "hevc" : "h264"}&AudioCodec=aac&AudioBitrate=192000&MaxAudioChannels=2` +
      (hevcSource ? `&SegmentContainer=mp4` : "")

  return {
    url,
    headers: { "X-Emby-Token": token },
    mediaSourceId,
    playSessionId,
    transcoding: !directPlay,
  }
}

/** 把播放进度回写给 Emby，让首页「继续观看」保持同步 */
export async function embyReportProgress(
  config: EmbyConfig,
  itemId: string,
  positionSeconds: number,
  durationSeconds: number,
  phase: "start" | "progress" | "stop",
  mediaSourceId?: string,
  playSessionId?: string
): Promise<void> {
  if (!config.accessToken || !config.userId) return
  if (!itemId) return

  try {
    const server = await probeEmbyServer(base(config.server))
    const token = config.accessToken
    const path =
      phase === "start"
        ? "/Sessions/Playing"
        : phase === "stop"
          ? "/Sessions/Playing/Stopped"
          : "/Sessions/Playing/Progress"

    await fetch(`${server}${path}`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        ItemId: itemId,
        MediaSourceId: mediaSourceId || itemId,
        PlaySessionId: playSessionId,
        PositionTicks: Math.max(0, Math.round(positionSeconds * TICKS_PER_SECOND)),
        RunTimeTicks: Math.max(0, Math.round(durationSeconds * TICKS_PER_SECOND)),
        CanSeek: true,
        IsPaused: false,
        PlayMethod: "DirectStream",
      }),
      allowInsecureRequest: true,
      timeout: 10,
    })
  } catch {}
}
