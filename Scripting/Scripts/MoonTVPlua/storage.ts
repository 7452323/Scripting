// Local fallback storage for offline scenarios
const STORAGE_KEY_FAVORITES = "moontvplus_local_favorites"
const STORAGE_KEY_HISTORY = "moontvplus_local_history"
const STORAGE_KEY_SEARCH_HISTORY = "moontvplus_search_history"
const STORAGE_KEY_HISTORY_REVISION = "moontvplus_history_revision"
const historyListeners = new Set<(revision: number) => void>()

export function getLocalFavorites(): string[] {
  try {
    const raw = Storage.get<string>(STORAGE_KEY_FAVORITES)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addLocalFavorite(id: string): void {
  const favs = getLocalFavorites()
  if (!favs.includes(id)) {
    favs.unshift(id)
    Storage.set(STORAGE_KEY_FAVORITES, JSON.stringify(favs))
  }
}

export function removeLocalFavorite(id: string): void {
  const favs = getLocalFavorites().filter(f => f !== id)
  Storage.set(STORAGE_KEY_FAVORITES, JSON.stringify(favs))
}

export function isLocalFavorite(id: string): boolean {
  return getLocalFavorites().includes(id)
}

export interface LocalHistoryEntry {
  id: string
  source: string
  title: string
  poster: string
  type_name: string
  year: string
  timestamp: number
  source_name?: string
  index?: number
  total_episodes?: number
  play_time?: number
  total_time?: number
}

export function getLocalHistory(): LocalHistoryEntry[] {
  try {
    const raw = Storage.get<string>(STORAGE_KEY_HISTORY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addLocalHistory(entry: LocalHistoryEntry): void {
  const history = getLocalHistory()
  const idx = history.findIndex(h => h.id === entry.id && h.source === entry.source)
  if (idx >= 0) history.splice(idx, 1)
  history.unshift({ ...entry, timestamp: Date.now() })
  // Keep max 100
  if (history.length > 100) history.length = 100
  Storage.set(STORAGE_KEY_HISTORY, JSON.stringify(history))
  const revision = Date.now()
  Storage.set(STORAGE_KEY_HISTORY_REVISION, revision)
  historyListeners.forEach(listener => listener(revision))
}

export function removeLocalHistory(entries: Array<{ id: string; source: string }>): void {
  if (entries.length === 0) return
  const keys = new Set(entries.map(entry => `${entry.source}+${entry.id}`))
  const history = getLocalHistory().filter(entry => !keys.has(`${entry.source}+${entry.id}`))
  Storage.set(STORAGE_KEY_HISTORY, JSON.stringify(history))
  const revision = Date.now()
  Storage.set(STORAGE_KEY_HISTORY_REVISION, revision)
  historyListeners.forEach(listener => listener(revision))
}

export function subscribeHistoryUpdates(listener: (revision: number) => void): () => void {
  historyListeners.add(listener)
  return () => historyListeners.delete(listener)
}

export function getHistoryRevision(): number {
  return Storage.get<number>(STORAGE_KEY_HISTORY_REVISION) || 0
}

export function getSearchHistory(): string[] {
  try {
    const raw = Storage.get<string>(STORAGE_KEY_SEARCH_HISTORY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addSearchHistory(query: string): void {
  const history = getSearchHistory()
  const idx = history.indexOf(query)
  if (idx >= 0) history.splice(idx, 1)
  history.unshift(query)
  if (history.length > 20) history.length = 20
  Storage.set(STORAGE_KEY_SEARCH_HISTORY, JSON.stringify(history))
}

export function clearSearchHistory(): void {
  Storage.remove(STORAGE_KEY_SEARCH_HISTORY)
}
