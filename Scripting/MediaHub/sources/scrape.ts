/** 刮削：文件名解析 + TMDB 匹配（对齐 SenPlayer 的「文件夹刮削 + 本地刮削库」） */
import { fetch } from "scripting"
import { cloud115WalkVideos, type Cloud115VideoRef } from "./cloud115"
import type { Cloud115Config } from "./config"
import type { ScrapeEntry } from "../storage"

const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500"
const TMDB_BACKDROP = "https://image.tmdb.org/t/p/w780"

export interface ScrapeResult {
  title: string
  overview?: string
  poster?: string
  backdrop?: string
  year?: string
  tmdbId?: number
  mediaType?: "movie" | "tv"
  rating?: number
  genres?: number[]
  category?: string
}

/** TMDB genre id → 分类（对齐 SenPlayer 的刮削库分类） */
const GENRE_ANIMATION = 16
const GENRE_DOCUMENTARY = 99
const GENRE_NEWS = 10764
const GENRE_TALK = 10767
const GENRE_KIDS = 10762

export function categoryOf(mediaType: "movie" | "tv", genres?: number[]): string {
  const g = genres || []
  if (g.includes(GENRE_ANIMATION)) return mediaType === "tv" ? "动画剧集" : "动画电影"
  if (g.includes(GENRE_DOCUMENTARY)) return "纪录片"
  if (g.includes(GENRE_NEWS)) return "新闻"
  if (g.includes(GENRE_TALK)) return "综艺"
  if (g.includes(GENRE_KIDS)) return "少儿"
  return mediaType === "tv" ? "电视剧" : "电影"
}

export interface ParsedName {
  title: string
  year?: string
  season?: number
  episode?: number
}

/** 从文件名里拆出标题 / 年份 / 季集（规则参考 SenPlayer 的刮削引擎） */
export function parseVideoName(fileName: string): ParsedName {
  let name = fileName.replace(/\.[a-z0-9]{2,5}$/i, "")

  // 常见标记后面的内容全部丢掉
  name = name.split(
    /\b(?:2160p|1080p|720p|480p|4k|uhd|hdr|dv|dolby|web-?dl|webrip|bluray|bdrip|remux|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|dts|truehd|atmos|10bit|8bit)\b/i
  )[0]

  const seasonEp = name.match(/[Ss](\d{1,2})[\s._-]?[Ee](\d{1,3})/)
  const chineseEp = name.match(/第\s*(\d{1,3})\s*[集话話]/)
  const bracketEp = name.match(/\[(\d{1,3})\]/)
  const plainEp = name.match(/(?:^|[\s._-])EP?(\d{1,3})(?=[\s._-]|$)/i)
  const season = seasonEp ? Number(seasonEp[1]) : undefined
  const episode = seasonEp
    ? Number(seasonEp[2])
    : chineseEp
      ? Number(chineseEp[1])
      : bracketEp
        ? Number(bracketEp[1])
        : plainEp
          ? Number(plainEp[1])
          : undefined

  const yearMatch = name.match(/[\(\[\.\s]((?:19|20)\d{2})[\)\]\.\s]?/)
  const year = yearMatch ? yearMatch[1] : undefined

  // 去掉方括号组、季集标记、多余分隔符
  let title = name
    .replace(/【[^】]*】/g, " ")
    .replace(/「[^」]*」/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[Ss]\d{1,2}[\s._-]?[Ee]\d{1,3}/g, " ")
    .replace(/第\s*\d{1,3}\s*[集话話]/g, " ")
    .replace(/(?:^|[\s._-])EP?\d{1,3}(?=[\s._-]|$)/gi, " ")
    .replace(/[\[\](){}]/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  if (year) title = title.replace(year, " ").replace(/\s{2,}/g, " ").trim()
  title = title.replace(/^[-–—\s]+|[-–—\s]+$/g, "")

  return { title: title || fileName, year, season, episode }
}

async function tmdbFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { timeout: 20 })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** TMDB 结果缓存：同名剧集只查一次（一部剧 20 集 = 1 次请求） */
const tmdbCache = new Map<string, ScrapeResult | null>()

/** TMDB 搜索：按 movie / tv / multi 依次尝试，命中即返回（带缓存）
 *  ⚠️ 年份必须走 year / first_air_date_year 参数，拼进 query 里会搜不到 */
