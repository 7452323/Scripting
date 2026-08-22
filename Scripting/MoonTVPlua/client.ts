import { fetch } from "scripting"

// ========== Types ==========
export interface SearchResult {
  id: string
  source: string
  source_name: string
  title: string
  poster: string
  episodes: string[]
  episodes_titles: string[]
  year: string
  desc?: string
  type_name?: string
  douban_id?: number
  weight?: number
  proxyMode?: boolean
}

export interface VideoDetail {
  source: string
  source_name: string
  id: string
  title: string
  poster: string
  year: string
  douban_id: number
  desc: string
  episodes: string[]
  episodes_titles: string[]
  proxyMode: boolean
  category?: string
  type_name?: string
}

export interface DoubanItem {
  id: string
  title: string
  poster: string
  rate: string
  year: string
}

export interface BangumiCalendarDay {
  weekday?: { en?: string; cn?: string }
  items?: Array<{
    id?: string | number
    name?: string
    name_cn?: string
    air_date?: string
    images?: { large?: string; common?: string; medium?: string; small?: string; grid?: string }
    rating?: { score?: number }
  }>
}

export interface UpcomingItem {
  id: number
  title: string
  poster_path: string | null
  release_date: string
  vote_average: number
  media_type: "movie" | "tv"
}

export interface DoubanRecommendFilters {
  kind: "movie" | "tv"
  category?: string
  format?: string
  region?: string
  year?: string
  platform?: string
  label?: string
  sort?: "T" | "U" | "R" | "S"
  start?: number
  limit?: number
}

export interface PlayRecord {
  key: string
  title: string
  source_name: string
  cover: string
  index: number
  total_episodes: number
  play_time: number
  total_time: number
  save_time: number
}

export interface ResourceSource {
  key: string
  name: string
}

export interface ServerConfig {
  SiteName: string
  Version: string
  TVModeEnabled: boolean
  EnableRegistration: boolean
  AIEnabled?: boolean
  AIEnableHomepageEntry?: boolean
  AIEnableVideoCardEntry?: boolean
  AIEnablePlayPageEntry?: boolean
}

export interface BannerItem {
  id: string | number
  title: string
  subtitle?: string
  backdrop_path: string
  poster_path?: string
  release_date?: string
  overview?: string
  vote_average?: number
  media_type?: "movie" | "tv"
  genre_ids?: number[]
  genres?: string[]
  tags?: string[]
  video_key?: string | null
}

export interface BannerResponse {
  code: number
  source: "TMDB" | "Douban" | "TX" | string
  list: BannerItem[]
}

export interface DuanjuSource {
  key: string
  name: string
}

export interface DuanjuCategory {
  id: string
  name: string
}

export interface DuanjuPage {
  items: SearchResult[]
  page: number
  pageCount: number
  total: number
}

export interface RichMediaMetadata {
  tmdbId: number
  mediaType: "movie" | "tv"
  rating: number
  genres: string[]
  runtime: number
  countries: string[]
  status: string
  tagline: string
  cast: Array<{ id: number; name: string; character?: string; profile_path?: string }>
  crew: Array<{ id: number; name: string; job?: string }>
  images: Array<{ file_path: string; imageType?: "backdrop" | "poster" }>
}

// ========== Client ==========
const DEFAULT_BASE = "https://moon.1314k.eu.org"
const STORAGE_KEY_BASE = "moontvplus_base_url"
const STORAGE_KEY_AUTH = "moontvplus_auth"
const STORAGE_KEY_USERNAME = "moontvplus_username"
const KEYCHAIN_KEY_PASSWORD = "moontvplus_password"
const SEARCH_CACHE_PREFIX = "moontvplus_search_cache_"
const SEARCH_CACHE_TTL = 10 * 60 * 1000

class MoonTVClient {
  private authCookie: string | null = null
  private baseUrl: string = DEFAULT_BASE

