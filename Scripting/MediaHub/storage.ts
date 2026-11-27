import type { MediaItem, PlaybackHistory } from "./types"

const LIBRARY_KEY = "mediahub.library"
const HISTORY_KEY = "mediahub.history"
const SETTINGS_KEY = "mediahub.settings"
const LIBRARY_REV_KEY = "mediahub.library.rev"
const SCRAPE_KEY = "mediahub.scrape"
const WATCHED_KEY = "mediahub.watched"
const FAV_GROUP_KEY = "mediahub.favGroups"

const MAX_HISTORY = 80

export interface AppSettings {
  autoPlayNext: boolean
  rememberProgress: boolean
  defaultPlaybackRate: number
}

const defaultSettings: AppSettings = {
  autoPlayNext: true,
  rememberProgress: true,
  defaultPlaybackRate: 1.0,
}

function safeParse<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
  return raw as T
}

export function getLibraryRevision(): number {
  try {
    const v = Storage.get<number | string>(LIBRARY_REV_KEY)
    if (typeof v === "number") return v
    if (typeof v === "string") return Number(v) || 0
    return 0
  } catch {
    return 0
  }
}

function bumpLibraryRevision() {
  Storage.set(LIBRARY_REV_KEY, Date.now())
}

export function loadLibrary(): MediaItem[] {
  try {
    const raw = Storage.get<string | MediaItem[]>(LIBRARY_KEY)
    const list = safeParse<MediaItem[]>(raw, [])
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveLibrary(items: MediaItem[]): void {
  Storage.set(LIBRARY_KEY, JSON.stringify(items))
  bumpLibraryRevision()
}

export function addMediaItem(item: Omit<MediaItem, "id" | "addedAt">): MediaItem {
  const library = loadLibrary()
  const existing = library.find(m => m.url === item.url)
  if (existing) return existing

  const newItem: MediaItem = {
    ...item,
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    addedAt: Date.now(),
  }
  library.unshift(newItem)
  saveLibrary(library)
  return newItem
}

export function updateMediaItem(id: string, patch: Partial<MediaItem>): void {
  const library = loadLibrary()
  const idx = library.findIndex(m => m.id === id)
  if (idx === -1) return
  library[idx] = { ...library[idx], ...patch }
  saveLibrary(library)
}

export function removeMediaItem(id: string): void {
  saveLibrary(loadLibrary().filter(m => m.id !== id))
}

export function toggleFavorite(id: string): void {
  const library = loadLibrary()
  const item = library.find(m => m.id === id)
  if (!item) return
  item.isFavorite = !item.isFavorite
  saveLibrary(library)
}

export function loadHistory(): PlaybackHistory[] {
  try {
    const raw = Storage.get<string | PlaybackHistory[]>(HISTORY_KEY)
    const list = safeParse<PlaybackHistory[]>(raw, [])
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function addHistory(entry: PlaybackHistory): void {
  let history = loadHistory().filter(h => h.mediaId !== entry.mediaId)
  history.unshift(entry)
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY)
  Storage.set(HISTORY_KEY, JSON.stringify(history))
  bumpLibraryRevision()
}

export function clearHistory(): void {
  Storage.set(HISTORY_KEY, JSON.stringify([]))
  bumpLibraryRevision()
}

export function loadSettings(): AppSettings {
  try {
    const raw = Storage.get<string | AppSettings>(SETTINGS_KEY)
    const parsed = safeParse<Partial<AppSettings>>(raw, {})
    return { ...defaultSettings, ...parsed }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings: AppSettings): void {
  Storage.set(SETTINGS_KEY, JSON.stringify(settings))
}

/* ------------------------------ 刮削库 ------------------------------ */

export interface ScrapeEntry {
  id: string
  /** 115 的 pickCode（播放时用） */
  refId: string
  source: "115" | "local" | "emby"
  fileName: string
  folderPath: string
  title: string
  year?: string
  season?: number
  episode?: number
  poster?: string
  backdrop?: string
  overview?: string
  rating?: number
  tmdbId?: number
  /** 分类：电影 / 电视剧 / 动画电影 / 动画剧集 / 纪录片 / 综艺 / 少儿 / 新闻 */
  category?: string
  updatedAt: number
}

export function loadScrapeLibrary(): ScrapeEntry[] {
  try {
    const raw = Storage.get<string | ScrapeEntry[]>(SCRAPE_KEY)
    const list = safeParse<ScrapeEntry[]>(raw, [])
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 批量写入（同 id 覆盖，保留其他来源的条目） */
export function upsertScrapeEntries(entries: ScrapeEntry[]): void {
  if (entries.length === 0) return
  const map = new Map<string, ScrapeEntry>()
  for (const item of loadScrapeLibrary()) map.set(item.id, item)
  for (const item of entries) map.set(item.id, item)
  Storage.set(SCRAPE_KEY, JSON.stringify([...map.values()]))
}

export function removeScrapeEntry(id: string): void {
  Storage.set(SCRAPE_KEY, JSON.stringify(loadScrapeLibrary().filter(e => e.id !== id)))
}

export function clearScrapeLibrary(): void {
  Storage.set(SCRAPE_KEY, JSON.stringify([]))
}

/** 某文件夹下已有的刮削条目 */
export function loadScrapeByFolder(folderPath: string): ScrapeEntry[] {
  return loadScrapeLibrary().filter(e => e.folderPath === folderPath)
}

/* ---------------------- 已看标记 / 收藏（对齐 SenPlayer） ---------------------- */

function loadIdSet(key: string): string[] {
  try {
    const list = safeParse<string[]>(Storage.get<string | string[]>(key), [])
    return Array.isArray(list) ? list.filter(x => typeof x === "string") : []
  } catch {
    return []
  }
}

function saveIdSet(key: string, ids: string[]): void {
  Storage.set(key, JSON.stringify(ids))
}

/** 已看过的条目 id（ScrapeEntry.id） */
export function loadWatched(): string[] {
  return loadIdSet(WATCHED_KEY)
}

export function isWatched(id: string): boolean {
  return loadWatched().includes(id)
}

/** 切换单集已看状态，返回切换后的值 */
export function toggleWatched(id: string): boolean {
  const set = new Set(loadWatched())
  const next = !set.has(id)
  if (next) set.add(id)
  else set.delete(id)
  saveIdSet(WATCHED_KEY, [...set])
  return next
}

/** 批量标记（markASWatched） */
export function markWatched(ids: string[], watched = true): void {
  const set = new Set(loadWatched())
  for (const id of ids) {
    if (watched) set.add(id)
    else set.delete(id)
  }
  saveIdSet(WATCHED_KEY, [...set])
}

/** 收藏的影视分组 key（MediaGroup.key） */
export function loadFavoriteGroups(): string[] {
  return loadIdSet(FAV_GROUP_KEY)
}

export function isFavoriteGroup(key: string): boolean {
  return loadFavoriteGroups().includes(key)
}

export function toggleFavoriteGroup(key: string): boolean {
  const set = new Set(loadFavoriteGroups())
  const next = !set.has(key)
  if (next) set.add(key)
  else set.delete(key)
  saveIdSet(FAV_GROUP_KEY, [...set])
  return next
}
