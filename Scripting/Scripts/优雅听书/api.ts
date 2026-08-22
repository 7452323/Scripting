import { fetch } from "scripting"
import { Audiobook, Chapter } from "./models"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LRTS_BASE = "https://m.lrts.me"
const NOVELFM_BASE = "https://api5-hl.novelfm.com"
const FANQIE_BASE = "https://fanqienovel.com"
const XIMALAYA_PC_BASE = "https://pc.ximalaya.com"
const XIMALAYA_MOBILE_BASE = "https://m.ximalaya.com"

const UA_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"

const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 9; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141"

const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT = 15_000 // 15 seconds

/** Wrap a fetch call with a timeout. Uses Promise.race since AbortController is unavailable. */
async function fetchWithTimeout(url: string, options?: any): Promise<any> {
  return Promise.race([
    fetch(url, options),
    new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error(`请求超时 (${REQUEST_TIMEOUT}ms)`)), REQUEST_TIMEOUT)
    ),
  ])
}

async function lrtsFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${LRTS_BASE}${path}${qs ? "?" + qs : ""}`
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA_IOS,
      Accept: "application/json, text/plain, */*",
      Referer: LRTS_BASE + "/",
    },
  })
  if (!res.ok) throw new Error(`LRTS请求失败: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// Remove the BP comment line

// Novelfm (番茄小说) API fetch
async function novelfmFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${NOVELFM_BASE}${path}${qs ? "?" + qs : ""}`
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Dart/3.6 (dart:io)",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip",
    },
  })
  if (!res.ok) throw new Error(`Novelfm请求失败: ${res.status}`)
  return res.json() as Promise<T>
}

// Fanqie (番茄小说网页) API fetch
async function fanqieFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${FANQIE_BASE}${path}${qs ? "?" + qs : ""}`
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Dart/3.6 (dart:io)",
      "Accept-Encoding": "gzip",
    },
  })
  if (!res.ok) throw new Error(`Fanqie请求失败: ${res.status}`)
  return res.json() as Promise<T>
}