  constructor() {
    // Restore saved auth
    const saved = Storage.get<string>(STORAGE_KEY_AUTH)
    if (saved) this.authCookie = saved
    const savedBase = Storage.get<string>(STORAGE_KEY_BASE)
    if (savedBase) this.baseUrl = savedBase
  }

  getBaseUrl(): string { return this.baseUrl }
  setBaseUrl(url: string): void { this.baseUrl = url.replace(/\/$/, ""); Storage.set(STORAGE_KEY_BASE, this.baseUrl) }
  isLoggedIn(): boolean { return this.authCookie !== null }
  getSavedUsername(): string { return Storage.get<string>(STORAGE_KEY_USERNAME) || "" }

  // ========== Auth ==========
  async login(username: string, password: string): Promise<boolean> {
    const resp = await fetch(`${this.baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    if (!resp.ok) {
      const err = await resp.text()
      let msg = "登录失败"
      try { msg = JSON.parse(err).error || msg } catch {}
      throw new Error(msg)
    }
    const data = await resp.json()
    if (!data.ok) throw new Error(data.error || "登录失败")
    // Extract cookie from response or use token
    this.authCookie = data.token || data.auth?.tokenId || ""
    Storage.set(STORAGE_KEY_AUTH, this.authCookie)
    Storage.set(STORAGE_KEY_USERNAME, username)
    const valid = await this.validateSession()
    if (!valid) throw new Error("登录凭据已返回，但会话验证失败")
    if (!Keychain.set(KEYCHAIN_KEY_PASSWORD, password)) {
      throw new Error("登录成功，但无法安全保存密码")
    }
    return true
  }

  async register(username: string, password: string): Promise<boolean> {
    const resp = await fetch(`${this.baseUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    const data = await resp.json()
    if (!resp.ok || !data.ok) throw new Error(data.message || data.error || "注册失败")
    return true
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/logout`, { headers: this.authHeaders() })
    } catch {}
    this.clearAuth(true)
  }

  async refreshLogin(): Promise<"valid" | "relogged"> {
    const username = this.getSavedUsername()
    const password = Keychain.get(KEYCHAIN_KEY_PASSWORD)
    if (await this.validateSession()) return "valid"
    if (!username || !password) {
      throw new Error("登录已失效，请输入一次密码重新登录")
    }
    await this.login(username, password)
    return "relogged"
  }

  async validateSession(): Promise<boolean> {
    if (!this.authCookie) return false
    try {
      // playrecords is a lightweight protected endpoint.
      const resp = await fetch(`${this.baseUrl}/api/playrecords`, {
        headers: this.authHeaders(),
      })
      if (resp.ok) return true
      if (resp.status === 401 || resp.status === 403) this.clearAuth()
      return false
    } catch {
      // Network errors do not prove the session expired; keep local auth.
      throw new Error("网络连接失败，请稍后重试")
    }
  }

  private searchCacheKey(query: string, mode: "aggregate" | "exact" | "fuzzy"): string {
    const server = encodeURIComponent(this.baseUrl)
    const user = encodeURIComponent(this.getSavedUsername() || "anonymous")
    return `${SEARCH_CACHE_PREFIX}${server}_${user}_${mode}_${query}`
  }

  private async withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: any
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("请求超时")), milliseconds)
    })
    try { return await Promise.race([promise, timeout]) }
    finally { clearTimeout(timer) }
  }

  private clearAuth(clearCredentials = false): void {
    this.authCookie = null
    Storage.remove(STORAGE_KEY_AUTH)
    if (clearCredentials) {
      Storage.remove(STORAGE_KEY_USERNAME)
      Keychain.remove(KEYCHAIN_KEY_PASSWORD)
    }
  }

  // ========== Content ==========
  async search(query: string, forceRefresh = false): Promise<SearchResult[]> {
    const normalized = query.trim()
    if (!normalized) return []
    const cacheKey = this.searchCacheKey(normalized, "aggregate")
    if (!forceRefresh) {
      const cached = Storage.get<{ updatedAt: number; results: SearchResult[] }>(cacheKey)
      if (cached && Date.now() - cached.updatedAt < SEARCH_CACHE_TTL && Array.isArray(cached.results)) {
        return cached.results
      }
    }

    // Match the website's default behavior: do not force special sources.
    // Special sources add extra downstream requests and noticeably delay results.
    const resp = await fetch(`${this.baseUrl}/api/search?q=${encodeURIComponent(normalized)}`, { headers: this.authHeaders() })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("登录已失效，请在设置中重新登录")
      throw new Error(`资源查找失败 (${resp.status})`)
    }
    const data = await resp.json()
    const results = (data.results || []) as SearchResult[]
    Storage.set(cacheKey, { updatedAt: Date.now(), results })
    return results
  }

  async searchProgressively(
    query: string,
    onResults: (newResults: SearchResult[], completed: number, total: number) => void,
    exactTitle = true,
    isCancelled: () => boolean = () => false
  ): Promise<SearchResult[]> {
    const normalized = query.trim()
    if (!normalized) return []

    const cacheKey = this.searchCacheKey(normalized, exactTitle ? "exact" : "fuzzy")
    const cached = Storage.get<{ updatedAt: number; results: SearchResult[] }>(cacheKey)
    if (cached && Date.now() - cached.updatedAt < SEARCH_CACHE_TTL && Array.isArray(cached.results)) {
      if (!isCancelled()) onResults(cached.results, 1, 1)
      return cached.results
    }

    const sourceResp = await this.withTimeout(fetch(`${this.baseUrl}/api/source-search/sources`, { headers: this.authHeaders() }), 15000)
    if (!sourceResp.ok) {
      if (sourceResp.status === 401 || sourceResp.status === 403) throw new Error("登录已失效，请在设置中重新登录")
      if (sourceResp.status === 404 || sourceResp.status === 405) {
        const results = await this.search(normalized, true)
        if (!isCancelled()) onResults(results, 1, 1)
        return results
      }
      throw new Error(`加载资源源失败 (${sourceResp.status})`)
    }
    const sourceData = await sourceResp.json()
    const sources = (sourceData.sources || []) as ResourceSource[]
    if (sources.length === 0) {
      const results = await this.search(normalized, true)
      if (!isCancelled()) onResults(results, 1, 1)
      return results
    }

    const all: SearchResult[] = []
    const seen = new Set<string>()
    let completed = 0
    let authExpired = false
    const total = sources.length
    const append = (items: SearchResult[]) => {
      const added = items.filter(item => {
        const key = `${item.source}+${item.id}`
        if (seen.has(key)) return false
        seen.add(key)
        all.push(item)
        return true
      })
      if (added.length > 0 && !isCancelled() && !authExpired) onResults(added, completed, total)
    }

    let nextIndex = 0
    const worker = async () => {
      while (!isCancelled() && !authExpired) {
        const index = nextIndex++
        if (index >= sources.length) return
        const source = sources[index]
        try {
          const endpoint = exactTitle
            ? `${this.baseUrl}/api/search/one?q=${encodeURIComponent(normalized)}&resourceId=${encodeURIComponent(source.key)}`
            : `${this.baseUrl}/api/source-search/search?source=${encodeURIComponent(source.key)}&keyword=${encodeURIComponent(normalized)}&page=1`
          const resp = await this.withTimeout(fetch(endpoint, { headers: this.authHeaders() }), 15000)
          if (resp.ok) {
            const data = await resp.json()
            append((data.results || []) as SearchResult[])
          } else if (resp.status === 401 || resp.status === 403) {
            authExpired = true
          }
        } catch {
          // A single unstable source must not block the remaining sources.
        } finally {
          completed += 1
          if (!isCancelled() && !authExpired) onResults([], completed, total)
        }
      }
    }
    const workerCount = Math.min(6, sources.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    if (authExpired) throw new Error("登录已失效，请在设置中重新登录")
    if (!isCancelled()) Storage.set(cacheKey, { updatedAt: Date.now(), results: all })
    return all
  }

  async getDetail(id: string, source: string): Promise<VideoDetail> {
    const resp = await fetch(`${this.baseUrl}/api/detail?id=${encodeURIComponent(id)}&source=${encodeURIComponent(source)}&special=1`, { headers: this.authHeaders() })
    if (!resp.ok) {
      const err = await resp.text()
      let msg = "获取详情失败"
      try { msg = JSON.parse(err).error || msg } catch {}
      throw new Error(msg)
    }
    return (await resp.json()) as VideoDetail
  }

  async resolveResourceDetail(result: SearchResult): Promise<VideoDetail> {
    // Normal CMS search already returns full metadata and playable episodes.
    if (Array.isArray(result.episodes) && result.episodes.length > 0) {
      return { ...result, proxyMode: result.proxyMode || false } as VideoDetail
    }
    // Lazy/special sources may omit episodes and require a detail request.
    const detail = await this.getDetail(result.id, result.source)
    return {
      ...detail,
      title: detail.title || result.title,
      poster: detail.poster || result.poster,
      year: detail.year || result.year,
      desc: detail.desc || result.desc || "",
      source_name: detail.source_name || result.source_name,
    }
  }

  async getDoubanCategories(kind: "movie" | "tv", category: string, type: string, start = 0, limit = 25): Promise<DoubanItem[]> {
    const params = `kind=${kind}&category=${encodeURIComponent(category)}&type=${encodeURIComponent(type)}&start=${start}&limit=${limit}`
    const resp = await fetch(`${this.baseUrl}/api/douban/categories?${params}`, { headers: this.authHeaders() })
    if (!resp.ok) throw new Error("获取分类数据失败")
    const data = await resp.json()
    return (data.list || []) as DoubanItem[]
  }

  async getDoubanRecommends(filters: DoubanRecommendFilters): Promise<DoubanItem[]> {
    const params: string[] = [
      `kind=${filters.kind}`,
      `start=${filters.start || 0}`,
      `limit=${filters.limit || 25}`,
    ]
    const values: Array<[string, string | undefined]> = [
      ["category", filters.category], ["format", filters.format],
      ["region", filters.region], ["year", filters.year],
      ["platform", filters.platform], ["label", filters.label],
      ["sort", filters.sort || "T"],
    ]
    values.forEach(([key, value]) => params.push(`${key}=${encodeURIComponent(value || "all")}`))
    const resp = await fetch(`${this.baseUrl}/api/douban/recommends?${params.join("&")}`, { headers: this.authHeaders() })
    if (!resp.ok) throw new Error("获取筛选数据失败")
    const data = await resp.json()
    return (data.list || []) as DoubanItem[]
  }

  async getBangumiCalendar(): Promise<BangumiCalendarDay[]> {
    const resp = await fetch(`${this.baseUrl}/api/bangumi/calendar`, { headers: this.authHeaders() })
    if (!resp.ok) throw new Error(`获取每日放送失败 (${resp.status})`)
    return (await resp.json()) as BangumiCalendarDay[]
  }

  async getTodayBangumi(): Promise<DoubanItem[]> {
    const calendar = await this.getBangumiCalendar()
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const currentWeekday = weekdays[new Date().getDay()]
    const day = calendar.find(item => item.weekday?.en === currentWeekday)
    return (day?.items || []).filter(item => Boolean(item.images)).map(item => ({
      id: String(item.id || ""),
      title: item.name_cn || item.name || "未命名新番",
      poster: item.images?.large || item.images?.common || item.images?.medium || item.images?.small || item.images?.grid || "",
      rate: item.rating?.score ? Number(item.rating.score).toFixed(1) : "",
      year: item.air_date?.split("-")?.[0] || "",
    })).filter(item => Boolean(item.id && item.poster))
  }

  async getUpcomingContent(): Promise<UpcomingItem[]> {
    const resp = await fetch(`${this.baseUrl}/api/tmdb/upcoming`, { headers: this.authHeaders() })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("登录已失效，请重新登录")
      throw new Error(`获取即将上映失败 (${resp.status})`)
    }
    const data = await resp.json()
    const list = (data.data || []) as UpcomingItem[]
    return list.filter(item => Boolean(item.id && item.title)).sort((a, b) => {
      const first = new Date(a.release_date || "9999-12-31").getTime()
      const second = new Date(b.release_date || "9999-12-31").getTime()
      return first - second
    })
  }

  async getDuanjuSources(): Promise<DuanjuSource[]> {
    const resp = await fetch(`${this.baseUrl}/api/duanju/sources`, { headers: this.authHeaders() })
    if (!resp.ok) throw new Error(`获取短剧源失败 (${resp.status})`)
    const data = await resp.json()
    return (data.data || []) as DuanjuSource[]
  }

  async getDuanjuCategories(source: string): Promise<DuanjuCategory[]> {
    const resp = await fetch(`${this.baseUrl}/api/duanju/categories?source=${encodeURIComponent(source)}`, { headers: this.authHeaders() })
    if (!resp.ok) throw new Error(`获取短剧分类失败 (${resp.status})`)
    const data = await resp.json()
    return (data.data || []) as DuanjuCategory[]
  }

  async getDuanjuVideos(source: string, categoryId: string, page = 1): Promise<DuanjuPage> {
    const resp = await fetch(`${this.baseUrl}/api/duanju/videos?source=${encodeURIComponent(source)}&categoryId=${encodeURIComponent(categoryId)}&page=${page}`, { headers: this.authHeaders() })
    if (!resp.ok) throw new Error(`获取短剧列表失败 (${resp.status})`)
    const data = await resp.json()
    return { items: data.data || [], page: data.page || page, pageCount: data.pageCount || page, total: data.total || 0 }
  }

  async askAI(message: string, context?: { title?: string; year?: string; type?: string; tmdbId?: number; doubanId?: string }): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/api/ai/chat`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, context, history: [] }),
    })
    if (!resp.ok) {
      let error = `AI 请求失败 (${resp.status})`
      try { const data = await resp.json(); error = data.error || error } catch {}
      throw new Error(error)
    }
    const contentType = resp.headers.get("Content-Type") || ""
    if (contentType.includes("application/json")) {
      const data = await resp.json()
      return data.content || data.text || ""
    }
    const raw = await resp.text()
    const chunks: string[] = []
    raw.split(/\r?\n/).forEach(line => {
      if (!line.startsWith("data: ")) return
      const payload = line.slice(6).trim()
      if (!payload || payload === "[DONE]") return
      try { const data = JSON.parse(payload); if (data.text) chunks.push(data.text) } catch {}
    })
    return chunks.join("").trim()
  }

  async getDuanjuRecommendations(): Promise<SearchResult[]> {
    const resp = await fetch(`${this.baseUrl}/api/duanju/recommends`, { headers: this.authHeaders() })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.data || []) as SearchResult[]
  }

  async getBannerItems(): Promise<BannerResponse> {
    const resp = await fetch(`${this.baseUrl}/api/tmdb/trending`, { headers: this.authHeaders() })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("登录已失效，请在设置中重新登录")
      throw new Error(`获取首页轮播失败 (${resp.status})`)
    }
    const data = (await resp.json()) as BannerResponse
    return { ...data, list: Array.isArray(data.list) ? data.list : [] }
  }

  resolveBannerImage(path: string): string {
    if (!path) return ""
    if (/^https?:\/\//.test(path)) return this.resolvePosterUrl(path)
    return `https://image.tmdb.org/t/p/original${path.startsWith("/") ? "" : "/"}${path}`
  }

  async getRichMetadata(title: string, preferredType?: string): Promise<RichMediaMetadata | null> {
    try {
      const searchResp = await fetch(`${this.baseUrl}/api/tmdb/search?query=${encodeURIComponent(title)}`, { headers: this.authHeaders() })
      if (!searchResp.ok) return null
      const searchData = await searchResp.json()
      const candidates = (searchData.results || []) as any[]
      if (candidates.length === 0) return null
      const wantedType = preferredType?.includes("电影") ? "movie" : preferredType?.includes("剧") || preferredType?.includes("动漫") ? "tv" : ""
      const match = candidates.find(item => item.media_type === wantedType) || candidates[0]
      const mediaType = match.media_type === "tv" ? "tv" : "movie"
      const id = Number(match.id)
      const params = `id=${id}&type=${mediaType}`
      const [detailResp, creditsResp, imagesResp] = await Promise.all([
        fetch(`${this.baseUrl}/api/tmdb/detail?${params}`, { headers: this.authHeaders() }),
        fetch(`${this.baseUrl}/api/tmdb/credits?${params}`, { headers: this.authHeaders() }),
        fetch(`${this.baseUrl}/api/tmdb/images?${params}&page=1&pageSize=12`, { headers: this.authHeaders() }),
      ])
      const detail = detailResp.ok ? await detailResp.json() : {}
      const credits = creditsResp.ok ? await creditsResp.json() : {}
      const images = imagesResp.ok ? await imagesResp.json() : {}
      return {
        tmdbId: id,
        mediaType,
        rating: Number(detail.vote_average || match.vote_average || 0),
        genres: (detail.genres || []).map((item: any) => item.name).filter(Boolean),
        runtime: Number(detail.runtime || detail.episode_run_time?.[0] || 0),
        countries: (detail.production_countries || detail.origin_country || []).map((item: any) => typeof item === "string" ? item : item.name).filter(Boolean),
        status: detail.status || "",
        tagline: detail.tagline || "",
        cast: (credits.cast || []).slice(0, 12),
        crew: (credits.crew || []).filter((item: any) => ["Director", "Creator", "Writer"].includes(item.job)).slice(0, 6),
        images: (images.list || []).slice(0, 12),
      }
    } catch { return null }
  }

  async getDoubanRecommendations(doubanId: string): Promise<any[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/douban-recommendations?doubanId=${encodeURIComponent(doubanId)}`, { headers: this.authHeaders() })
      if (!resp.ok) return []
      const data = await resp.json()
      return data.list || data || []
    } catch { return [] }
  }

  // ========== Play Records ==========
  async getPlayRecord(id: string, source: string): Promise<PlayRecord | null> {
    try {
      const key = `${source}+${id}`
      const resp = await fetch(`${this.baseUrl}/api/playrecords?key=${encodeURIComponent(key)}`, { headers: this.authHeaders() })
      if (!resp.ok) return null
      const data = await resp.json()
      return data ? ({ key, ...data } as PlayRecord) : null
    } catch { return null }
  }

  async getPlayRecords(): Promise<PlayRecord[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/playrecords`, { headers: this.authHeaders() })
      if (!resp.ok) return []
      const data = await resp.json()
      return Object.entries(data || {}).map(([key, val]: [string, any]) => ({ key, ...val } as PlayRecord))
        .sort((a, b) => b.save_time - a.save_time)
    } catch { return [] }
  }

  async savePlayRecord(id: string, source: string, index: number, title: string, poster: string, totalEpisodes: number, playTime: number, totalTime: number, sourceName: string): Promise<void> {
    const key = `${source}+${id}`
    const record = {
      title,
      source_name: sourceName || source,
      cover: poster,
      // MoonTVPlus records use a 1-based episode index.
      index: Math.max(1, index),
      total_episodes: Math.max(1, totalEpisodes),
      play_time: Math.max(0, playTime),
      total_time: Math.max(0, totalTime),
      save_time: Date.now(),
    }
    const resp = await fetch(`${this.baseUrl}/api/playrecords`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("登录已失效，请重新登录")
      throw new Error(`保存云端历史失败 (${resp.status})`)
    }
  }

  // ========== Favorites ==========
  async getFavorites(): Promise<SearchResult[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/favorites`, { headers: this.authHeaders() })
      if (!resp.ok) return []
      const data = await resp.json()
      return Object.entries(data || {}).map(([key, value]: [string, any]) => {
        const [source, id] = key.split("+")
        return {
          ...value,
          id: value.id || id,
          source: value.source || source,
          poster: value.poster || value.cover || "",
        } as SearchResult
      })
    } catch { return [] }
  }

  async isFavorite(id: string, source: string): Promise<boolean> {
    try {
      const key = `${source}+${id}`
      const resp = await fetch(`${this.baseUrl}/api/favorites?key=${encodeURIComponent(key)}`, { headers: this.authHeaders() })
      if (!resp.ok) return false
      return Boolean(await resp.json())
    } catch { return false }
  }

  async addFavorite(item: SearchResult): Promise<void> {
    const key = `${item.source}+${item.id}`
    const favorite = {
      title: item.title,
      source_name: item.source_name || item.source,
      cover: item.poster,
      poster: item.poster,
      year: item.year || "",
      type_name: item.type_name || "",
      desc: item.desc || "",
      episodes_titles: item.episodes_titles || [],
      save_time: Date.now(),
    }
    const resp = await fetch(`${this.baseUrl}/api/favorites`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("登录已失效，请重新登录")
      throw new Error(`收藏失败 (${resp.status})`)
    }
  }

  async removeFavorite(id: string, source: string): Promise<void> {
    const key = `${source}+${id}`
    const resp = await fetch(`${this.baseUrl}/api/favorites?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("登录已失效，请重新登录")
      throw new Error(`取消收藏失败 (${resp.status})`)
    }
  }

  // ========== Continue Watching ==========
  async getContinueWatching(): Promise<PlayRecord[]> {
    return this.getPlayRecords()
  }

  // ========== Server Config ==========
  async getServerConfig(): Promise<ServerConfig | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/server-config`)
      if (!resp.ok) return null
      return (await resp.json()) as ServerConfig
    } catch { return null }
  }

  // ========== Utility ==========
  playbackHeaders(): Record<string, string> {
    return {
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    }
  }

  resolvePlayUrl(detail: VideoDetail, episodeIndex: number): string {
    const url = detail.episodes[episodeIndex]
    if (!url) throw new Error("无效的剧集")
    if (url.startsWith("http://") || url.startsWith("https://")) return url
    // Relative URL — resolve against base
    return `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`
  }

  // Normalize poster URLs. Do not send every image through image-proxy:
  // the deployed proxy is not reliable for all video sources and can turn
  // working covers into HTTP 500 responses. Only Douban needs the mirror.
  resolvePosterUrl(poster: string): string {
    if (!poster) return ""

    let url = String(poster).trim()
      .replace(/&amp;/g, "&")
      .replace(/\\\//g, "/")
    if (!url) return ""
    if (url.startsWith("//")) url = `https:${url}`

    if (url.startsWith("/")) return `${this.baseUrl}${url}`

    if (url.includes("doubanio.com")) {
      return url
        .replace(/img\d*\.doubanio\.com/g, "img.doubanio.cmliussss.net")
        .replace(/s_ratio_poster/g, "m_ratio_poster")
    }

    // Keep iQiyi, Bangumi and source-provided covers unchanged. Those URLs
    // are already the URLs the upstream source expects.
    return url
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.authCookie) {
      // 登录接口返回值本身已由服务端 encodeURIComponent，不能再次编码。
      headers["Cookie"] = `auth=${this.authCookie}`
    }
    return headers
  }
}

export const moonClient = new MoonTVClient()
