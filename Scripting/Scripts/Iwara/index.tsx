// Iwara 视频播放器 - 底部 Tab 导航
// API: https://api.iwara.tv

import {
  Navigation, NavigationStack, List, Section, Text, VStack, HStack,
  Image, Script, Button, Menu, useState, useEffect, useMemo,
  ScrollView, Divider, ProgressView, AVPlayerView, useObservable,
  PIPStatus, TabView, Tab, SecureField, TextField,
} from "scripting"
import { fetch } from "scripting"

// ============================================================
// 类型定义
// ============================================================

type VideoFile = {
  id: string
  type: string
  path: string
  name: string
  mime: string
  size: number
  width: number
  height: number
  duration: number
}

type UserBrief = {
  id: string
  name: string
  username: string
  avatar: {
    id: string
    name: string
    path: string
    mime: string
  } | null
}

type TagItem = {
  id: string
  type: string
  sensitive: boolean
}

type VideoItem = {
  id: string
  title: string
  rating: string
  thumbnail: number
  numLikes: number
  numViews: number
  file: VideoFile | null
  user: UserBrief
  tags: TagItem[]
  createdAt: string
}

type VideoDetail = {
  id: string
  title: string
  rating: string
  thumbnail: number
  numLikes: number
  numViews: number
  file: VideoFile | null
  user: UserBrief
  tags: TagItem[]
  fileUrl: string | null
  body: string | null
  createdAt: string
  liked?: boolean
}

type FileSource = {
  name: string
  src: {
    view: string
    download: string
  }
  type: string
}

type UserInfo = {
  id: string
  name: string
  username: string
  role: string
  premium: boolean
}

// ============================================================
// 常量
// ============================================================

const API_BASE = "https://api.iwara.tv"
const STORAGE_AUTH = "iwara_auth"
const STORAGE_USER = "iwara_user"
const STORAGE_ACCESS = "iwara_access"
const STORAGE_SITE = "iwara_site"
const STORAGE_EMAIL = "iwara_email"

const SORT_OPTIONS = [
  { label: "🔥 热门", value: "trending" },
  { label: "⭐ 最受欢迎", value: "popularity" },
  { label: "📅 最新", value: "date" },
  { label: "👁️ 最多观看", value: "views" },
  { label: "❤️ 最多点赞", value: "likes" },
]

const TV_TAGS = [
  { id: "vam", label: "VAM" },
  { id: "blender", label: "Blender" },
  { id: "honkai", label: "崩坏" },
  { id: "blue_archive", label: "碧蓝档案" },
  { id: "hololive", label: "Hololive" },
  { id: "fate", label: "Fate" },
  { id: "nikke", label: "NIKKE" },
  { id: "wuthering_waves", label: "鸣潮" },
  { id: "azur_lane", label: "碧蓝航线" },
  { id: "star_rail", label: "星穹铁道" },
]

const AI_TAGS = [
  { id: "ai_generated", label: "AI 生成" },
  { id: "ai_voice", label: "AI 配音" },
  { id: "anime_style", label: "动漫风格" },
  { id: "honkai", label: "崩坏" },
  { id: "blue_archive", label: "碧蓝档案" },
  { id: "star_rail", label: "星穹铁道" },
  { id: "hololive", label: "Hololive" },
]

function getTags(siteMode: string) {
  return siteMode === "ai" ? AI_TAGS : TV_TAGS
}

// ============================================================
// 认证管理（Storage 持久化）
// ============================================================

function saveAuth(token: string) { Storage.set(STORAGE_AUTH, token) }
function loadAuth(): string | null { return Storage.get(STORAGE_AUTH) || null }
function clearAuth() { Storage.remove(STORAGE_AUTH); Storage.remove(STORAGE_USER); Storage.remove(STORAGE_ACCESS) }

function saveUser(user: UserInfo) { Storage.set(STORAGE_USER, JSON.stringify(user)) }
function loadUser(): UserInfo | null {
  const raw = Storage.get<string>(STORAGE_USER)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Referer": "https://www.iwara.tv/",
  }
  const token = loadAuth()
  if (token) {
    headers["Authorization"] = "Bearer " + token
  }
  return headers
}

// 邮箱密码登录：POST /user/login → 返回 refresh_token
async function loginWithEmail(email: string, password: string): Promise<string | null> {
  try {
    const r = await fetch(API_BASE + "/user/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Origin": "https://www.iwara.tv",
        "Referer": "https://www.iwara.tv/login",
      },
      body: JSON.stringify({ email: email, password: password }),
      timeout: 15,
    })
    if (r.status === 429) {
      console.log("Login rate limited")
      return null
    }
    if (!r.ok) {
      const text = await r.text()
      console.log("Login failed: " + r.status + " " + text.substring(0, 100))
      return null
    }
    const data = await r.json()
    // 登录成功后服务器返回 token（JWT refresh_token）
    if (data.token) {
      return data.token as string
    }
    return null
  } catch (e: any) {
    console.log("Login error: " + e.message)
    return null
  }
}

