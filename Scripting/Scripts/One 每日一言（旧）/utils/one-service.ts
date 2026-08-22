import { fetch } from 'scripting'
import { createStorageManager } from './storage'

// ============================================================
// Types
// ============================================================

export interface OneContentItem {
  title: string
  forward: string
  img_url: string
  author: {
    user_name: string
    desc: string
    web_url: string
  } | null
}

export interface WallpaperData {
  imageUrl: string
  title: string
  forward: string
  authorName: string
  date: string
  rawDate: string
}

export type DisplayMode = 'latest' | 'manual'

export interface OneSettings {
  displayMode: DisplayMode
  selectedDate: string
  currentDisplayDate: string
  showTitle: boolean
  showAuthor: boolean
  autoRefresh: boolean
}

export const displayModeOptions: { label: string; value: DisplayMode }[] = [
  { label: '最新内容', value: 'latest' },
  { label: '手动指定日期', value: 'manual' },
]

// ============================================================
// Storage
// ============================================================

const STORAGE_NAME = 'OneQuote.Settings'
const storageManager = createStorageManager(STORAGE_NAME)

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  CACHED_DATA: 'cachedData',
  LAST_UPDATE: 'lastUpdate',
  CACHED_LIST: 'cachedList',
} as const

const DEFAULT_SETTINGS: OneSettings = {
  displayMode: 'latest',
  selectedDate: '',
  currentDisplayDate: '',
  showTitle: true,
  showAuthor: true,
  autoRefresh: true,
}

// ============================================================
// Settings helpers
// ============================================================

export const getCurrentSettings = (): OneSettings => {
  try {
    const saved = storageManager.storage.get<Partial<OneSettings>>(STORAGE_KEYS.SETTINGS)
    if (saved) return { ...DEFAULT_SETTINGS, ...saved }
  } catch {
    // fall through
  }
  return { ...DEFAULT_SETTINGS }
}

const saveSettings = (settings: OneSettings): void => {
  storageManager.storage.set(STORAGE_KEYS.SETTINGS, settings)
}

const updateSettings = (updater: (s: OneSettings) => OneSettings): OneSettings => {
  const current = getCurrentSettings()
  const next = updater(current)
  saveSettings(next)
  return next
}

// ============================================================
// Settings manipulation (exported for UI)
// ============================================================

export class OneSettingsManager {
  static getShowTitle(): boolean {
    return getCurrentSettings().showTitle
  }

  static setShowTitle(value: boolean): void {
    updateSettings(s => ({ ...s, showTitle: value }))
  }

  static getShowAuthor(): boolean {
    return getCurrentSettings().showAuthor
  }

  static setShowAuthor(value: boolean): void {
    updateSettings(s => ({ ...s, showAuthor: value }))
  }

  static getDisplayMode(): DisplayMode {
    return getCurrentSettings().displayMode
  }

  static getSelectedDate(): string {
    return getCurrentSettings().selectedDate
  }
}

export const setDisplayMode = (mode: DisplayMode): OneSettings => {
  return updateSettings(s => ({
    ...s,
    displayMode: mode,
  }))
}

export const setManualWallpaperDate = (rawDate: string): OneSettings => {
  return updateSettings(s => ({
    ...s,
    selectedDate: rawDate,
    currentDisplayDate: rawDate,
    displayMode: 'manual',
  }))
}

// ============================================================
// Date helpers
// ============================================================

const API_BASE = 'http://v3.wufazhuce.com:8000/api'

export const getTodayDateString = (): string => {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
}

const formatDisplayDate = (rawDate: string): string => {
  if (rawDate.length !== 8) return rawDate
  const y = rawDate.slice(0, 4)
  const m = rawDate.slice(4, 6)
  const d = rawDate.slice(6, 8)
  return `${y}年${m}月${d}日`
}

// ============================================================
// Data fetching
// ============================================================

let cachedContentList: OneContentItem[] | null = null
let lastListFetchTime = 0
const LIST_CACHE_TTL = 1000 * 60 * 30 // 30 minutes

