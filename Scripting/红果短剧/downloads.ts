// 离线下载：把某一集整片解密成明文 MP4 落到本地，并登记到下载库。
//
// 放在 **App Group** 目录里（不进 Files、不同步 iCloud）——一集 3~40MB，
// 放进 iCloud Documents 会把云盘撑爆。

import { pickStream, streams, type Drama, type Episode } from "./client"
import { mediaProxy } from "./media-server"

export type DownloadItem = {
  id: string
  dramaId: string
  title: string
  cover: string
  episodeIndex: number
  vid: string
  quality: number
  fileName: string
  bytes: number
  createdAt: number
}

const KEY = "hongguo_downloads_v1"
const DIR_NAME = "hongguo-downloads"

export function downloadDir(): string {
  return `${FileManager.appGroupDocumentsDirectory}/${DIR_NAME}`
}

export function ensureDownloadDir(): void {
  const dir = downloadDir()
  if (!FileManager.existsSync(dir)) FileManager.createDirectorySync(dir, true)
}

export function filePathOf(item: DownloadItem): string {
  return `${downloadDir()}/${item.fileName}`
}

/**
 * ⚠️ 以前每次调用都要「Storage 读 + 逐条 existsSync + 排序」，而详情页 / 资料库 / 下载页是**在 render 里**
 * 就调它（还有 `hasDownload`）—— 等于每渲染一帧同步扫一遍磁盘，iOS 上就是「点一下卡一下」。
 *
 * 现在加 2 秒内存缓存；**所有写入通道（`save`）立刻失效**，所以不会读到脏数据。
 */
const LOAD_TTL_MS = 2000
let loadedAt = 0
let loadedMemo: DownloadItem[] = []

export function loadDownloads(force = false): DownloadItem[] {
  const now = Date.now()
  if (!force && loadedAt && now - loadedAt < LOAD_TTL_MS) return loadedMemo.slice()
  const saved = Storage.get<DownloadItem[]>(KEY)
  const list = Array.isArray(saved) ? saved : []
  // ⚠️ 与 loadCache 一样要对账磁盘：文件已经不在的条目必须清掉，
  // 否则下载页会出现点不动的条目、详情页以为「已下载」而走本地播放 → 「无法加载当前视频流」。
  const alive = list.filter(item => item && item.id && item.fileName && FileManager.existsSync(filePathOf(item)))
  if (alive.length !== list.length) Storage.set(KEY, alive)
  loadedMemo = alive.sort((a, b) => b.createdAt - a.createdAt)
  loadedAt = now
  return loadedMemo.slice()
}

function save(items: DownloadItem[]): void {
  Storage.set(KEY, items)
  loadedAt = 0
}

export function hasDownload(vid: string): DownloadItem | null {
  return loadDownloads().find(item => item.vid === vid) ?? null
}

export function addDownload(item: DownloadItem): void {
  const items = loadDownloads().filter(existing => existing.vid !== item.vid)
  items.unshift(item)
  save(items)
}

export function removeDownload(id: string): void {
  const items = loadDownloads()
  const target = items.find(item => item.id === id)
  if (target) {
    try { FileManager.removeSync(filePathOf(target)) } catch { /* 文件可能已不在 */ }
  }
  save(items.filter(item => item.id !== id))
}

export function clearDownloads(): void {
  for (const item of loadDownloads()) {
    try { FileManager.removeSync(filePathOf(item)) } catch { /* ignore */ }
  }
  save([])
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB"
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export type DownloadJob = { drama: Drama; episode: Episode }

export type DownloadEvent = { index: number; total: number; ratio: number; label: string; done: boolean }

/**
 * 依次下载若干集（串行，避免和播放抢带宽）。
 * 单集失败不会中断整队，返回成功 / 失败计数。
 */
export async function runDownloadQueue(
  jobs: DownloadJob[],
  quality: number,
  onEvent: (event: DownloadEvent) => void,
  cancelled: () => boolean,
): Promise<{ ok: number; failed: number }> {
  ensureDownloadDir()
  let ok = 0, failed = 0
  for (let index = 0; index < jobs.length; index++) {
    if (cancelled()) break
    const job = jobs[index]
    const label = `${job.drama.title} 第 ${job.episode.index} 集`
    onEvent({ index, total: jobs.length, ratio: 0, label, done: false })
    const fileName = `${job.drama.id}-${job.episode.index}-${job.episode.vid}.mp4`
    try {
      const options = await streams(job.episode.vid)
      const best = pickStream(options, quality)
      const result = await mediaProxy.downloadToFile(
        best.url,
        best.spade,
        `${downloadDir()}/${fileName}`,
        ratio => onEvent({ index, total: jobs.length, ratio, label, done: false }),
        cancelled,
      )
      if (cancelled()) {
        try { FileManager.removeSync(`${downloadDir()}/${fileName}`) } catch { /* ignore */ }
        break
      }
      if (result.bytes < result.total) {
        // 拿到的一集是残缺的：删掉半截文件、按失败计数，但**不要整队停掉**（后面的还能成功）
        try { FileManager.removeSync(`${downloadDir()}/${fileName}`) } catch { /* ignore */ }
        failed++
        console.error("红果下载不完整", label, `${result.bytes}/${result.total}`)
        onEvent({ index, total: jobs.length, ratio: 0, label: `${label}（下载不完整）`, done: false })
        continue
      }
      addDownload({
        id: `${job.drama.id}-${job.episode.vid}`,
        dramaId: job.drama.id,
        title: job.drama.title,
        cover: job.drama.cover,
        episodeIndex: job.episode.index,
        vid: job.episode.vid,
        quality: best.quality,
        fileName,
        bytes: result.bytes,
        createdAt: Date.now(),
      })
      ok++
      onEvent({ index, total: jobs.length, ratio: 1, label, done: true })
    } catch (error) {
      failed++
      // 半截文件不能留在磁盘上：它不进注册表、列表里也看不见，只会白占空间
      try { FileManager.removeSync(`${downloadDir()}/${fileName}`) } catch { /* ignore */ }
      console.error("红果下载失败", label, String(error))
      onEvent({ index, total: jobs.length, ratio: 0, label: `${label}（失败）`, done: false })
    }
  }
  return { ok, failed }
}

/**
 * 清掉「有文件、没登记」的孤儿下载（下到一半被杀、或登记没落地）。
 * 与缓存孤儿同理，同样带「登记表为空不动手」+「只删 1 小时未动的」两道保险，
 * 绝不会碰正在下载中的文件。
 */
export function pruneOrphanDownloads(graceMs = 3600_000): number {
  const dir = downloadDir()
  if (!FileManager.existsSync(dir)) return 0
  const live = loadDownloads()
  if (!live.length) return 0
  const keep = new Set(live.map(item => item.fileName))
  let names: string[] = []
  try { names = FileManager.readDirectorySync(dir) } catch { return 0 }
  let freed = 0
  let removed = 0
  for (const name of names) {
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
    } catch { /* 单个失败不影响其他 */ }
  }
  if (removed) console.log(`红果下载：清掉 ${removed} 个孤儿文件，释放 ${Math.round(freed / 1024 / 1024)}MB`)
  return freed
}