// access_token 管理（自动刷新）
let _cachedAccessToken: string | null = null

function loadAccessToken(): string | null {
  if (_cachedAccessToken) return _cachedAccessToken
  const stored = Storage.get<string>(STORAGE_ACCESS)
  if (stored) _cachedAccessToken = stored as string
  return (stored as string) || null
}
function saveAccessToken(token: string) {
  _cachedAccessToken = token
  Storage.set(STORAGE_ACCESS, token)
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = loadAuth()
  if (!refreshToken) return null
  // 重试 3 次，间隔逐步增加（对抗 Cloudflare 临时限流）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(API_BASE + "/user/token", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + refreshToken,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          "Referer": "https://www.iwara.tv/",
        },
        body: JSON.stringify({ refreshToken: refreshToken }),
        timeout: 15,
      })
      if (r.ok) {
        const data = await r.json()
        if (data.accessToken) {
          saveAccessToken(data.accessToken)
          return data.accessToken
        }
      }
      // 429 限流时等待后重试
      if (r.status === 429 && attempt < 2) {
        await new Promise<void>(function(resolve) { setTimeout(resolve as () => void, (attempt + 1) * 2000) })
        continue
      }
      return null
    } catch {
      if (attempt < 2) {
        await new Promise<void>(function(resolve) { setTimeout(resolve as () => void, (attempt + 1) * 2000) })
        continue
      }
      return null
    }
  }
  return null
}

async function getValidAccessToken(): Promise<string | null> {
  let token = loadAccessToken()
  if (token) return token
  return await refreshAccessToken()
}

async function getWriteHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Referer": "https://www.iwara.tv/",
  }
  // 优先用 access_token（收藏/点赞等 API 需要）
  const token = await getValidAccessToken()
  if (token) {
    headers["Authorization"] = "Bearer " + token
    return headers
  }
  // fallback: 用 refresh_token
  const refreshToken = loadAuth()
  if (refreshToken) {
    headers["Authorization"] = "Bearer " + refreshToken
  }
  return headers
}

// ============================================================
// API 服务
// ============================================================

async function fetchVideos(options: {
  limit?: number; page?: number; sort?: string; tags?: string; siteMode?: string
} = {}): Promise<{ count: number; results: VideoItem[] }> {
  const { limit = 20, page = 0, sort = "date", tags = "", siteMode = "tv" } = options

  const params = new URLSearchParams()
  params.set("limit", String(limit))
  params.set("page", String(page))
  if (sort) params.set("sort", sort)
  params.set("rating", siteMode === "tv" ? "ecchi" : "all")
  if (tags) params.set("tags", tags)

  // 尝试多个 API 端点 (videos 是主要端点，video 已废弃)
  const endpoints = [
    API_BASE + "/videos?" + params.toString(),
    API_BASE + "/video?" + params.toString(),
  ]

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        timeout: 15,
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          "Referer": siteMode === "ai" ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
          "Origin": siteMode === "ai" ? "https://www.iwara.ai" : "https://www.iwara.tv",
          "X-Site": siteMode === "ai" ? "www.iwara.ai" : "www.iwara.tv",
        },
      })
      if (response.ok) return response.json()
    } catch (e) { continue }
  }
  throw new Error("API Error: 所有端点都失败")
}

async function fetchVideoDetail(id: string, forceSiteMode?: string): Promise<VideoDetail> {
  const siteMode = forceSiteMode || Storage.get(STORAGE_SITE) as string || "tv"
  const isAi = siteMode === "ai"
  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Referer": isAi ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
    "Origin": isAi ? "https://www.iwara.ai" : "https://www.iwara.tv",
    ...getAuthHeaders(),
    ...(isAi ? { "X-Site": "www.iwara.ai" } : { "X-Site": "www.iwara.tv" }),
  }
  const response = await fetch(API_BASE + "/video/" + id, {
    timeout: 15,
    headers: headers,
  })
  if (!response.ok) throw new Error("API Error: " + response.status)
  return response.json()
}

async function fetchFileSources(fileUrl: string): Promise<FileSource[]> {
  const siteMode = Storage.get(STORAGE_SITE) as string || "tv"
  const isAi = siteMode === "ai"
  const response = await fetch(fileUrl, {
    timeout: 15,
    headers: {
      ...(await getWriteHeaders()),
      "Referer": isAi ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
      ...(isAi ? {
        "Origin": "https://www.iwara.ai",
        "X-Site": "www.iwara.ai",
      } : {}),
    },
  })
  if (!response.ok) throw new Error("File source error: " + response.status)

  const data = await response.json()
  if (Array.isArray(data)) return data as FileSource[]
  if (data.results && Array.isArray(data.results)) return data.results as FileSource[]
  return []
}

