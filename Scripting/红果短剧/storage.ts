import type { Drama } from "./client"

const FAVOURITES_KEY = "hongguo_favourites_v1"
const HISTORY_KEY = "hongguo_history_v1"
const SETTINGS_KEY = "hongguo_settings_v1"

export type HistoryRecord = { drama: Drama; index: number; playedAt: number; quality: number; position?: number }
export type Settings = { quality: number; autoNext: boolean; crossSeason: boolean; bannerSeconds: number; autoCache: boolean; cacheLimitMB: number }

/** 设置的内存副本：`loadSettings()` 在「准备一集 / 选档位 / 开播放页」这些热路径上会被连着调好几次，
 *  每次都读一遍 Storage 没必要（JS 与 SwiftUI 共线程，Storage 读就是掉帧源）。
 *  所有写入都走 `saveSettings`，在那里失效即可。 */
let settingsMemo: Settings | null = null

const DEFAULT_SETTINGS: Settings = { quality: 480, autoNext: true, crossSeason: true, bannerSeconds: 3, autoCache: true, cacheLimitMB: 2048 }

/** 首页轮播自动切换速度候选（秒）。用户要求「最多五秒」。 */
export const BANNER_SECONDS_OPTIONS = [1, 2, 3, 4, 5]
export const BANNER_SECONDS_MAX = 5

/** 自动缓存容量上限候选（MB）。 */
export const CACHE_LIMIT_OPTIONS = [512, 1024, 2048, 4096]

/** 把任意值收敛成合法的缓存上限（MB）：非法值落到默认 2GB，钳制在 128MB~16GB。 */
export function normalizeCacheLimitMB(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SETTINGS.cacheLimitMB
  return Math.max(128, Math.min(16 * 1024, n))
}

/** 把任意值收敛成 1~5 的整数秒；非法值落到默认 3 秒。 */
export function normalizeBannerSeconds(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SETTINGS.bannerSeconds
  return Math.min(BANNER_SECONDS_MAX, n)
}

/** 轮播下一张的下标（循环）；只有一张时恒为 0。 */
export function nextBannerIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 1) return 0
  return (((Math.round(index) % count) + count) + 1) % count
}

export function loadFavourites(): Drama[] { return safeArray<Drama>(Storage.get(FAVOURITES_KEY)) }
export function isFavourite(id: string): boolean { return loadFavourites().some(item => item.id === id) }
export function toggleFavourite(drama: Drama): boolean {
  const list = loadFavourites()
  const exists = list.some(item => item.id === drama.id)
  Storage.set(FAVOURITES_KEY, exists ? list.filter(item => item.id !== drama.id) : [drama, ...list.filter(item => item.id !== drama.id)])
  return !exists
}
export function clearFavourites(): void { Storage.remove(FAVOURITES_KEY) }
/** 从收藏里去掉某一条（用于「这条记录已失效」时一键清理）。 */
export function removeFavourite(id: string): void {
  const list = loadFavourites()
  const next = list.filter(item => item.id !== id)
  if (next.length) Storage.set(FAVOURITES_KEY, next)
  else Storage.remove(FAVOURITES_KEY)
}
/** 把收藏里的某条**换成修正后的记录**（id 失效自动修复用）。返回是否真的换过。 */
export function replaceFavourite(oldId: string, drama: Drama): boolean {
  const list = loadFavourites()
  if (!list.some(item => item.id === oldId)) return false
  Storage.set(FAVOURITES_KEY, list.map(item => item.id === oldId ? drama : item))
  return true
}

export function loadHistory(): HistoryRecord[] { return safeArray<HistoryRecord>(Storage.get(HISTORY_KEY)).sort((a, b) => b.playedAt - a.playedAt) }
export function recordPlayback(drama: Drama, index: number, quality: number, position = 0): void {
  const list = loadHistory().filter(item => item.drama.id !== drama.id)
  Storage.set(HISTORY_KEY, [{ drama, index, quality, position: Math.max(0, Math.floor(position)), playedAt: Date.now() }, ...list].slice(0, 120))
}

/**
 * 只更新「看到第几秒」（播放中约每 12 秒调一次）。
 * ⚠️ 故意**不动 playedAt**：否则看着剧的时候首页「最近观看」会一直重排；
 * 也**不动 index**（那由 `recordPlayback` 在切集时写）。
 */
export function recordPosition(id: string, position: number): void {
  const list = loadHistory()
  const target = list.find(item => item.drama.id === id)
  if (!target) return
  const seconds = Math.max(0, Math.floor(position))
  if (Math.abs((target.position ?? 0) - seconds) < 2) return
  target.position = seconds
  Storage.set(HISTORY_KEY, list)
}
export function clearHistory(): void { Storage.remove(HISTORY_KEY) }
/** 从播放历史里去掉某一条（同上）。 */
export function removeHistory(id: string): void {
  const list = loadHistory()
  const next = list.filter(item => item.drama.id !== id)
  if (next.length) Storage.set(HISTORY_KEY, next)
  else Storage.remove(HISTORY_KEY)
}
/** 把历史里的某条换成修正后的记录（**保留观看到第几集与时间**）。 */
export function replaceHistory(oldId: string, drama: Drama): boolean {
  const list = loadHistory()
  if (!list.some(item => item.drama.id === oldId)) return false
  Storage.set(HISTORY_KEY, list.map(item => item.drama.id === oldId ? { ...item, drama } : item))
  return true
}

export function loadSettings(): Settings {
  if (!settingsMemo) settingsMemo = readSettings()
  // 返回副本：调用方偶尔会改对象（如手动调 cacheLimit），不能让内存副本被改脏
  return { ...settingsMemo }
}

/** 实际读 Storage（只在内存副本失效时跑）。 */
function readSettings(): Settings {
  const saved = Storage.get<Settings>(SETTINGS_KEY)
  if (!saved || typeof saved.quality !== "number") return { ...DEFAULT_SETTINGS }
  return {
    quality: saved.quality,
    autoNext: saved.autoNext !== false,
    crossSeason: saved.crossSeason !== false,
    bannerSeconds: normalizeBannerSeconds(saved.bannerSeconds),
    autoCache: saved.autoCache !== false,
    cacheLimitMB: normalizeCacheLimitMB(saved.cacheLimitMB),
  }
}

/** ⚠️ 传**部分字段**即可（其余保持原值）。
 *  以前要求传全量，加新设置时很容易把旧值覆盖成 undefined —— 所以这里只合并非 undefined 的字段。 */
export function saveSettings(patch: Partial<Settings>): void {
  // ⚠️ 先失效内存副本：否则下面的 loadSettings 会拿回旧值（写进去就白改了）
  settingsMemo = null
  const next: Settings = { ...loadSettings() }
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    const value = patch[key]
    if (value !== undefined) (next as any)[key] = value
  }
  next.cacheLimitMB = normalizeCacheLimitMB(next.cacheLimitMB)
  next.bannerSeconds = normalizeBannerSeconds(next.bannerSeconds)
  Storage.set(SETTINGS_KEY, next)
}

function safeArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : [] }