// Ximalaya (喜马拉雅) PC API fetch
async function ximalayaPcFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${XIMALAYA_PC_BASE}${path}${qs ? "?" + qs : ""}`
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA_PC,
      "Accept-Encoding": "gzip",
      "Cookie": "channel=99",
    },
  })
  if (!res.ok) throw new Error(`Ximalaya PC请求失败: ${res.status}`)
  return res.json() as Promise<T>
}

// Ximalaya (喜马拉雅) Mobile API fetch
async function ximalayaMobileFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `${XIMALAYA_MOBILE_BASE}${path}${qs ? "?" + qs : ""}`
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": UA_ANDROID,
      "Accept-Encoding": "gzip",
    },
  })
  if (!res.ok) throw new Error(`Ximalaya Mobile请求失败: ${res.status}`)
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Response types (LRTS actual JSON shapes)
// ---------------------------------------------------------------------------

type LrtsSearchItem = {
  id: number
  name: string
  author: string
  cover: string
  desc: string
  sections: number
  state: number
  plays?: number
  hot?: number
  score?: number
  recReason?: string
  shortRecReason?: string
  announcer?: string
  price?: number
  payType?: number
}

type LrtsSearchResponse = {
  apiStatus: number
  count: number
  hasNext: number
  list: LrtsSearchItem[]
}

type LrtsBookInfoResponse = {
  data: {
    id: number
    name: string
    author: string
    cover: string
    desc: string
    sections: number
    state: number
  }
}

type LrtsChapterItem = {
  id: number
  sectionId: string
  section: number
  name: string
  length: number
  size: string
  tmeId?: string
  state: number
}

type LrtsBookMenuResponse = {
  data: {
    pages: number
    items: {
      id: string
      name: string
      trackId: string
    }[]
  } | null
  list?: LrtsChapterItem[]
  sections?: number
}

// ---------------------------------------------------------------------------
// Ximalaya Response Types
// ---------------------------------------------------------------------------

type XimalayaTracksResponse = {
  ret: number
  data: {
    currentUid: number
    albumId: number
    trackTotalCount: number
    sort: number
    tracks: Array<{
      index: number
      trackId: number
      isPaid: boolean
      tag: number
      title: string
      playCount: number
      duration?: number
      url?: string
    }>
  }
}

type XimalayaAlbumResponse = {
  ret: number
  data: {
    id: number
    albumDetailInfo?: {
      id: number
      albumInfo: {
        id: number
        cover: string
        title: string
        authorName?: string
        intro?: string
      }
    }
    albumInfo?: {
      id: number
      cover: string
      title: string
      authorName?: string
      intro?: string
    }
  }
}

// ---------------------------------------------------------------------------
// Novelfm Response Types
// ---------------------------------------------------------------------------

type NovelfmDirectoryResponse = {
  code: number
  data: Array<{
    audio_info?: {
      duration: number
      id: number
      title: string
      tone_cover_url: string
    }
    available_bgm_list?: number[]
    book_id: string
    chapter_word_number: string
    collect_num: string
    group_id?: string
    item_id?: string
    title?: string
    vid?: string
    status?: number
  }>
}

type FanqieDirectoryResponse = {
  data: {
    allItemIds: string[]
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function lrtsItemToAudiobook(item: LrtsSearchItem): Audiobook {
  return {
    id: `lrts:${item.id}`,
    title: item.name,
    author: item.author || "未知作者",
    coverUrl: item.cover || undefined,
    description: item.desc || undefined,
    categoryName: undefined,
    chapterCount: item.sections ?? 0,
    isFinished: item.state === 1,
    source: "lrts",
  }
}

function ximalayaAlbumToAudiobook(data: XimalayaAlbumResponse["data"]): Audiobook {
  const info = data.albumDetailInfo?.albumInfo || data.albumInfo
  if (!info) throw new Error("Invalid album data")
  
  return {
    id: `xm:${info.id}`,
    title: info.title,
    author: info.authorName || "未知作者",
    coverUrl: info.cover ? `https://imagev2.xmcdn.com/${info.cover}` : undefined,
    description: info.intro || undefined,
    categoryName: undefined,
    chapterCount: 0,
    isFinished: true,
    source: "ximalaya",
    albumId: String(info.id),
  }
}

// ---------------------------------------------------------------------------
// LRTS API
// ---------------------------------------------------------------------------

export async function searchBooks(
  keyword: string,
  page = 1,
): Promise<{ books: Audiobook[]; totalCount: number; hasMore: boolean }> {
  const json = await lrtsFetch<LrtsSearchResponse>("/ajax/searchBook", {
    keyWord: keyword,
    pageSize: "50",
    pageNum: String(page),
  })
  return {
    books: (json.list ?? []).map(lrtsItemToAudiobook),
    totalCount: json.count ?? 0,
    hasMore: json.hasNext === 1,
  }
}

export async function searchAllBooks(keyword: string): Promise<Audiobook[]> {
  const all: Audiobook[] = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const result = await searchBooks(keyword, page)
    all.push(...result.books)
    hasMore = result.hasMore
    page++
    if (page > 20) break
  }
  return all
}

export async function getBookInfo(bookId: string): Promise<Audiobook> {
  const id = bookId.startsWith("lrts:") ? bookId.slice(5) : bookId
  const json = await lrtsFetch<LrtsBookInfoResponse>("/ajax/getBookInfo", {
    id,
  })
  const d = json.data
  return {
    id: `lrts:${d.id}`,
    title: d.name,
    author: d.author || "未知作者",
    coverUrl: d.cover || undefined,
    description: d.desc || undefined,
    categoryName: undefined,
    chapterCount: d.sections ?? 0,
    isFinished: d.state === 1,
    source: "lrts",
  }
}

