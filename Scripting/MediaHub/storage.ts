import type { MediaItem, PlaybackHistory } from "./types"

const LIBRARY_KEY = "mediahub.library"
const HISTORY_KEY = "mediahub.history"
const SETTINGS_KEY = "mediahub.settings"
const LIBRARY_REV_KEY = "mediahub.library.rev"

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