export async function scrapeTMDB(
  apiKey: string,
  keyword: string,
  preferred?: "movie" | "tv",
  yearHint?: string
): Promise<ScrapeResult | null> {
  if (!apiKey || !keyword.trim()) return null

  const cacheKey = `${preferred ?? "any"}|${yearHint ?? ""}|${keyword.trim().toLowerCase()}`
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey) ?? null

  const kinds: ("multi" | "movie" | "tv")[] = preferred
    ? [preferred, "multi"]
    : ["movie", "tv", "multi"]

  for (const kind of kinds) {
    let url =
      `https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(apiKey)}` +
      `&query=${encodeURIComponent(keyword.trim())}&language=zh-CN&include_adult=false`
    if (yearHint && kind === "movie") url += `&year=${encodeURIComponent(yearHint)}`
    if (yearHint && kind === "tv") url += `&first_air_date_year=${encodeURIComponent(yearHint)}`

    const data = await tmdbFetch(url)
    let results: any[] = data?.results || []

    // 带年份搜不到时，去掉年份限制再试一次（年份可能不准）
    if (results.length === 0 && yearHint && kind !== "multi") {
      const fallback = await tmdbFetch(
        `https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(apiKey)}` +
          `&query=${encodeURIComponent(keyword.trim())}&language=zh-CN&include_adult=false`
      )
      results = fallback?.results || []
    }

    const item = results.find(r =>
      kind === "multi" ? r.media_type === "movie" || r.media_type === "tv" : true
    )
    if (!item) continue

    const mediaType: "movie" | "tv" =
      kind === "tv" || item.media_type === "tv" || item.first_air_date ? "tv" : "movie"
    const rawTitle = item.title || item.name || keyword
    const date = String(item.release_date || item.first_air_date || "")
    const year = date.slice(0, 4) || undefined

    const result: ScrapeResult = {
      title: rawTitle,
      overview: item.overview || undefined,
      poster: item.poster_path ? `${TMDB_IMAGE}${item.poster_path}` : undefined,
      backdrop: item.backdrop_path ? `${TMDB_BACKDROP}${item.backdrop_path}` : undefined,
      year,
      tmdbId: item.id,
      mediaType,
      rating: typeof item.vote_average === "number" ? item.vote_average : undefined,
      genres: Array.isArray(item.genre_ids) ? item.genre_ids.map(Number) : undefined,
      category: categoryOf(mediaType, Array.isArray(item.genre_ids) ? item.genre_ids.map(Number) : undefined),
    }
    tmdbCache.set(cacheKey, result)
    return result
  }

  tmdbCache.set(cacheKey, null)
  return null
}

/** 并发池：同时最多 limit 个任务，保持原顺序 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))

  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(runners)
  return results
}

export interface ScrapeProgress {
  done: number
  total: number
  current?: string
}

/**
 * 电影常见「一片一目录」布局：文件名可能是 movie.mkv / index.mkv，真实标题在目录名里。
 * 文件名信息不足（无年份 / 标题太短）而目录名能解析出年份时，用目录名。
 */
export function bestParsed(fileName: string, folderPath: string): ParsedName {
  const fromFile = parseVideoName(fileName)
  const last = (folderPath || "").split("/").filter(Boolean).pop() || ""
  if (!last) return fromFile
  const fromFolder = parseVideoName(last)

  const weakFile = !fromFile.year || fromFile.title.trim().length <= 3
  const strongFolder = !!fromFolder.year && fromFolder.title.trim().length > 3

  if (weakFile && strongFolder) {
    return {
      title: fromFolder.title,
      year: fromFolder.year,
      season: fromFolder.season ?? fromFile.season,
      episode: fromFolder.episode ?? fromFile.episode,
    }
  }
  return fromFile
}

/**
 * 扫描 115 文件夹并刮削：
 * 遍历视频 → 解析文件名 → TMDB 匹配 → 产出刮削条目（只存本地，不上传任何数据）
 */
function buildEntry(
  video: Cloud115VideoRef,
  rootName: string,
  matched: ScrapeResult | null,
  parsed: ParsedName
): ScrapeEntry {
  return {
    id: `115_${video.pickCode}`,
    refId: video.pickCode,
    source: "115",
    fileName: video.name,
    folderPath: video.folderPath || rootName,
    title: matched?.title || parsed.title,
    year: matched?.year || parsed.year,
    season: parsed.season,
    episode: parsed.episode,
    poster: matched?.poster,
    backdrop: matched?.backdrop,
    overview: matched?.overview,
    rating: matched?.rating,
    tmdbId: matched?.tmdbId,
    category:
      matched?.category ||
      categoryOf(parsed.season != null || parsed.episode != null ? "tv" : "movie"),
    updatedAt: Date.now(),
  }
}

/**
 * 扫描 115 文件夹并刮削（并发 6 + 同名缓存）：
 * 遍历视频 → 解析文件名 → TMDB 匹配 → 产出刮削条目（只存本地，不上传任何数据）
 */
export async function scrape115Folder(
  config: Cloud115Config,
  apiKey: string,
  rootCid: string,
  rootName: string,
  onProgress?: (p: ScrapeProgress) => void,
  maxFiles = 400,
  concurrency = 6,
  onScan?: (scanned: number) => void
): Promise<ScrapeEntry[]> {
  const videos = await cloud115WalkVideos(config, rootCid, rootName, 3, maxFiles, 3, onScan)
  const total = videos.length
  let done = 0
  onProgress?.({ done, total })

  const entries = await mapLimit(videos, concurrency, async video => {
    const parsed = bestParsed(video.name, video.folderPath)
    // 剧集：只用剧名查一次（缓存命中）；电影带年份参数（不能拼进 query）
    const isSeries = parsed.season != null || parsed.episode != null
    const matched = await scrapeTMDB(
      apiKey,
      parsed.title,
      isSeries ? "tv" : undefined,
      isSeries ? undefined : parsed.year
    )

    done += 1
    onProgress?.({ done, total, current: video.name })
    return buildEntry(video, rootName, matched, parsed)
  })

  return entries
}

/** 单个文件刮削（手动「重新匹配」用） */
export async function scrapeOne115Video(
  apiKey: string,
  video: Cloud115VideoRef
): Promise<ScrapeEntry> {
  const parsed = bestParsed(video.name, video.folderPath)
  const isSeries = parsed.season != null || parsed.episode != null
  const matched = await scrapeTMDB(
    apiKey,
    parsed.title,
    isSeries ? "tv" : undefined,
    isSeries ? undefined : parsed.year
  )

  return buildEntry(video, video.folderPath, matched, parsed)
}