export async function getChapters(
  bookId: string,
  page = 1,
): Promise<{ chapters: Chapter[]; hasMore: boolean }> {
  const id = bookId.startsWith("lrts:") ? bookId.slice(5) : bookId
  const json = await lrtsFetch<LrtsBookMenuResponse>("/ajax/getBookMenu", {
    bookId: id,
    pageNum: String(page),
    pageSize: "50",
  })

  // Handle two response formats
  if (json.data && json.data.items) {
    // Paginated format with data.items
    const { pages, items } = json.data
    const chapters: Chapter[] = items.map((item) => ({
      id: item.trackId || item.id,
      bookId,
      title: item.name,
      audioUrl: undefined,
      duration: 0,
      index: 0, // placeholder — set by getAllChapters
    }))
    return { chapters, hasMore: page < pages }
  } else if (json.list) {
    // Flat list format — paginates via pageNum + pageSize
    const pageSize = 50
    const chapters: Chapter[] = json.list.map((item) => ({
      id: String(item.id),
      bookId,
      title: item.name,
      audioUrl: undefined,
      tmeId: item.tmeId,
      duration: item.length ?? 0,
      section: item.section,
      index: 0, // placeholder — set by getAllChapters
    }))
    const totalSections = json.sections ?? 0
    return { chapters, hasMore: page * pageSize < totalSections }
  }

  return { chapters: [], hasMore: false }
}

export async function getAllChapters(bookId: string): Promise<Chapter[]> {
  const all: Chapter[] = []
  let page = 1
  let hasMore = true
  while (hasMore) {
    const result = await getChapters(bookId, page)
    all.push(...result.chapters)
    hasMore = result.hasMore
    page++
    // Safety limit — support up to 10000 chapters (200 pages × 50/page)
    if (page > 200) break
  }
  // Assign sequential indices after collecting all pages
  return all.map((ch, i) => ({ ...ch, index: i }))
}
// ---------------------------------------------------------------------------
// Ximalaya API
// ---------------------------------------------------------------------------

export async function ximalayaGetAlbumInfo(albumId: string | number): Promise<Audiobook> {
  const id = String(albumId).startsWith("xm:") ? String(albumId).slice(3) : String(albumId)
  const json = await ximalayaMobileFetch<XimalayaAlbumResponse>(
    `/m-revision/page/album/v2/queryAlbumPage/${id}`,
    { albumCounts: "track", v: String(Date.now()) }
  )
  if (json.ret !== 0) throw new Error(`Ximalaya album query failed: ${json.ret}`)
  return ximalayaAlbumToAudiobook(json.data)
}

export async function ximalayaGetTracks(
  albumId: string | number,
  page = 1,
  pageSize = 50
): Promise<{ chapters: Chapter[]; hasMore: boolean; total: number }> {
  const id = String(albumId).startsWith("xm:") ? String(albumId).slice(3) : String(albumId)
  const json = await ximalayaPcFetch<XimalayaTracksResponse>(
    "/simple-revision-for-pc/album/v1/getTracksList",
    {
      albumId: id,
      pageNum: String(page),
      pageSize: String(pageSize),
      sort: "0",
    }
  )
  if (json.ret !== 200) throw new Error(`Ximalaya tracks query failed: ${json.ret}`)
  
  const tracks = json.data.tracks ?? []
  const total = json.data.trackTotalCount ?? 0
  const startIndex = (page - 1) * pageSize
  
  const chapters: Chapter[] = tracks.map((track, i) => ({
    id: `xm_track:${track.trackId}`,
    bookId: `xm:${id}`,
    title: track.title,
    trackId: track.trackId,
    isPaid: track.isPaid,
    duration: track.duration ?? 0,
    index: startIndex + i,
  }))
  
  return { 
    chapters, 
    hasMore: startIndex + tracks.length < total,
    total 
  }
}

export async function ximalayaGetAllTracks(albumId: string | number): Promise<Chapter[]> {
  const all: Chapter[] = []
  let page = 1
  let hasMore = true
  let total = 0
  
  while (hasMore) {
    const result = await ximalayaGetTracks(albumId, page, 100)
    all.push(...result.chapters)
    hasMore = result.hasMore
    total = result.total
    page++
    // Safety limit - Ximalaya albums can be huge (4000+ tracks)
    if (page > 100) break
  }
  return all
}