async function fetchCurrentUser(): Promise<UserInfo | null> {
  try {
    const authToken = loadAuth()
    if (!authToken) return null

    const response = await fetch(API_BASE + "/user", {
      timeout: 10,
      headers: getAuthHeaders(),
    })
    if (!response.ok) {
      return null
    }
    const data = await response.json()
    const user: UserInfo | null = data && data.user ? data.user as UserInfo : data as UserInfo
    if (user && user.id) {
      saveUser(user)
      return user
    }
    return null
  } catch {
    return null
  }
}

async function likeVideo(videoId: string): Promise<boolean> {
  try {
    const response = await fetch(API_BASE + "/video/" + videoId + "/like", {
      method: "POST",
      timeout: 10,
      headers: await getWriteHeaders(),
    })
    return response.ok
  } catch {
    return false
  }
}

async function unlikeVideo(videoId: string): Promise<boolean> {
  try {
    // 网站用 DELETE 取消点赞
    const response = await fetch(API_BASE + "/video/" + videoId + "/like", {
      method: "DELETE",
      timeout: 10,
      headers: await getWriteHeaders(),
    })
    return response.ok
  } catch {
    return false
  }
}

async function fetchFavorites(): Promise<VideoItem[]> {
  try {
    const siteMode = Storage.get(STORAGE_SITE) as string || "tv"
    const isAi = siteMode === "ai"
    const headers = {
      ...(await getWriteHeaders()),
      "Referer": isAi ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
      "Origin": isAi ? "https://www.iwara.ai" : "https://www.iwara.tv",
      "X-Site": isAi ? "www.iwara.ai" : "www.iwara.tv",
    }
    const endpoints = [
      API_BASE + "/favorites/videos?limit=50&page=0",
      API_BASE + "/favorite/videos?limit=50&page=0",
    ]
    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          timeout: 15,
          headers: headers,
        })
        if (response.ok) {
          const data = await response.json()
          if (data.results && Array.isArray(data.results)) {
            return data.results.map(function(item: any) { return item.video || item }).filter(function(v: any) { return v && v.id })
          }
          if (Array.isArray(data)) return data as VideoItem[]
          return []
        }
      } catch (e) { continue }
    }
    return []
  } catch (e) {
    console.log("fetchFavorites catch:", String(e))
    return []
  }
}

function getThumbnailUrl(video: VideoItem): string {
  if (!video.file || !video.file.id) {
    // 无 file.id 时尝试用 video.id 构造缩略图
    return "https://i.iwara.tv/image/thumbnail/" + video.id + "/thumbnail-00.jpg"
  }
  var idx = String(video.thumbnail != null ? video.thumbnail : 0).padStart(2, "0")
  return "https://i.iwara.tv/image/thumbnail/" + video.file.id + "/thumbnail-" + idx + ".jpg"
}

function formatDuration(d: number): string {
  return Math.floor(d / 60) + ":" + String(Math.floor(d % 60)).padStart(2, "0")
}

function formatCount(c: number): string {
  if (c >= 10000) return (c / 10000).toFixed(1) + "万"
  if (c >= 1000) return (c / 1000).toFixed(1) + "k"
  return String(c)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days === 0) return "今天"
  if (days === 1) return "昨天"
  if (days < 7) return days + "天前"
  return (d.getMonth() + 1) + "/" + d.getDate()
}

// ============================================================
// 主应用 - Tab 导航
// ============================================================

function App() {
  const tabSelection = useObservable<number>(0)

  return (
    <TabView selection={tabSelection}>
      <Tab title="主页" systemImage="house.fill" value={0}>
        <HomeTabView />
      </Tab>
      <Tab title="喜欢" systemImage="heart.fill" value={1}>
        <FavoritesTabView />
      </Tab>
      <Tab title="设置" systemImage="gearshape.fill" value={2}>
        <SettingsTabView />
      </Tab>
    </TabView>
  )
}

// ============================================================
// 主页 Tab
// ============================================================

function HomeTabView() {
  function openPlayer(videoId: string, title: string) {
    Navigation.present({
      element: <PlayerView videoId={videoId} title={title} />,
      modalPresentationStyle: "fullScreen",
    })
  }
  return <VideoListView onPlayVideo={openPlayer} />
}

// ============================================================
// 视频列表
// ============================================================

