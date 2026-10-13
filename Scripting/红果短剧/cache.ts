// 自动缓存：把「在线解密播放过」的整集明文留在本机，下次再看直接读本地文件。
//
// ⚠️ 关键设计：缓存的数据**就是播放时本来就要解密的那份字节**——
//    本地代理按 AVPlayer 的 Range 请求解密时会顺手把明文攒起来，
//    整集攒完（说明这一集真的被看完了）再一次性写盘。
//    所以它**不额外耗一点流量**（不像「播完再下一遍」那种做法直接翻倍）。
//
// 放在 App Group 目录（同离线下载：不进文件 App、不同步 iCloud）。
// 超过上限按「最近最少使用」自动淘汰。

import { loadSettings } from "./storage"

export type CacheItem = {
  vid: string
  dramaId: string
  title: string
  episodeIndex: number
  quality: number
  fileName: string
  bytes: number
  savedAt: number
  lastUsedAt: number
}

const KEY = "hongguo_cache_v1"
const DIR_NAME = "hongguo-cache"

export function cacheDir(): string {
  return `${FileManager.appGroupDocumentsDirectory}/${DIR_NAME}`
}

export function ensureCacheDir(): void {
  const dir = cacheDir()
  if (!FileManager.existsSync(dir)) FileManager.createDirectorySync(dir, true)
}

export function cacheFileName(vid: string): string {
  return `${vid}.mp4`
}

/** 播放前就知道「如果这一集攒完要写到哪」——给本地代理用。 */
export function pendingCachePath(vid: string): string {
  return `${cacheDir()}/${cacheFileName(vid)}`
}

export function cacheFilePath(item: CacheItem): string {
  return `${cacheDir()}/${item.fileName}`
}

function exists(path: string): boolean {
  try { return FileManager.existsSync(path) } catch { return false }
}

/**
 * 读索引；顺手把「文件已经不在了」的条目清掉。
 *
 * ⚠️ 加 2 秒内存缓存：以前每次调用都是「Storage 读 + 逐条 existsSync + 排序」，
 * 而详情页 / 下载页 / 设置页都会在 render 里调它（`cacheTotalBytes()` 默认参数又调一次）
 * → 每帧同步扫磁盘。所有写入通道（`save`）会立刻失效缓存。
 */
const LOAD_TTL_MS = 2000
let loadedAt = 0
let loadedMemo: CacheItem[] = []

export function loadCache(force = false): CacheItem[] {
  const now = Date.now()
  if (!force && loadedAt && now - loadedAt < LOAD_TTL_MS) return loadedMemo.slice()
  const saved = Storage.get<CacheItem[]>(KEY)
  const list = Array.isArray(saved) ? saved : []
  const alive = list.filter(item => item && item.vid && item.fileName && exists(cacheFilePath(item)))
  if (alive.length !== list.length) Storage.set(KEY, alive)
  loadedMemo = alive.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  loadedAt = now
  return loadedMemo.slice()
}

function save(items: CacheItem[]): void {
  Storage.set(KEY, items)
  loadedAt = 0
}

export function cacheTotalBytes(items = loadCache()): number {
  return items.reduce((sum, item) => sum + item.bytes, 0)
}

export function findCache(vid: string): CacheItem | null {
  const item = loadCache().find(entry => entry.vid === vid)
  return item && exists(cacheFilePath(item)) ? item : null
}

/** 记一条缓存；然后按上限做 LRU 淘汰。 */
export function putCache(item: CacheItem): void {
  const items = loadCache().filter(entry => entry.vid !== item.vid)
  items.unshift(item)
  save(items)
  enforceCacheLimit()
}

/** 用过就更新「最近使用时间」，淘汰时不会被误杀。 */
export function touchCache(vid: string): void {
  const items = loadCache()
  const target = items.find(item => item.vid === vid)
  if (!target) return
  target.lastUsedAt = Date.now()
  save(items)
}

export function removeCache(vid: string): void {
  const items = loadCache()
  const target = items.find(item => item.vid === vid)
  if (target && exists(cacheFilePath(target))) {
    try { FileManager.removeSync(cacheFilePath(target)) } catch { /* 文件可能已不在 */ }
  }
  save(items.filter(item => item.vid !== vid))
}

export function clearCache(): void {
  for (const item of loadCache()) {
    if (exists(cacheFilePath(item))) {
      try { FileManager.removeSync(cacheFilePath(item)) } catch { /* ignore */ }
    }
  }
  save([])
}

/**
 * 清掉「有文件、没登记」的孤儿缓存：写盘成功但登记（`putCache`）没落地时（正好切后台/被杀）会留下，
 * 它不出现在列表里、不计入总量，只白占空间。
 *
 * ⚠️ 两道保险：① 登记表为空时**直接不动**（宁可白占也不误杀）；
 * ② 只删 `graceMs` 之前就没再动过的文件（正在写入的 mtime 是新的）。
 * 返回清掉的字节数。
 */
export function pruneOrphanCache(graceMs = 3600_000): number {
  const dir = cacheDir()
  if (!exists(dir)) return 0
  const live = loadCache()
  if (!live.length) return 0
  const keep = new Set(live.map(item => item.fileName))
  let freed = 0
  let removed = 0
  for (const name of safeList(dir)) {
    if (!name.endsWith(".mp4") || keep.has(name)) continue
    const path = `${dir}/${name}`
    try {
      const stat = FileManager.statSync(path)
      if (stat.type !== "file") continue
      const touched = stat.modificationDate > 1e12 ? stat.modificationDate : stat.modificationDate * 1000
      if (Date.now() - touched < graceMs) continue
      freed += stat.size
      FileManager.removeSync(path)
      removed++
    } catch { /* 单个文件失败不影响其他 */ }
  }
  if (removed) {
    console.log(`红果缓存：清掉 ${removed} 个孤儿文件，释放 ${Math.round(freed / 1024 / 1024)}MB`)
    loadedAt = 0 // 文件没了 → 备忘录里的条目可能指向不存在的文件，失效掉
  }
  return freed
}

/** `readDirectorySync` 在目录不存在时会抛，统一包一层。 */
function safeList(dir: string): string[] {
  try { return FileManager.readDirectorySync(dir) } catch { return [] }
}

/**
 * 超过上限就按 lastUsedAt 从旧到新删，直到降到 90% 以下（留点余量，避免每次都淘汰）。
 * 返回删掉的字节数。
 */
export function enforceCacheLimit(limitMB = loadSettings().cacheLimitMB): number {
  const limit = Math.max(64, Math.round(limitMB)) * 1024 * 1024
  const items = loadCache()
  // ⚠️ 先修脏数据：只要有一条 item.bytes 不是有限正数，total 就会变 NaN，
  // 后面所有 `<=` 比较全变假 → 循环会把磁盘上每个缓存文件逐个删掉并 save([])（一坏全清）。
  let dirty = false
  const clean = items.map(item => (Number.isFinite(item.bytes) && item.bytes > 0) ? item : (dirty = true, { ...item, bytes: 0 }))
  if (dirty) save(clean)
  let total = cacheTotalBytes(clean)
  if (!Number.isFinite(total) || total <= limit) return 0
  const target = limit * 0.9
  const oldest = [...clean].sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  let freed = 0
  for (const item of oldest) {
    if (total <= target) break
    if (exists(cacheFilePath(item))) {
      try { FileManager.removeSync(cacheFilePath(item)) } catch { /* ignore */ }
    }
    total -= item.bytes
    freed += item.bytes
    clean.splice(clean.findIndex(entry => entry.vid === item.vid), 1)
  }
  save(clean)
  return freed
}