/**
 * Get Ximalaya audio stream URL for a track.
 * Tries multiple methods to get the actual CDN URL.
 */
export async function ximalayaGetAudioUrl(trackId: number): Promise<string> {
  // Method 1: Try the mobile play API (older but may still work)
  try {
    const json = await ximalayaMobileFetch<{ playUrl?: string; url?: string }>(
      `/mobile/play/v1/track/${trackId}`,
      {}
    )
    if (json.playUrl) return json.playUrl
    if (json.url) return json.url
  } catch {
    // fall through
  }

  // Method 2: Try the mobile track playurl API
  try {
    const json = await ximalayaMobileFetch<{ playUrl?: string; url?: string }>(
      `/mobile/track/v1/playurl/${trackId}`,
      {}
    )
    if (json.playUrl) return json.playUrl
    if (json.url) return json.url
  } catch {
    // fall through
  }

  // Method 3: Try the web play API
  try {
    const json = await ximalayaPcFetch<{ playUrl?: string; url?: string }>(
      `/mobile/play/v1/track/${trackId}`,
      {}
    )
    if (json.playUrl) return json.playUrl
    if (json.url) return json.url
  } catch {
    // fall through
  }

  // Method 4: Try the sound page and follow redirect
  try {
    const url = `${XIMALAYA_MOBILE_BASE}/sound/${trackId}`
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": UA_ANDROID,
      },
    })
    // Check for redirect in response url (Scripting fetch may auto-follow)
    if (res.status === 200) {
      // If we got an HTML page with audio, try to extract the URL
      const text = await res.text() || ""
      const match = text.match(/[^"']*\.m3u8[^"']*/i) || text.match(/[^"']*\.mp3[^"']*/i) || text.match(/[^"']*\.m4a[^"']*/i)
      if (match) return match[0]
    }
    if (res.status === 301 || res.status === 302) {
      const location = res.headers.get("Location") || res.headers.get("location")
      if (location) return location
    }
  } catch {
    // fall through
  }

  // Method 5: Try to get from track detail API
  try {
    const json = await ximalayaPcFetch<{
      ret: number
      data: { playUrl64?: string; playUrl32?: string; playUrl?: string; path?: string }
    }>(
      `/tracks/${trackId}.json`,
      {}
    )
    if (json.ret === 200 && json.data) {
      return json.data.playUrl64 || json.data.playUrl32 || json.data.playUrl || json.data.path!
    }
  } catch {
    // fall through
  }

  throw new Error(`无法获取喜马拉雅音轨播放地址: trackId=${trackId}`)
}

// ---------------------------------------------------------------------------
// Novelfm API
// ---------------------------------------------------------------------------

export async function novelfmGetDirectory(bookId: string): Promise<string[]> {
  const id = bookId.startsWith("fq:") ? bookId.slice(3) : bookId
  const json = await fanqieFetch<FanqieDirectoryResponse>(
    "/api/reader/directory/detail",
    { bookId: id }
  )
  return json.data?.allItemIds ?? []
}

export async function novelfmGetChapterInfo(
  bookId: string,
  itemIds: string[]
): Promise<Chapter[]> {
  const id = bookId.startsWith("fq:") ? bookId.slice(3) : bookId
  
  const json = await novelfmFetch<NovelfmDirectoryResponse>(
    "/novelfm/bookapi/directory/all_infos/v1/",
    {
      iid: "e7248daf-bbce-4f1a-a494-62b683193093",
      device_id: "efb923c4-eaf9-4fd2-9e35-08b28e5f1a00",
      version_name: "8.43.0.31",
      aid: "1967",
      device_platform: "android",
    }
  )
  
  if (json.code !== 0) throw new Error(`Novelfm directory failed: ${json.code}`)
  
  return (json.data ?? []).map((item, i) => ({
    id: item.group_id || item.item_id || String(i),
    bookId: `fq:${id}`,
    title: item.audio_info?.title || `第${i}集`,
    duration: item.audio_info?.duration ?? 0,
    index: i,
  }))
}