// ---------------------------------------------------------------- 导出到用户能看到的地方

export type ExportTarget = "photos" | "documents" | "iCloud"

/** 导出到「文件」App / iCloud Drive 时的二级文件夹名。 */
export const EXPORT_FOLDER = "红果短剧"

/** 导出的文件名：用剧名 + 集数（比内部那个 id 名字好认）。 */
export function exportFileName(title: string, episodeIndex: number): string {
  const safe = title.replace(/[\/\\:*?"<>|]/g, "-").trim() || "短剧"
  return `${safe} 第${episodeIndex}集.mp4`
}

export function exportTargetLabel(target: ExportTarget): string {
  if (target === "photos") return "「照片」App"
  if (target === "iCloud") return `iCloud Drive / ${EXPORT_FOLDER}`
  return `「文件」App · 我的 iPhone / Scripting / ${EXPORT_FOLDER}`
}

function iCloudRoot(): string {
  if (!FileManager.isiCloudEnabled) throw new Error("这台设备没开 iCloud（或没给「脚本」iCloud 权限），暂时存不了 iCloud Drive")
  return FileManager.iCloudDocumentsDirectory
}

/**
 * 把一个已经解密好的本地 mp4 导出到**沙盒之外**的地方（删掉脚本也还在）。
 *
 * 三个去向：
 * - `photos`    → 「照片」App：任何播放器/相册都能看；会混进照片流
 * - `documents` → 本机「文件」App（我的 iPhone / Scripting）：看得见、能自己拖走、不占 iCloud
 * - `iCloud`    → iCloud Drive：跨设备、删 App 也在；⚠️ 占 iCloud 空间（免费只有 5GB）
 */
export async function exportVideoFile(sourcePath: string, fileName: string, target: ExportTarget): Promise<void> {
  if (!FileManager.existsSync(sourcePath)) throw new Error("本地文件已经不在（可能被自动缓存清理了）")
  if (target === "photos") {
    const saved = await Photos.saveVideo(sourcePath, { fileName })
    if (!saved) throw new Error("保存到「照片」失败（或没给相册权限）")
    return
  }
  const dir = `${target === "iCloud" ? iCloudRoot() : FileManager.documentsDirectory}/${EXPORT_FOLDER}`
  if (!FileManager.existsSync(dir)) FileManager.createDirectorySync(dir, true)
  const destination = `${dir}/${fileName}`
  if (FileManager.existsSync(destination)) {
    try { FileManager.removeSync(destination) } catch { /* 删不掉就让 copy 直接覆盖 */ }
  }
  await FileManager.copyFile(sourcePath, destination)
}

/** 批量导出（串行；单集失败不打断），返回能直接给用户看的结果文案。 */
export async function exportVideoFiles(
  entries: { path: string; fileName: string }[],
  target: ExportTarget,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  let ok = 0
  let firstError = ""
  for (let index = 0; index < entries.length; index++) {
    try { await exportVideoFile(entries[index].path, entries[index].fileName, target); ok++ }
    catch (error) { if (!firstError) firstError = error instanceof Error ? error.message : String(error) }
    onProgress?.(index + 1, entries.length)
  }
  if (!ok) throw new Error(firstError || "全部失败")
  const failed = entries.length - ok
  return failed
    ? `${ok} 集已导出到 ${exportTargetLabel(target)}，${failed} 集失败（${firstError}）`
    : `${ok} 集已导出到 ${exportTargetLabel(target)}`
}