const fetchContentList = async (): Promise<OneContentItem[]> => {
  const now = Date.now()
  if (cachedContentList && now - lastListFetchTime < LIST_CACHE_TTL) {
    return cachedContentList
  }

  // Also try storage
  const stored = storageManager.storage.get<{ list: OneContentItem[]; time: number }>(STORAGE_KEYS.CACHED_LIST)
  if (stored && now - stored.time < LIST_CACHE_TTL) {
    cachedContentList = stored.list
    lastListFetchTime = stored.time
    return stored.list
  }

  try {
    const idListResp = await fetch(`${API_BASE}/onelist/idlist`)
    const idListData = await idListResp.json()
    const ids: string[] = idListData.data

    if (!ids || ids.length === 0) throw new Error('No IDs returned')

    const results: OneContentItem[] = []
    // Fetch up to 10 most recent lists for date browsing
    const fetchCount = Math.min(ids.length, 10)
    for (let i = 0; i < fetchCount; i++) {
      try {
        const resp = await fetch(`${API_BASE}/onelist/${ids[i]}/0`)
        const data = await resp.json()
        if (data.res === 0 && data.data?.content_list?.length) {
          results.push(data.data.content_list[0] as OneContentItem)
        }
      } catch {
        // skip failed fetches
      }
    }

    cachedContentList = results
    lastListFetchTime = now
    storageManager.storage.set(STORAGE_KEYS.CACHED_LIST, { list: results, time: now })

    return results
  } catch (err: unknown) {
    // Fallback to cached
    if (cachedContentList) return cachedContentList
    if (stored) return stored.list
    throw err
  }
}

// ============================================================
// Mapping
// ============================================================

const mapItemToWallpaperData = (item: OneContentItem, index: number): WallpaperData => {
  const now = new Date()
  now.setDate(now.getDate() - index)
  const rawDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`

  return {
    imageUrl: item.img_url || '',
    title: item.title || '',
    forward: item.forward || '',
    authorName: item.author?.user_name || 'ONE · 一个',
    date: formatDisplayDate(rawDate),
    rawDate,
  }
}

// ============================================================
// Public API
// ============================================================

export const getAllWallpapers = async (): Promise<WallpaperData[]> => {
  const items = await fetchContentList()
  return items.map((item, i) => mapItemToWallpaperData(item, i))
}

export const getDisplayWallpaper = async (
  forceRefresh: boolean = false,
): Promise<WallpaperData> => {
  if (forceRefresh) {
    cachedContentList = null
    lastListFetchTime = 0
  }

  const items = await fetchContentList()
  if (items.length === 0) throw new Error('No content available')

  const settings = getCurrentSettings()
  const wallpapers = items.map((item, i) => mapItemToWallpaperData(item, i))

  if (settings.displayMode === 'manual' && settings.selectedDate) {
    const found = wallpapers.find(w => w.rawDate === settings.selectedDate)
    if (found) return found
  }

  // Latest mode: return the most recent (index 0)
  return wallpapers[0]
}

/**
 * Check if widget should refresh (after 9:00 AM today and last update was before 9:00)
 */
export const shouldRefresh = (): boolean => {
  const lastUpdate = storageManager.storage.get<number>(STORAGE_KEYS.LAST_UPDATE)
  if (!lastUpdate) return true

  const now = new Date()
  const today9am = new Date(now)
  today9am.setHours(9, 0, 0, 0)

  return lastUpdate < today9am.getTime() && now >= today9am
}

/**
 * Mark last update timestamp
 */
export const markUpdated = (): void => {
  storageManager.storage.set(STORAGE_KEYS.LAST_UPDATE, Date.now())
}

/**
 * Clean text: remove "本周" suffix from forward
 */
export const cleanForward = (text: string): string => {
  const idx = text.indexOf('本周')
  return idx >= 0 ? text.slice(0, idx).trim() : text
}