/**
 * Get Novelfm (番茄小说) audio stream URL.
 * Tries multiple methods to get the actual CDN URL.
 */
export async function novelfmGetAudioUrl(itemId: string): Promise<string> {
  // Method 1: Try the audio URL API
  try {
    const json = await novelfmFetch<{ code: number; data?: { audio_url?: string; play_url?: string; audio_url_list?: Array<{ url: string; quality: string }> } }>(
      "/novelfm/bookapi/audio/url/v1/",
      { item_id: itemId }
    )
    if (json.code === 0 && json.data) {
      const url = json.data.audio_url || json.data.play_url
      if (url) return url
      // Try audio_url_list
      if (json.data.audio_url_list && json.data.audio_url_list.length > 0) {
        // Prefer higher quality
        const item = json.data.audio_url_list.find(x => x.quality === "high") || json.data.audio_url_list[0]
        return item.url
      }
    }
  } catch {
    // fall through
  }

  // Method 2: Try the reader audio API
  try {
    const json = await fanqieFetch<{ data?: { audio_url?: string; play_url?: string } }>(
      "/api/reader/audio",
      { item_id: itemId }
    )
    if (json.data) {
      const url = json.data.audio_url || json.data.play_url
      if (url) return url
    }
  } catch {
    // fall through
  }

  // Method 3: Try the TTS audio generation API
  try {
    const json = await novelfmFetch<{ code: number; data?: { audio_url?: string } }>(
      "/novelfm/bookapi/tts/audio/v1/",
      { item_id: itemId }
    )
    if (json.code === 0 && json.data?.audio_url) {
      return json.data.audio_url
    }
  } catch {
    // fall through
  }

  throw new Error(`无法获取番茄小说音频地址: itemId=${itemId}`)
}

// ---------------------------------------------------------------------------
// Unified Audio URL Resolution
// ---------------------------------------------------------------------------

/**
 * Get audio URL for a chapter based on its source platform.
 */
export async function getAudioUrl(
  bookId: string,
  chapterId: string,
  tmeId?: string,
  source?: string,
  section?: number
): Promise<string> {
  const src = source || (bookId.startsWith("xm:") ? "ximalaya" : 
                          bookId.startsWith("fq:") ? "novelfm" : "lrts")
  
  // Ximalaya
  if (src === "ximalaya" || bookId.startsWith("xm:")) {
    const trackIdStr = chapterId.replace("xm_track:", "")
    const trackId = parseInt(trackIdStr, 10)
    if (!isNaN(trackId)) {
      return ximalayaGetAudioUrl(trackId)
    }
  }
  
  // Novelfm
  if (src === "novelfm" || bookId.startsWith("fq:")) {
    return novelfmGetAudioUrl(chapterId)
  }
  
  // LRTS - Use getListenPath API
  const lrtsBookId = bookId.replace("lrts:", "")
  try {
    const res = await lrtsFetch<{ data: { path: string; mimeType?: string } }>("/ajax/getListenPath", {
      entityId: lrtsBookId,
      entityType: "3",
      opType: "1",
      sections: "",
      type: "0",
      id: chapterId,
      section: String(section ?? 1),
    })
    if (res.data?.path && res.data.path.startsWith("http")) {
      return res.data.path
    }
  } catch {
    // fall through
  }

  throw new Error(`无法解析音频地址: book=${bookId}, chapter=${chapterId}, source=${src}`)
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const lrtsAPI = {
  searchBooks,
  getBookInfo,
  getChapters,
  getAllChapters,
  getAudioUrl,
}

export const ximalayaAPI = {
  getAlbumInfo: ximalayaGetAlbumInfo,
  getTracks: ximalayaGetTracks,
  getAllTracks: ximalayaGetAllTracks,
  getAudioUrl: ximalayaGetAudioUrl,
}

export const novelfmAPI = {
  getDirectory: novelfmGetDirectory,
  getChapterInfo: novelfmGetChapterInfo,
  getAudioUrl: novelfmGetAudioUrl,
}