function VideoListView({ onPlayVideo }: { onPlayVideo: (id: string, title: string) => void }) {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState("date")
  const [selectedTag, setSelectedTag] = useState("")
  const [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(true)
  const [siteMode, setSiteMode] = useState(Storage.get(STORAGE_SITE) as string || "tv")

  async function loadVideos(reset: boolean) {
    try {
      const currentPage = reset ? 0 : page
      if (reset) { setLoading(true); setError("") }
      else { setLoadingMore(true) }

      const result = await fetchVideos({
        limit: 20, page: currentPage, sort: sort, tags: selectedTag, siteMode: siteMode,
      })

      if (reset) {
        setVideos(result.results)
      } else {
        setVideos(function(prev) { return [...prev, ...result.results] })
      }
      setCount(result.count)
      const loaded = currentPage * 20 + result.results.length
      setHasMore(loaded < result.count)
      setPage(reset ? 1 : currentPage + 1)
    } catch (e: any) {
      setError(e.message || "加载失败")
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }

  useEffect(function() { loadVideos(true) }, [sort, selectedTag, siteMode])

  async function onRefresh() { setRefreshing(true); await loadVideos(true) }
  async function onLoadMore() { if (!hasMore || loadingMore) return; await loadVideos(false) }

  const sortLabel = SORT_OPTIONS.find(function(s) { return s.value === sort })?.label || sort

  return (
    <NavigationStack>
      <List
        navigationTitle={siteMode === "tv" ? "Iwara" : "Iwara AI"}
        navigationBarTitleDisplayMode={"inline"}
        refreshable={onRefresh}
        toolbar={{
          topBarTrailing: [
            <Menu title={sortLabel} systemImage={"arrow.up.arrow.down"}>
              {SORT_OPTIONS.map(function(opt) {
                return <Button key={opt.value} action={function() { setSort(opt.value) }} title={(opt.value === sort ? "✓ " : "") + opt.label} />
              })}
            </Menu>,
          ],
          topBarLeading: [
            <Menu title={"分类"} systemImage={"tag"}>
              <Button action={function() { setSelectedTag("") }} title={selectedTag === "" ? "✓ 全部" : "全部"} />
              {getTags(siteMode).map(function(tag) {
                return <Button key={tag.id} action={function() { setSelectedTag(tag.id) }} title={(selectedTag === tag.id ? "✓ " : "") + tag.label} />
              })}
            </Menu>,
            <Button
              action={function() {
                const next = siteMode === "tv" ? "ai" : "tv"
                setSiteMode(next)
                setSelectedTag("")
                Storage.set(STORAGE_SITE, next)
              }}
              title={siteMode === "tv" ? "TV" : "AI"}
              foregroundStyle={siteMode === "tv" ? "systemBlue" : "systemGreen"}
            />,
          ],
        }}
      >
        {error ? <Section><Text foregroundStyle={"red"}>{error}</Text></Section> : null}

        {loading ? (
          <Section><VStack padding={20}><ProgressView /></VStack></Section>
        ) : videos.length === 0 ? (
          <Section><Text padding={20} foregroundStyle={"secondaryLabel"}>暂无视频</Text></Section>
        ) : (
          <Section header={<Text textCase={null}>共 {count} 个视频</Text>}>
            {videos.filter(function(v) { return v.file }).map(function(video, index, arr) {
              return (
                <VideoCell
                  key={video.id}
                  video={video}
                  onTap={function() { onPlayVideo(video.id, video.title) }}
                  isLast={index === arr.length - 1}
                  onAppear={index === arr.length - 1 && hasMore ? onLoadMore : undefined}
                />
              )
            })}
            {loadingMore ? <VStack padding={10}><ProgressView /></VStack> : null}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ============================================================
// 视频卡片
// ============================================================

function VideoCell({
  video, onTap, isLast, onAppear,
}: {
  video: VideoItem; onTap: () => void; isLast: boolean; onAppear?: () => void
}) {
  useEffect(function() { if (isLast && onAppear) onAppear() }, [isLast])

  const thumbnail = getThumbnailUrl(video)
  const duration = video.file ? formatDuration(video.file.duration) : ""

  const categoryTags = video.tags
    .filter(function(t) { return t.type === "category" || t.type === "source" })
    .slice(0, 2)
    .map(function(t) { return t.id })

  return (
    <Button action={onTap} foregroundStyle={"label"}>
      <HStack padding={8}>
        <VStack>
          {thumbnail ? (
            <Image imageUrl={thumbnail} frame={{ width: 120, height: 68 }} resizable={true} clipShape={{ type: "rect", cornerRadius: 8 }} />
          ) : (
            <VStack frame={{ width: 120, height: 68 }} background={"systemGray6"}>
              <Text font={"caption"} foregroundStyle={"secondaryLabel"}>无图</Text>
            </VStack>
          )}
        </VStack>
        <VStack padding={{ leading: 8 }} spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text font={"subheadline"} fontWeight={"semibold"} lineLimit={2}>{video.title}</Text>
          <Text font={"caption"} foregroundStyle={"secondaryLabel"}>{video.user.name || video.user.username}</Text>
          <HStack spacing={8}>
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>👁️{formatCount(video.numViews)}</Text>
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>❤️{formatCount(video.numLikes)}</Text>
            {duration ? <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>{duration}</Text> : null}
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>{formatDate(video.createdAt)}</Text>
          </HStack>
          {categoryTags.length > 0 ? (
            <HStack spacing={4}>
              {categoryTags.map(function(tag) {
                return <Text key={tag} font={"caption2"} foregroundStyle={"systemBlue"}>#{tag}</Text>
              })}
            </HStack>
          ) : null}
        </VStack>
      </HStack>
    </Button>
  )
}

// ============================================================
// 喜欢 Tab
// ============================================================

function FavoritesTabView() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const dismiss = Navigation.useDismiss()

  useEffect(function() { loadFavorites() }, [])

  async function loadFavorites() {
    try {
      setLoading(true)
      const token = loadAuth()
      if (!token) {
        setLoggedIn(false)
        return
      }
      setLoggedIn(true)
      const favs = await fetchFavorites()
      setVideos(favs)
    } catch {
      setLoggedIn(false)
    } finally {
      setLoading(false)
    }
  }

  function openPlayer(videoId: string, title: string) {
    Navigation.present({
      element: <PlayerView videoId={videoId} title={title} />,
      modalPresentationStyle: "fullScreen",
    })
  }

  if (!loggedIn) {
    return (
      <NavigationStack>
        <List navigationTitle={"我的喜欢"} navigationBarTitleDisplayMode={"inline"}
          toolbar={{
            topBarLeading: [
              <Button action={dismiss} title={""} systemImage={"xmark"} />,
            ],
          }}
        >
          <Section>
            <VStack padding={30} spacing={12} alignment={"center"}>
              <Image systemName={"heart.slash"} font={"largeTitle"} foregroundStyle={"secondaryLabel"} />
              <Text foregroundStyle={"secondaryLabel"}>请先到「设置」Tab</Text>
              <Text foregroundStyle={"secondaryLabel"}>运行 setup_token.tsx 或手动填写 Token</Text>
            </VStack>
          </Section>
        </List>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={"我的喜欢"}
        navigationBarTitleDisplayMode={"inline"}
        refreshable={loadFavorites}
        toolbar={{
          topBarLeading: [
            <Button action={dismiss} title={""} systemImage={"xmark"} />,
          ],
        }}
      >
        {loading ? (
          <Section><VStack padding={20}><ProgressView /></VStack></Section>
        ) : videos.length === 0 ? (
          <Section><Text padding={20} foregroundStyle={"secondaryLabel"}>还没有喜欢的视频</Text></Section>
        ) : (
          <Section>
            {videos.filter(function(v) { return v.file }).map(function(video) {
              return (
                <VideoCell
                  key={video.id} video={video}
                  onTap={function() { openPlayer(video.id, video.title) }}
                  isLast={false}
                />
              )
            })}
            {videos.some(function(v) { return !v.file }) ? (
              <Text padding={12} foregroundStyle={"secondaryLabel"} font={"caption"}>
                {videos.filter(function(v) { return !v.file }).length} 个视频暂不可用（已删除或不可访问）
              </Text>
            ) : null}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ============================================================
// 设置 Tab
// ============================================================

function SettingsTabView() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [user, setUser] = useState<UserInfo | null>(null)
  const [status, setStatus] = useState("")
  const [loggingIn, setLoggingIn] = useState(false)
  const dismiss = Navigation.useDismiss()

  useEffect(function() {
    checkAuth()
  }, [])

  async function checkAuth() {
    const saved = loadAuth()
    if (saved) {
      // 立即从缓存加载用户，不等 API
      const cached = loadUser()
      if (cached) {
        setUser(cached)
        setStatus("已登录")
      } else {
        setStatus("验证 token...")
      }
      // 后台验证用户信息
      const currentUser = await fetchCurrentUser()
      if (currentUser) {
        setUser(currentUser)
        saveUser(currentUser)
        setStatus("已登录: " + (currentUser.name || currentUser.username))
        setEmail(Storage.get(STORAGE_EMAIL) as string || "")
        return
      }
      // 验证失败，保留缓存显示
      if (cached) {
        setStatus("token 可能已过期")
      } else {
        setUser(null)
        setStatus("")
      }
    }
    // 回填邮箱
    const savedEmail = Storage.get(STORAGE_EMAIL) as string
    if (savedEmail) setEmail(savedEmail)
  }

  async function handleLogin() {
    const e = email.trim()
    const p = password.trim()
    if (!e || !p) { setStatus("请输入邮箱和密码"); return }

    setLoggingIn(true)
    setStatus("登录中...")

    console.log("开始登录: " + e)
    const token = await loginWithEmail(e, p)
    console.log("token 返回: " + (token ? token.substring(0, 20) + "..." : "null"))
    if (token) {
      saveAuth(token)
      console.log("已保存 auth, 检查 Storage...")
      console.log("iwara_auth: " + (Storage.get("iwara_auth") ? "ok" : "null"))
      Storage.set(STORAGE_EMAIL, e)
      setStatus("✅ 登录成功，验证中...")
      const currentUser = await fetchCurrentUser()
      if (currentUser) {
        setUser(currentUser)
        saveUser(currentUser)
        setStatus("✅ 登录成功: " + (currentUser.name || currentUser.username))
        // 自动刷新 access_token
        const at = await refreshAccessToken()
        console.log("access_token: " + (at ? "ok" : "null"))
      } else {
        setStatus("✅ token 已获取，但验证用户失败")
      }
    } else {
      setStatus("❌ 登录失败，请检查邮箱密码是否正确（注意：登录失败次数过多会被临时封禁）")
    }
    setLoggingIn(false)
  }

  function handleLogout() {
    clearAuth()
    setUser(null)
    setStatus("已退出登录")
    setPassword("")
  }

  async function handleRefreshCookie() {
    setStatus("刷新 token...")
    try {
      const at = await refreshAccessToken()
      if (at) {
        setStatus("✅ access_token 已刷新")
        // 顺便验证用户（不验证也能保持登录）
        const currentUser = await fetchCurrentUser()
        if (currentUser) {
          setUser(currentUser)
          saveUser(currentUser)
          setStatus("✅ Cookie 已刷新: " + (currentUser.name || currentUser.username))
        }
      } else {
        setStatus("❌ 刷新失败（令牌可能已过期），请尝试重新登录")
      }
    } catch (e: any) {
      setStatus("❌ 刷新失败: " + e.message)
    }
  }

  return (
    <NavigationStack>
      <List navigationTitle={"设置"} navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: [
            <Button action={dismiss} title={""} systemImage={"xmark"} />,
          ],
        }}
      >
        {/* 登录 */}
        <Section header={<Text>登录</Text>}>
          {user ? (
            <>
              <HStack>
                <Image systemName={"person.circle.fill"} font={"largeTitle"} foregroundStyle={"systemBlue"} />
                <VStack padding={{ leading: 12 }}>
                  <Text fontWeight={"bold"}>{user.name || user.username}</Text>
                  <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
                    {user.premium ? "⭐ Premium" : "普通用户"}
                    {" · ID: " + user.id.substring(0, 8) + "…"}
                  </Text>
                </VStack>
              </HStack>
              <Text font={"caption"} foregroundStyle={status.includes("成功") || status.includes("已登录") ? "green" : "orange"}>
                {status}
              </Text>
              <Button title="刷新 Cookie" action={handleRefreshCookie} />
              <Button title="退出登录" foregroundStyle={"red"} action={handleLogout} />
            </>
          ) : (
            <>
              <TextField
                title={"邮箱"}
                value={email}
                onChanged={setEmail}
                prompt={"输入注册邮箱"}
              />
              <SecureField
                title={"密码"}
                value={password}
                onChanged={setPassword}
                prompt={"输入密码"}
              />
              <Button
                title={loggingIn ? "登录中..." : "登录"}
                action={handleLogin}
                padding={12}
                disabled={loggingIn}
              />
              {status ? (
                <Text font={"caption"} foregroundStyle={
                  status.includes("成功") || status.includes("已登录") ? "green" :
                  status.includes("失败") ? "red" :
                  "secondaryLabel"
                }>
                  {status}
                </Text>
              ) : (
                <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
                  输入邮箱和密码即可登录，Token 自动持久化
                </Text>
              )}
            </>
          )}
        </Section>

        {/* 关于 */}
        <Section header={<Text>关于</Text>}>
          <VStack padding={12} spacing={4}>
            <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
              Iwara 视频播放器 v1.1
            </Text>
            <Text font={"caption"} foregroundStyle={"secondaryLabel"}>
              Token 首次运行自动保存，来自浏览器
            </Text>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

// ============================================================
// 播放器视图
// ============================================================

function PlayerView({ videoId, title }: { videoId: string; title: string }) {
  const [detail, setDetail] = useState<VideoDetail | null>(null)
  const [sources, setSources] = useState<FileSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedQuality, setSelectedQuality] = useState("")
  const [currentSource, setCurrentSource] = useState("")
  const [isPlaying, setIsPlaying] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [liking, setLiking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadBytes, setDownloadBytes] = useState("")
  const [downloadMessage, setDownloadMessage] = useState("")
  const pipStatus = useObservable<PIPStatus>()
  const dismiss = Navigation.useDismiss()

  const player = useMemo(function() { return new AVPlayer() }, [])

  useEffect(function() {
    Device.supportedInterfaceOrientations = ["portrait", "landscapeLeft", "landscapeRight"]
    loadVideo()
    return function() {
      Device.supportedInterfaceOrientations = ["portrait"]
      player.pause()
      player.dispose()
    }
  }, [])

  async function loadVideo() {
    try {
      setLoading(true); setError("")

      let videoDetail = await fetchVideoDetail(videoId)
      setDetail(videoDetail)
      setLiked(videoDetail.liked === true)
      setLikeCount(videoDetail.numLikes)

      // 如果当前 site 获取不到 fileUrl，尝试另一个 site
      const currentSite = Storage.get(STORAGE_SITE) as string || "tv"
      if (!videoDetail.fileUrl) {
        const otherSite = currentSite === "ai" ? "tv" : "ai"
        Storage.set(STORAGE_SITE, otherSite)
        try {
          const retryDetail = await fetchVideoDetail(videoId)
          if (retryDetail.fileUrl) {
            videoDetail = retryDetail
            setDetail(retryDetail)
          }
        } catch {}
      }

      if (videoDetail.fileUrl) {
        const downloadName = videoDetail.title + " [" + videoDetail.id + "].mp4"
        const fileUrlWithDownload = videoDetail.fileUrl + "&download=" + encodeURIComponent(downloadName)
        const fileSources = await fetchFileSources(fileUrlWithDownload)

        const qualityRank: Record<string, number> = {
          "360": 2, "preview": 1
        }
        fileSources.sort(function(a, b) {
          return (qualityRank[b.name] || 0) - (qualityRank[a.name] || 0)
        })

        setSources(fileSources)

        const bestSource = fileSources.find(function(s) { return s.name === "360" }) || fileSources[0]
        if (bestSource && bestSource.src.view) {
          const videoUrl = "https:" + bestSource.src.view
          setCurrentSource(videoUrl); setSelectedQuality(bestSource.name)

          player.setSource(videoUrl, {
            headers: {
              "Referer": (Storage.get(STORAGE_SITE) as string) === "ai" ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
              "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
              ...getAuthHeaders(),
            }
          })
          player.onReadyToPlay = function() { player.play(); setIsPlaying(true) }
          player.onEnded = function() { setIsPlaying(false) }
          player.onError = function(msg: string) { console.error("Playback error:", msg) }

          await SharedAudioSession.setActive(true)
          await SharedAudioSession.setCategory("playback", ["mixWithOthers"])
          return
        }
      }
      // 视频源不可用 → 恢复原始 site 模式后直接返回
      Storage.set(STORAGE_SITE, currentSite)
      dismiss()
    } catch (e: any) {
      setError(e.message || "加载视频失败")
    } finally {
      setLoading(false)
    }
  }

  function switchQuality(source: FileSource) {
    if (!source.src.view) return
    setSelectedQuality(source.name)
    const videoUrl = "https:" + source.src.view
    setCurrentSource(videoUrl)
    player.pause()
    player.setSource(videoUrl, {
      headers: {
        "Referer": (Storage.get(STORAGE_SITE) as string) === "ai" ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        ...getAuthHeaders(),
      }
    })
    player.onReadyToPlay = function() { player.play(); setIsPlaying(true) }
  }


  async function toggleLike() {
    if (liking) return
    setLiking(true)
    const ok = liked ? await unlikeVideo(videoId) : await likeVideo(videoId)
    if (ok) {
      setLiked(!liked)
      setLikeCount(function(p) { return liked ? p - 1 : p + 1 })
    }
    setLiking(false)
  }

  async function handleDownload() {
    if (downloading || !currentSource) return
    setDownloading(true)
    setDownloadProgress(0)
    setDownloadBytes("")
    setDownloadMessage("")

    try {
      const siteMode = Storage.get(STORAGE_SITE) as string || "tv"
      const videoUrl = currentSource
      const fileName = ((detail?.title || title || "video") + ".mp4").replace(/[\\/:*?"<>|]/g, "_")
      const tempDir = FileManager.temporaryDirectory
      const destPath = tempDir + "/" + fileName

      // 使用 BackgroundURLSession 后台下载，支持真实进度
      const task = BackgroundURLSession.startDownload({
        url: videoUrl,
        destination: destPath,
        headers: {
          "Referer": siteMode === "ai" ? "https://www.iwara.ai/" : "https://www.iwara.tv/",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          ...getAuthHeaders(),
        },
        notifyOnFinished: {
          success: fileName,
          failure: "下载失败",
        },
      })

      // 真实进度：已下载 MB / 总大小 MB
      task.onProgress = function(details) {
        setDownloadProgress(details.progress)
        const done = (details.totalBytesWritten / 1024 / 1024).toFixed(1)
        const total = (details.totalBytesExpectedToWrite / 1024 / 1024).toFixed(1)
        setDownloadBytes(done + "M / " + total + "M")
      }

      // 等待完成
      await new Promise(function(resolve, reject) {
        task.onFinishDownload = function(error, details) {
          if (error || !details.destination) {
            reject(error || new Error("下载中断"))
          } else {
            resolve(details.destination)
          }
        }
        task.resume()
      })

      // 保存到相册
      setDownloadMessage("正在保存到相册...")
      const saved = await Photos.saveVideo(destPath, { shouldMoveFile: true })

      if (saved) {
        setDownloadProgress(1)
        setDownloadMessage("✅ 已保存到相册")
      } else {
        setDownloadMessage("❌ 保存失败，请检查相册权限")
      }
    } catch (e: any) {
      setDownloadMessage("❌ 下载失败: " + (e.message || "未知错误"))
    }

    setTimeout(function() { setDownloadMessage("") }, 4000)
    setDownloading(false)
  }

  // 点赞/画质按钮列表（供 toolbar 使用）
  const qualityLabels: Record<string, string> = {
    "360": "360p", "preview": "预览",
  }

  const qualityButtons = sources.length > 1 ? sources.map(function(source) {
    const label = qualityLabels[source.name] || source.name + "p"
    return (
      <Button
        key={source.name}
        action={function() { switchQuality(source) }}
        title={label}
        background={selectedQuality === source.name ? "systemBlue" : "systemGray5"}
        foregroundStyle={selectedQuality === source.name ? "white" : "label"}
      />
    )
  }) : null

  return (
    <NavigationStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        toolbar={{
          topBarLeading: [
            <Button action={function() { dismiss() }} title={"  关闭"} systemImage={"xmark"} />,
          ],
          topBarTrailing: [
            <Button
              action={toggleLike}
              disabled={liking}
              title={liked ? "赞✓ " + formatCount(likeCount) : "赞 " + formatCount(likeCount)}
              foregroundStyle={liked ? "red" : "secondaryLabel"}
            />,
            <Button
              action={handleDownload}
              disabled={downloading}
              title={downloading ? "下载中" : "下载"}
              systemImage={downloading ? "arrow.down.circle.dotted" : "arrow.down.circle"}
              foregroundStyle={downloading ? "systemGray" : "systemGreen"}
            />,
          ],
        }}
      >
        {loading ? (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <ProgressView />
            <Text padding={8}>加载视频中...</Text>
          </VStack>
        ) : error ? (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={20}>
            <Text foregroundStyle={"red"}>{error}</Text>
            <Button action={loadVideo} title={"重新加载"} foregroundStyle={"systemBlue"} padding={16} />
          </VStack>
        ) : currentSource ? (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <AVPlayerView
                player={player}
                pipStatus={pipStatus}
                entersFullScreenWhenPlaybackBegins={true}
                videoGravity={"resizeAspect"}
              />

            <Divider />

            {/* 视频信息 */}
            <ScrollView padding={12} frame={{ maxWidth: "infinity" }}>
              <VStack spacing={8}>
                <Text font={"headline"}>{detail?.title || title}</Text>

                <HStack spacing={12}>
                  <Text font={"subheadline"} foregroundStyle={"secondaryLabel"}>
                    👤 {detail?.user?.name || detail?.user?.username || "未知"}
                  </Text>
                  <Text font={"subheadline"} foregroundStyle={"secondaryLabel"}>
                    👁️ {detail ? formatCount(detail.numViews) : "?"}
                  </Text>
                  <Text font={"subheadline"} foregroundStyle={"secondaryLabel"}>
                    ❤️ {detail ? formatCount(detail.numLikes) : "?"}
                  </Text>
                </HStack>

                {/* 画质选择 */}
                {qualityButtons ? (
                  <VStack spacing={6}>
                    <Text font={"subheadline"} fontWeight={"semibold"}>画质选择</Text>
                    <ScrollView axes={"horizontal"}>
                      <HStack spacing={8}>
                        {qualityButtons}
                      </HStack>
                    </ScrollView>
                  </VStack>
                ) : null}

                {/* 标签 */}
                {detail?.tags && detail.tags.length > 0 ? (
                  <VStack spacing={4}>
                    <Text font={"caption"} foregroundStyle={"secondaryLabel"}>标签</Text>
                    <HStack spacing={4}>
                      {detail.tags.map(function(tag: TagItem) {
                        return (
                          <Text key={tag.id} font={"caption2"} foregroundStyle={tag.sensitive ? "red" : "systemBlue"}>
                            #{tag.id}
                          </Text>
                        )
                      })}
                    </HStack>
                  </VStack>
                ) : null}
              </VStack>
            </ScrollView>

            {/* 下载进度 */}
            {downloading ? (
              <VStack padding={{ top: 8, leading: 12, bottom: 4, trailing: 12 }} spacing={4}>
                <HStack spacing={8}>
                  <ProgressView />
                  <Text font="caption2">{downloadBytes || "下载中..."}</Text>
                </HStack>
              </VStack>
            ) : null}
            {downloadMessage ? (
              <Text padding={{ top: 4, leading: 12, bottom: 12, trailing: 8 }} font="caption" foregroundStyle={
                downloadMessage.includes("✅") ? "green" :
                downloadMessage.includes("❌") ? "red" :
                "secondaryLabel"
              }>
                {downloadMessage}
              </Text>
            ) : null}
          </VStack>
        ) : (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            <Text>视频源不可用</Text>
            <Button action={loadVideo} title={"重试"} padding={16} />
          </VStack>
        )}
      </VStack>
    </NavigationStack>
  )
}

// ============================================================
// 入口
// ============================================================

async function run() {
  // 如果有 refresh_token，预刷新 access_token
  if (loadAuth()) {
    try {
      const at = await refreshAccessToken()
      if (at) console.log("✅ access_token ready")
      else console.log("⚠️ access_token refresh failed")
    } catch (e) {
      console.log("⚠️ access_token error: " + e)
    }
  }

  try {
    await Navigation.present({
      element: <App />,
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    Script.exit()
  }
}

run()
