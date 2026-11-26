import { Storage } from "scripting"
import type { MediaItem, PlaybackHistory } from "./types"

const LIBRARY_KEY = "mediahub.library"
const HISTORY_KEY = "mediahub.history"
const SETTINGS_KEY = "mediahub.settings"

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

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function loadLibrary(): MediaItem[] {
  return safeParse(Storage.getSync(LIBRARY_KEY), [])
}

export function saveLibrary(items: MediaItem[]): void {
  Storage.setSync(LIBRARY_KEY, JSON.stringify(items))
}

export function addMediaItem(item: Omit<MediaItem, "id" | "addedAt">): MediaItem {
  const library = loadLibrary()
  const existing = library.find(m => m.url === item.url)
  if (existing) {
    return existing
  }
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
  const library = loadLibrary().filter(m => m.id !== id)
  saveLibrary(library)
}

export function toggleFavorite(id: string): void {
  const library = loadLibrary()
  const item = library.find(m => m.id === id)
  if (!item) return
  item.isFavorite = !item.isFavorite
  saveLibrary(library)
}

export function loadHistory(): PlaybackHistory[] {
  return safeParse(Storage.getSync(HISTORY_KEY), [])
}

export function addHistory(entry: PlaybackHistory): void {
  let history = loadHistory().filter(h => h.mediaId !== entry.mediaId)
  history.unshift(entry)
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY)
  }
  Storage.setSync(HISTORY_KEY, JSON.stringify(history))
}

export function clearHistory(): void {
  Storage.setSync(HISTORY_KEY, JSON.stringify([]))
}

export function loadSettings(): AppSettings {
  return { ...defaultSettings, ...safeParse(Storage.getSync(SETTINGS_KEY), {}) }
}

export function saveSettings(settings: AppSettings): void {
  Storage.setSync(SETTINGS_KEY, JSON.stringify(settings))
}
